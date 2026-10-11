import { readLastNickname, readLocal, writePersonalData } from './storage.ts';
import { randomUUID } from './uuid.ts';
import { afterSyncCommit, syncStorage, syncTransaction } from './sync-transaction.ts';
import {
  SyncConflict,
  SyncEngine,
  joinContent,
  mergeContent,
  sameCheckpoint,
  sameContent,
  type SyncContent,
  type SyncSession,
  type SyncSnapshot,
} from './sync-engine.ts';

export const SYNC_CHANGE = 'what-to-eat:sync-change';
export const SYNC_KEY = 'what-to-eat:sync:v1';
export const SYNC_MIGRATION_KEY = 'what-to-eat:sync-migration:v1';
type Journal = SyncSession & { pendingApply?: SyncContent };
let cachedRaw: string | null | undefined;
let cachedSession: Journal | null = null;
let cachedContent: SyncContent | undefined;
export function readSync(): Journal | null {
  const raw = syncStorage.getItem(SYNC_KEY);
  if (raw === cachedRaw) return cachedSession;
  const value = raw ? (JSON.parse(raw) as Journal) : null;
  if (value && (!value.code || !value.base?.content || !value.connection))
    throw new Error('同步设置无法读取，本机记录仍然保留');
  cachedRaw = raw;
  cachedSession = value;
  return value;
}
function content(): SyncContent {
  const local = readLocal(),
    nickname = readLastNickname();
  if (cachedContent?.local !== local || cachedContent.nickname !== nickname)
    cachedContent = { local, nickname };
  return cachedContent;
}
export function hasPendingSync() {
  const session = readSync();
  return (
    !!session &&
    (!!session.pendingWrite ||
      !!session.pendingApply ||
      !sameContent(content(), session.base.content))
  );
}
function changed() {
  afterSyncCommit(() => window.dispatchEvent(new Event(SYNC_CHANGE)));
}
function persist(session: Journal) {
  syncStorage.setItem(SYNC_KEY, JSON.stringify(session));
}
function recover() {
  const session = readSync();
  if (!session?.pendingApply) return;
  // The original journal had no pre-write baseline: a difference could be an unapplied
  // remote change or a newer user edit. Never guess and overwrite either copy.
  if (!sameContent(content(), session.pendingApply)) {
    throw new Error(
      '旧版本有未完成的同步，本机记录未改动。请断开后重新连接；断开时会备份旧同步数据',
    );
  }
  const { pendingApply: _, ...clean } = session;
  persist({ ...clean, checkpoint: randomUUID() });
  changed();
}
function apply(session: SyncSession, before: SyncContent, next: SyncContent) {
  // Both values belong to the same authoritative IDB transaction. New writes need no journal.
  if (!sameContent(before, next)) writePersonalData(next.local, next.nickname);
  persist(session);
  changed();
}
export function normalizeCode(code: string) {
  return code
    .normalize('NFKC')
    .replace(/[\s\u2010-\u2015\u2212-]/g, '')
    .toLowerCase();
}
export function formatCode(code: string) {
  return (
    code
      .toUpperCase()
      .match(/.{1,8}/g)
      ?.join('-') || code
  );
}
async function request<T>(
  method: string,
  code?: string,
  data?: unknown,
  headers: Record<string, string> = {},
): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);
  try {
    const response = await fetch('/api/sync', {
      method,
      credentials: 'same-origin',
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        ...(code ? { 'X-Sync-Code': code } : {}),
        ...headers,
      },
      ...(data !== undefined ? { body: JSON.stringify(data) } : {}),
    });
    if (response.status === 409) throw new SyncConflict();
    if (response.status === 204) return null as T;
    const body = await response.json();
    if (!response.ok) throw new Error(body.error || '同步暂时不可用，本机记录已保留');
    return body as T;
  } catch (error) {
    if (
      error instanceof TypeError ||
      (error instanceof DOMException && error.name === 'AbortError')
    )
      throw new Error('暂时无法连接，本机修改已保留，联网后继续同步');
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

/** Each tab owns an engine; the transaction guards shared checkpoints, never network I/O. */
export function createPersonalSyncClient(transaction = syncTransaction) {
  const engine = new SyncEngine({
    session: readSync,
    content,
    get: (code, revision) =>
      request('GET', code, undefined, { 'X-Sync-Revision': String(revision) }),
    put: (code, snapshot, operation) =>
      request('PUT', code, snapshot, { 'X-Sync-Operation': operation }),
    save: (expected, next, change) =>
      transaction(() => {
        recover();
        if (!sameCheckpoint(readSync(), expected)) return false;
        const updated = { ...next, checkpoint: randomUUID() };
        if (change) {
          const current = content();
          apply(updated, current, mergeContent(change.before, current, change.next));
        } else {
          persist(updated);
          changed();
        }
        return true;
      }),
  });
  return {
    async syncNow() {
      await transaction(recover);
      await engine.sync();
    },
    async connectSync(input?: string) {
      if (readSync()) throw new Error('请先断开当前设备，再连接其他同步码');
      const before = content();
      let code: string, remote: SyncSnapshot;
      if (input !== undefined) {
        code = normalizeCode(input);
        if (!/^[a-f0-9]{32}$/.test(code)) throw new Error('同步码应为 32 位字母和数字，请完整粘贴');
        remote = await request<SyncSnapshot>('GET', code);
      } else {
        const created = await request<SyncSnapshot & { code: string }>('POST', undefined, before);
        code = created.code;
        remote = { revision: created.revision, content: created.content };
      }
      await transaction(() => {
        if (readSync()) throw new Error('其他标签页已连接同步，请刷新后重试');
        const current = content();
        syncStorage.setItem('what-to-eat:before-sync:v1', JSON.stringify(current));
        const merged =
          input !== undefined
            ? joinContent(current, remote.content)
            : mergeContent(before, current, remote.content);
        apply(
          {
            code,
            connection: randomUUID(),
            checkpoint: randomUUID(),
            base: remote,
            lastSynced: Date.now(),
          },
          current,
          merged,
        );
      });
      await engine.sync();
    },
    async disconnectSync() {
      await transaction(() => {
        const session = readSync();
        if (session?.pendingApply) {
          syncStorage.setItem(SYNC_MIGRATION_KEY, JSON.stringify({ session, content: content() }));
        }
        syncStorage.removeItem(SYNC_KEY);
        changed();
      });
    },
  };
}
const client = createPersonalSyncClient();
export const syncNow = client.syncNow;
export const connectSync = client.connectSync;
export const disconnectSync = client.disconnectSync;
export const applyPending = () => syncTransaction(recover);
