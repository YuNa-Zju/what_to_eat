import type { LocalData, Meal } from './types.ts';

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
  return JSON.stringify(normalizeContent(a)) === JSON.stringify(normalizeContent(b));
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
  get(code: string): Promise<SyncSnapshot>;
  put(code: string, snapshot: SyncSnapshot): Promise<SyncSnapshot>;
  commit(session: SyncSession, content: SyncContent): void;
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
    for (let attempt = 0; attempt < 5; attempt++) {
      const session = this.port.session();
      if (!session || session.connection !== initial.connection) return;
      const remote = await this.port.get(session.code);
      if (this.port.session()?.connection !== initial.connection) return;
      const sent = this.port.content();
      const merged = mergeContent(session.base.content, sent, remote.content);
      let confirmed = remote;
      if (!sameContent(merged, remote.content)) {
        try {
          confirmed = await this.port.put(session.code, {
            revision: remote.revision,
            content: merged,
          });
        } catch (error) {
          if (error instanceof SyncConflict) continue;
          throw error;
        }
      }
      if (this.port.session()?.connection !== initial.connection) return;
      if (this.port.session()!.base.revision > confirmed.revision) continue;
      // Rebase edits made during the request instead of replacing the current browser data.
      const current = mergeContent(sent, this.port.content(), confirmed.content);
      this.port.commit({ ...session, base: confirmed, lastSynced: Date.now() }, current);
      if (sameContent(current, confirmed.content)) return;
    }
    throw new Error('设备正在同时更新，本机修改已保留，请稍后重试');
  }
}
