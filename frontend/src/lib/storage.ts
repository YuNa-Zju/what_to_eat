import type { LocalData, Meal } from './types.ts';
import { MAX_COST_CENTS } from './money.ts';
import {
  afterSyncCommit,
  hydrateSyncStorage,
  SYNC_STORAGE_CHANGE,
  syncStorage,
  syncTransaction,
} from './sync-transaction.ts';
export const LOCAL_KEY = 'what-to-eat:local:v1';
export const NICKNAME_KEY = 'what-to-eat:nickname:v1';
export const LOCAL_CHANGE = 'what-to-eat:local-change';

type StoredLocal = LocalData;
const defaults = (): LocalData => ({ version: 1, window_size: 5, meals: [] });
let cachedRaw: string | null | undefined;
let cached: LocalData = defaults();
let cachedData = JSON.stringify(cached);
let localError: string | null = null;

function parseLocal(value: StoredLocal | null): LocalData {
  if (!value) return defaults();
  if (
    value.version !== 1 ||
    !Number.isInteger(value.window_size) ||
    value.window_size < 1 ||
    value.window_size > 100 ||
    !Array.isArray(value.meals) ||
    value.meals.some(
      (m) =>
        !m ||
        typeof m.id !== 'string' ||
        typeof m.restaurant_id !== 'string' ||
        !/^\d{4}-\d{2}-\d{2}$/.test(m.eaten_on) ||
        !Number.isFinite(m.created_at) ||
        (m.post_ids !== undefined &&
          (!Array.isArray(m.post_ids) || m.post_ids.some((id) => typeof id !== 'string'))) ||
        (m.rating != null && ![-1, 0, 1].includes(m.rating)) ||
        (m.cost_cents != null &&
          (!Number.isSafeInteger(m.cost_cents) ||
            m.cost_cents < 0 ||
            m.cost_cents > MAX_COST_CENTS)),
    )
  )
    throw new Error('本地记录格式异常，请先备份浏览器数据，不要清空存储');
  return {
    version: 1,
    window_size: value.window_size,
    meals: value.meals.map((meal) => ({
      ...meal,
      rating: meal.rating ?? null,
      cost_cents: meal.cost_cents ?? null,
    })),
  };
}

/** Stable snapshots for React; strict reads below still prevent overwriting unreadable data. */
export function getLocalSnapshot(): LocalData {
  try {
    const raw = syncStorage.getItem(LOCAL_KEY);
    if (raw !== cachedRaw) {
      const stored = raw ? (JSON.parse(raw) as StoredLocal) : null;
      const next = parseLocal(stored);
      const serialized = JSON.stringify(next);
      if (serialized !== cachedData) {
        cached = next;
        cachedData = serialized;
      }
      cachedRaw = raw;
    }
    localError = null;
  } catch (error) {
    localError = error instanceof Error ? error.message : '无法读取浏览器本地记录';
  }
  return cached;
}
export function getLocalError(): string | null {
  getLocalSnapshot();
  return localError;
}
function notifyLocal() {
  window.dispatchEvent(new Event(LOCAL_CHANGE));
}
export function subscribeLocal(listener: () => void): () => void {
  const external = (event: StorageEvent) => {
    if (event.key === null || event.key === LOCAL_KEY || event.key === NICKNAME_KEY) listener();
  };
  window.addEventListener(LOCAL_CHANGE, listener);
  window.addEventListener('storage', external);
  window.addEventListener('focus', hydrateSyncStorage);
  window.addEventListener(SYNC_STORAGE_CHANGE, listener);
  void hydrateSyncStorage();
  return () => {
    window.removeEventListener(LOCAL_CHANGE, listener);
    window.removeEventListener('storage', external);
    window.removeEventListener('focus', hydrateSyncStorage);
    window.removeEventListener(SYNC_STORAGE_CHANGE, listener);
  };
}
export function readLocal(): LocalData {
  getLocalSnapshot();
  if (localError) throw new Error(localError);
  return cached;
}
export function readLastNickname(): string {
  try {
    return syncStorage.getItem(NICKNAME_KEY) ?? '';
  } catch {
    return '';
  }
}
/** Both entries commit atomically in the surrounding IndexedDB transaction. */
export function writePersonalData(value: LocalData, nickname: string) {
  const next = JSON.stringify(value);
  let changed = false;
  if (syncStorage.getItem(LOCAL_KEY) !== next) {
    syncStorage.setItem(LOCAL_KEY, next);
    changed = true;
  }
  if (syncStorage.getItem(NICKNAME_KEY) !== nickname) {
    syncStorage.setItem(NICKNAME_KEY, nickname);
    changed = true;
  }
  if (changed) afterSyncCommit(notifyLocal);
}
export async function rememberNickname(nickname: string) {
  try {
    await syncTransaction(() => {
      const next = nickname.trim();
      if (readLastNickname() !== next) {
        syncStorage.setItem(NICKNAME_KEY, next);
        afterSyncCommit(notifyLocal);
      }
    });
  } catch {
    // Remembering a nickname is optional and must not interrupt publishing.
  }
}
function writeLocalUnlocked(value: LocalData) {
  readLocal();
  writePersonalData(value, readLastNickname());
}
export function writeLocal(value: LocalData): Promise<void> {
  return syncTransaction(() => writeLocalUnlocked(value));
}
export function updateLocal(change: (current: LocalData) => LocalData): Promise<LocalData> {
  return syncTransaction(() => {
    const next = change(readLocal());
    writeLocalUnlocked(next);
    return next;
  });
}
export function addLocalMeal(meal: Meal): Promise<LocalData> {
  return updateLocal((current) => ({
    ...current,
    meals: current.meals.some((m) => m.id === meal.id) ? current.meals : [...current.meals, meal],
  }));
}
