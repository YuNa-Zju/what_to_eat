import { readLastNickname, readLocal, writeLocal, LOCAL_CHANGE } from './storage';
import { randomUUID } from './uuid';
import {
  SyncConflict,
  SyncEngine,
  joinContent,
  mergeContent,
  normalizeContent,
  sameContent,
  type SyncContent,
  type SyncSession,
  type SyncSnapshot,
} from './sync-engine';

const KEY = 'what-to-eat:sync:v1';
export const SYNC_CHANGE = 'what-to-eat:sync-change';
export const SYNC_KEY = KEY;
let applying = false;
export function readSync(): SyncSession | null {
  const raw = localStorage.getItem(KEY);
  if (!raw) return null;
  const value = JSON.parse(raw) as SyncSession;
  if (!value.code || !value.base?.content || !value.connection)
    throw new Error('同步设置无法读取，本机记录仍然保留');
  return value;
}
function content(): SyncContent {
  return normalizeContent({ local: readLocal(), nickname: readLastNickname() });
}
export function hasPendingSync() {
  const session = readSync();
  return !!session && !sameContent(content(), session.base.content);
}
function changed() {
  window.dispatchEvent(new Event(SYNC_CHANGE));
}
function commit(session: SyncSession, next: SyncContent) {
  // Put the entire acknowledged checkpoint and browser data in one durable journal first.
  localStorage.setItem(KEY, JSON.stringify({ ...session, pendingApply: next }));
  applyPending();
  changed();
}
export function applyPending() {
  const raw = localStorage.getItem(KEY);
  if (!raw) return;
  const session = JSON.parse(raw) as SyncSession & { pendingApply?: SyncContent };
  if (!session.pendingApply) return;
  applying = true;
  try {
    const changed = !sameContent(content(), session.pendingApply);
    if (changed) writeLocal(session.pendingApply.local);
    // Unlike optional nickname memory, checkpoint writes must report storage failures.
    localStorage.setItem('what-to-eat:nickname:v1', session.pendingApply.nickname);
    delete session.pendingApply;
    localStorage.setItem(KEY, JSON.stringify(session));
    if (changed) window.dispatchEvent(new Event(LOCAL_CHANGE));
  } finally {
    applying = false;
  }
}
export function isApplyingSync() {
  return applying;
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
async function request<T>(method: string, code?: string, data?: unknown): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);
  try {
    const response = await fetch('/api/sync', {
      method,
      credentials: 'same-origin',
      signal: controller.signal,
      headers: { 'Content-Type': 'application/json', ...(code ? { 'X-Sync-Code': code } : {}) },
      ...(data !== undefined ? { body: JSON.stringify(data) } : {}),
    });
    if (response.status === 409) throw new SyncConflict();
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
const engine = new SyncEngine({
  session: readSync,
  content,
  get: (code) => request('GET', code),
  put: (code, value) => request('PUT', code, value),
  commit,
});
async function exclusive<T>(action: () => Promise<T>): Promise<T> {
  if (navigator.locks) return navigator.locks.request('what-to-eat-personal-sync', action);
  return action();
}
export async function syncNow() {
  return exclusive(async () => {
    applyPending();
    await engine.sync();
  });
}
export async function connectSync(input?: string) {
  return exclusive(async () => {
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
    // Preserve a recoverable local snapshot before the first merge.
    localStorage.setItem('what-to-eat:before-sync:v1', JSON.stringify(content()));
    const merged =
      input !== undefined
        ? joinContent(content(), remote.content)
        : mergeContent(before, content(), remote.content);
    commit({ code, connection: randomUUID(), base: remote, lastSynced: 0 }, merged);
    await engine.sync();
  });
}
export function disconnectSync() {
  applyPending();
  localStorage.removeItem(KEY);
  changed();
}
