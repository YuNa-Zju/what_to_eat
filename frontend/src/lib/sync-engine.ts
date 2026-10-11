import type { LocalData, Meal } from './types.ts';
import { randomUUID } from './uuid.ts';

export interface SyncContent {
  local: LocalData;
  nickname: string;
}
export interface SyncSnapshot {
  revision: number;
  content: SyncContent;
}
export interface SyncSession {
  code: string;
  connection: string;
  base: SyncSnapshot;
  lastSynced: number;
  checkpoint?: string;
  pendingWrite?: PendingWrite;
}
export interface PendingWrite {
  operation: string;
  sent: SyncContent;
  snapshot: SyncSnapshot;
}
export class SyncConflict extends Error {}

export function normalizeContent(content: SyncContent): SyncContent {
  return {
    local: {
      version: 1,
      window_size: content.local.window_size,
      meals: content.local.meals
        .map((m) => ({
          id: m.id,
          restaurant_id: m.restaurant_id,
          eaten_on: m.eaten_on,
          created_at: m.created_at,
          rating: m.rating ?? null,
          cost_cents: m.cost_cents ?? null,
          post_ids: [...new Set(m.post_ids || [])].sort(),
        }))
        .sort((a, b) => a.id.localeCompare(b.id)),
    },
    nickname: content.nickname,
  };
}
export function sameContent(a: SyncContent, b: SyncContent) {
  if (a === b) return true;
  if (
    a.nickname !== b.nickname ||
    a.local.window_size !== b.local.window_size ||
    a.local.meals.length !== b.local.meals.length
  )
    return false;
  const right = new Map(b.local.meals.map((meal) => [meal.id, meal]));
  return a.local.meals.every((meal) => {
    const other = right.get(meal.id);
    if (
      !other ||
      meal.restaurant_id !== other.restaurant_id ||
      meal.eaten_on !== other.eaten_on ||
      meal.created_at !== other.created_at ||
      (meal.rating ?? null) !== (other.rating ?? null) ||
      (meal.cost_cents ?? null) !== (other.cost_cents ?? null)
    )
      return false;
    const links = new Set(meal.post_ids || []),
      otherLinks = new Set(other.post_ids || []);
    return links.size === otherLinks.size && [...links].every((id) => otherLinks.has(id));
  });
}
/** First connection preserves distinct meals; the existing cloud settings take precedence. */
export function joinContent(local: SyncContent, remote: SyncContent): SyncContent {
  return normalizeContent({
    ...remote,
    local: {
      ...remote.local,
      meals: [
        ...new Map([...local.local.meals, ...remote.local.meals].map((m) => [m.id, m])).values(),
      ],
    },
  });
}
/** Three-way merge; delete wins over concurrent edits, separate fields merge independently. */
export function mergeContent(
  base: SyncContent,
  local: SyncContent,
  remote: SyncContent,
): SyncContent {
  const old = new Map(base.local.meals.map((m) => [m.id, m]));
  const here = new Map(local.local.meals.map((m) => [m.id, m]));
  const there = new Map(remote.local.meals.map((m) => [m.id, m]));
  const meals: Meal[] = [];
  for (const id of new Set([...here.keys(), ...there.keys()])) {
    const b = old.get(id),
      l = here.get(id),
      r = there.get(id);
    if (b && (!l || !r)) continue;
    if (!b) {
      meals.push(l || r!);
      continue;
    }
    const merged = { ...r! };
    for (const key of [
      'restaurant_id',
      'eaten_on',
      'created_at',
      'rating',
      'cost_cents',
    ] as const) {
      if ((l![key] ?? null) !== (b[key] ?? null)) Object.assign(merged, { [key]: l![key] });
    }
    const before = new Set(b.post_ids || []),
      left = new Set(l!.post_ids || []),
      right = new Set(r!.post_ids || []);
    merged.post_ids = [...new Set([...left, ...right])].filter(
      (id) => !before.has(id) || (left.has(id) && right.has(id)),
    );
    meals.push(merged);
  }
  return normalizeContent({
    local: {
      version: 1,
      meals,
      window_size:
        local.local.window_size !== base.local.window_size
          ? local.local.window_size
          : remote.local.window_size,
    },
    nickname: local.nickname !== base.nickname ? local.nickname : remote.nickname,
  });
}
export interface SyncPort {
  session(): SyncSession | null;
  content(): SyncContent;
  get(code: string, revision: number): Promise<SyncSnapshot | null>;
  put(code: string, snapshot: SyncSnapshot, operation: string): Promise<SyncSnapshot>;
  /** Compare and save under a short cross-tab transaction; rebase against the latest local data. */
  save(
    expected: SyncSession,
    next: SyncSession,
    apply?: { before: SyncContent; next: SyncContent },
  ): Promise<boolean>;
}
export function sameCheckpoint(a: SyncSession | null, b: SyncSession): boolean {
  return (
    !!a &&
    a.connection === b.connection &&
    a.base.revision === b.base.revision &&
    a.checkpoint === b.checkpoint &&
    a.pendingWrite?.operation === b.pendingWrite?.operation
  );
}
export class SyncEngine {
  private running?: Promise<void>;
  private port: SyncPort;
  constructor(port: SyncPort) {
    this.port = port;
  }
  sync(): Promise<void> {
    if (this.running) return this.running;
    this.running = this.run().finally(() => {
      this.running = undefined;
    });
    return this.running;
  }
  private async run() {
    const initial = this.port.session();
    if (!initial) return;
    for (let attempt = 0; attempt < 12; attempt++) {
      const session = this.port.session();
      if (!session || session.connection !== initial.connection) return;
      const pending = session.pendingWrite;
      if (pending) {
        let confirmed: SyncSnapshot;
        try {
          // The same id/body recovers an acknowledged write even after a lost response or reload.
          confirmed = await this.port.put(session.code, pending.snapshot, pending.operation);
        } catch (error) {
          if (!(error instanceof SyncConflict)) throw error;
          const { pendingWrite: _, ...next } = session;
          await this.port.save(session, next);
          continue;
        }
        if (!sameCheckpoint(this.port.session(), session)) continue;
        const { pendingWrite: _, ...next } = session;
        await this.port.save(
          session,
          { ...next, base: confirmed, lastSynced: Date.now() },
          {
            before: pending.sent,
            next: confirmed.content,
          },
        );
        // The receipt can predate edits from another device. Always fetch the current revision.
        continue;
      }
      const pulled = await this.port.get(session.code, session.base.revision);
      // Another tab may have committed even the same remote revision while this request waited.
      if (!sameCheckpoint(this.port.session(), session)) continue;
      const sent = this.port.content();
      const remote = pulled ?? session.base;
      if (!pulled && sameContent(sent, session.base.content)) return;
      const merged = mergeContent(session.base.content, sent, remote.content);
      if (!sameContent(merged, remote.content)) {
        await this.port.save(session, {
          ...session,
          pendingWrite: {
            operation: randomUUID(),
            sent,
            snapshot: { revision: remote.revision, content: merged },
          },
        });
        continue;
      }
      if (
        !(await this.port.save(
          session,
          { ...session, base: remote, lastSynced: Date.now() },
          {
            before: sent,
            next: merged,
          },
        ))
      )
        continue;
      if (sameContent(this.port.content(), merged)) return;
    }
    throw new Error('设备正在同时更新，本机修改已保留，请稍后重试');
  }
}
