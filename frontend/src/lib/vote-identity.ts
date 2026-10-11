import { readSync, SYNC_CHANGE, SYNC_KEY } from './personal-sync.ts';
import { SYNC_STORAGE_CHANGE, syncTransaction } from './sync-transaction.ts';
import { randomUUID } from './uuid.ts';

export interface VoteIdentitySnapshot {
  readonly key: string;
  readonly status: 'loading' | 'migrating' | 'ready' | 'error';
  readonly error: string | null;
}
export interface VoteRequestSnapshot {
  readonly key: string;
  readonly headers: Readonly<Record<string, string>>;
  readonly signal: AbortSignal;
  /** Check before applying a response or an optimistic rollback to shared state. */
  isCurrent(): boolean;
}
type Session = { connection: string; code: string } | null;
interface VoteIdentityPort {
  hydrate(): Promise<void>;
  session(): Session;
  migrate(code: string, signal: AbortSignal): Promise<void>;
  events(): EventTarget;
}
type Identity = {
  key: string;
  session: Session;
  controller: AbortController;
  request: VoteRequestSnapshot;
  migration?: Promise<boolean>;
};
const initial: VoteIdentitySnapshot = Object.freeze({
  key: 'loading',
  status: 'loading',
  error: null,
});

/** One lifecycle per connection, independent of meal checkpoint updates. */
export function createVoteIdentity(port: VoteIdentityPort) {
  let snapshot = initial;
  let identity: Identity | null = null;
  let started = false;
  let hydrated = false;
  let generation = 0;
  let hydration: Promise<boolean> | undefined;
  const listeners = new Set<() => void>();
  const pendingAnonymous = new Set<Promise<unknown>>();
  let target: EventTarget | undefined;

  const publish = (next: VoteIdentitySnapshot) => {
    snapshot = Object.freeze(next);
    for (const listener of listeners) listener();
  };
  const current = (value: Identity) =>
    started && identity === value && !value.controller.signal.aborted;
  const replace = () => {
    identity?.controller.abort();
    identity = null;
    generation++;
  };
  const migrate = (value: Identity): Promise<boolean> => {
    if (value.migration) return value.migration;
    publish({ key: value.key, status: 'migrating', error: null });
    const work = (async () => {
      try {
        if (pendingAnonymous.size) await Promise.allSettled([...pendingAnonymous]);
        if (!current(value)) return false;
        await port.migrate(value.session!.code, value.controller.signal);
        if (!current(value)) return false;
        publish({ key: value.key, status: 'ready', error: null });
        return true;
      } catch (error) {
        if (!current(value)) return false;
        publish({
          key: value.key,
          status: 'error',
          error: error instanceof Error ? error.message : '点赞同步失败，请重试',
        });
        return false;
      }
    })();
    value.migration = work;
    void work.then(() => {
      if (value.migration === work) value.migration = undefined;
    });
    return work;
  };
  const select = (session: Session) => {
    if (
      identity &&
      identity.session?.connection === session?.connection &&
      identity.session?.code === session?.code
    )
      return;
    replace();
    const key = session ? `sync:${session.connection}` : `browser:${randomUUID()}`;
    const controller = new AbortController();
    const headers: Record<string, string> = session ? { 'X-Sync-Code': session.code } : {};
    const value: Identity = {
      key,
      session,
      controller,
      request: Object.freeze({
        key,
        headers: Object.freeze(headers),
        signal: controller.signal,
        isCurrent: () => current(value) && snapshot.status === 'ready',
      }),
    };
    identity = value;
    if (session) void migrate(value);
    else publish({ key, status: 'ready', error: null });
  };
  const fail = (error: unknown) => {
    replace();
    publish({
      key: `unavailable:${randomUUID()}`,
      status: 'error',
      error: error instanceof Error ? error.message : '无法读取点赞同步身份，请重试',
    });
  };
  const refresh = (): Promise<boolean> => {
    if (hydration) return hydration;
    const expected = generation;
    const work = (async () => {
      try {
        // Unlike optional UI hydration, a failed read must not fall back to cookie identity.
        await port.hydrate();
        if (!started || generation !== expected) return false;
        hydrated = true;
        select(port.session());
        return true;
      } catch (error) {
        if (started && generation === expected) fail(error);
        return false;
      }
    })();
    hydration = work;
    void work.finally(() => {
      if (hydration !== work) return;
      hydration = undefined;
      // A storage notification may invalidate the identity before this hydration's
      // completion callback unwinds. Re-read the final connection instead of staying loading.
      if (started && !hydrated && snapshot.status === 'loading') void refresh();
    });
    return work;
  };
  const changed = () => {
    if (!hydrated) {
      if (!hydration) void refresh();
      return;
    }
    try {
      select(port.session());
    } catch (error) {
      fail(error);
    }
  };
  const storage = (event: Event) => {
    const { key, newValue } = event as StorageEvent;
    if (key !== null && key !== SYNC_KEY) return;
    if (!hydrated) return;
    try {
      const hint = newValue ? (JSON.parse(newValue) as Session) : null;
      if (
        key !== null &&
        identity &&
        hint?.connection === identity.session?.connection &&
        hint?.code === identity.session?.code
      )
        return;
    } catch {
      /* Hydrate an unreadable mirror from the authoritative store. */
    }
    // Cross-tab localStorage notifications can precede IDB cache hydration. Stop old requests
    // immediately, then read the authoritative connection before issuing any replacement.
    replace();
    hydrated = false;
    publish({ key: `loading:${randomUUID()}`, status: 'loading', error: null });
    void refresh();
  };
  return {
    getSnapshot: () => snapshot,
    subscribe(listener: () => void) {
      listeners.add(listener);
      if (!started) {
        started = true;
        target = port.events();
        target.addEventListener(SYNC_CHANGE, changed);
        target.addEventListener(SYNC_STORAGE_CHANGE, changed);
        target.addEventListener('storage', storage);
        void refresh();
      }
      return () => {
        listeners.delete(listener);
        if (listeners.size) return;
        started = false;
        hydrated = false;
        replace();
        hydration = undefined;
        snapshot = initial;
        target?.removeEventListener(SYNC_CHANGE, changed);
        target?.removeEventListener(SYNC_STORAGE_CHANGE, changed);
        target?.removeEventListener('storage', storage);
      };
    },
    request(expectedKey?: string): VoteRequestSnapshot {
      if (expectedKey !== undefined && expectedKey !== snapshot.key)
        throw new DOMException('点赞身份已变更', 'AbortError');
      if (!identity || snapshot.status !== 'ready')
        throw new Error(snapshot.error || '点赞身份正在同步，请稍后再试');
      return identity.request;
    },
    write<T>(
      request: VoteRequestSnapshot,
      action: (signal: AbortSignal) => Promise<T>,
    ): Promise<T> {
      if (!request.isCurrent())
        return Promise.reject(new DOMException('点赞身份已变更', 'AbortError'));
      const anonymous = request.key.startsWith('browser:');
      const timeout = new AbortController();
      const timer = setTimeout(() => timeout.abort(), 15_000);
      // An anonymous request already accepted by the server must settle before migration.
      // Switching identity only retires its UI response; shared requests can be cancelled.
      const signal = anonymous ? timeout.signal : AbortSignal.any([request.signal, timeout.signal]);
      const work = Promise.resolve().then(() => action(signal));
      const tracked = work.finally(() => {
        clearTimeout(timer);
        pendingAnonymous.delete(tracked);
      });
      if (anonymous) pendingAnonymous.add(tracked);
      return tracked;
    },
    async retry(): Promise<boolean> {
      if (!started) return false;
      if (!hydrated || !identity) {
        if (!(await refresh())) return false;
        return identity?.migration ?? snapshot.status === 'ready';
      }
      return identity.session && snapshot.status !== 'ready' ? migrate(identity) : true;
    },
  };
}

async function migrateVotes(code: string, signal: AbortSignal) {
  const timeout = new AbortController();
  const timer = setTimeout(() => timeout.abort(), 15_000);
  try {
    const response = await fetch('/api/sync/votes', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'X-Sync-Code': code },
      signal: AbortSignal.any([signal, timeout.signal]),
    });
    if (!response.ok) {
      const body = (await response.json().catch(() => null)) as { error?: string } | null;
      throw new Error(body?.error || '点赞同步失败，请重试');
    }
  } catch (error) {
    if (signal.aborted) throw error;
    if (timeout.signal.aborted) throw new Error('点赞同步超时，请重试');
    if (error instanceof TypeError) throw new Error('暂时无法同步点赞，联网后请重试');
    throw error;
  } finally {
    clearTimeout(timer);
  }
}
export const voteIdentity = createVoteIdentity({
  hydrate: () => syncTransaction(() => {}),
  session: readSync,
  migrate: migrateVotes,
  events: () => window,
});
