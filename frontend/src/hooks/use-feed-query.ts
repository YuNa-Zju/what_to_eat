import { useEffect, useMemo, useRef } from 'react';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { dataStore } from '@/lib/data-store';
import { localPostIds, sortPosts } from '@/lib/meal-posts';
import { queryClient } from '@/lib/query-client';
import { voteIdentity, type VoteIdentitySnapshot } from '@/lib/vote-identity';
import type { FeedScope, Post } from '@/lib/types';

export async function refreshFeed() {
  await queryClient.cancelQueries({ queryKey: ['feed'] });
  await queryClient.invalidateQueries({ queryKey: ['feed'] });
}

export function useFeedQuery(
  filters: string,
  scope: FeedScope | null,
  sort: string,
  enabled: boolean,
  identity: VoteIdentitySnapshot,
) {
  const previousIdentity = useRef(identity.key);
  useEffect(() => {
    if (previousIdentity.current === identity.key) return;
    const previous = previousIdentity.current;
    previousIdentity.current = identity.key;
    // Cached my_vote values and pending optimistic patches belong to one identity only.
    dataStore.update((state) => ({ ...state, posts: {} }));
    void queryClient.cancelQueries({ queryKey: ['feed', 'posts', previous] }).then(() => {
      queryClient.removeQueries({ queryKey: ['feed', 'posts', previous] });
    });
  }, [identity.key]);
  const ready = identity.status === 'ready';
  const local = scope?.mode === 'local';
  const idsKey = local ? JSON.stringify(localPostIds(scope.meal)) : '';
  function requestIdentity() {
    const request = voteIdentity.request();
    if (request.key !== identity.key)
      throw new DOMException('Voting identity changed', 'AbortError');
    return request;
  }
  const normal = useInfiniteQuery({
    queryKey: ['feed', 'posts', identity.key, 'pages', filters],
    enabled: enabled && ready && !local,
    initialPageParam: 0,
    queryFn: async ({ pageParam, signal }) => {
      const request = requestIdentity();
      const version = dataStore.version();
      const params = new URLSearchParams(filters);
      params.set('offset', String(pageParam));
      const posts = await api<Post[]>(`/posts?${params}`, { signal, headers: request.headers });
      if (!request.isCurrent()) throw new DOMException('Voting identity changed', 'AbortError');
      return { posts, version, identity: request.key };
    },
    getNextPageParam: (last, pages) => (last.posts.length === 20 ? pages.length * 20 : undefined),
    refetchInterval: enabled && ready && !local ? 30_000 : false,
  });
  const linked = useQuery({
    queryKey: ['feed', 'posts', identity.key, 'linked', filters, idsKey],
    enabled: enabled && ready && local,
    queryFn: async ({ signal }) => {
      const request = requestIdentity();
      const ids = JSON.parse(idsKey) as string[];
      const version = dataStore.version();
      const all: Post[] = [];
      for (let batch = 0; batch < ids.length; batch += 100) {
        const subset = ids.slice(batch, batch + 100);
        for (let offset = 0; offset < subset.length; offset += 20) {
          const params = new URLSearchParams(filters);
          params.set('ids', subset.join(','));
          params.set('offset', String(offset));
          const page = await api<Post[]>(`/posts?${params}`, { signal, headers: request.headers });
          if (!request.isCurrent()) throw new DOMException('Voting identity changed', 'AbortError');
          all.push(...page);
          if (page.length < 20) break;
        }
      }
      return { posts: sortPosts(all, sort), version, identity: request.key };
    },
    refetchInterval: enabled && ready && local ? 30_000 : false,
  });
  const pages = useMemo(
    () => (local ? (linked.data ? [linked.data] : []) : normal.data?.pages || []),
    [local, linked.data, normal.data],
  );
  useEffect(() => {
    if (!ready || voteIdentity.getSnapshot().key !== identity.key) return;
    const scoped = pages.filter((page) => page.identity === identity.key);
    const current = scoped.filter((page) => page.version === dataStore.version());
    const state = dataStore.serverSnapshot();
    const missing = scoped.some(
      (page) =>
        page.version !== dataStore.version() && page.posts.some((post) => !state.posts[post.id]),
    );
    if (enabled && missing) void (local ? linked.refetch() : normal.refetch());
    if (!current.length) return;
    const incoming = current.flatMap((page) => page.posts);
    if (incoming.every((post) => state.posts[post.id] === post)) return;
    dataStore.refresh(
      {
        ...state,
        posts: { ...state.posts, ...Object.fromEntries(incoming.map((post) => [post.id, post])) },
      },
      dataStore.version(),
    );
  }, [pages, enabled, ready, identity.key]);
  const ids = useMemo(
    () => [...new Set(pages.flatMap((page) => page.posts.map((post) => post.id)))],
    [pages],
  );
  const active = local ? linked : normal;
  return {
    ids: ready ? ids : [],
    local,
    loading:
      enabled &&
      (active.isPending || identity.status === 'loading' || identity.status === 'migrating') &&
      identity.status !== 'error',
    busy: active.isFetching,
    error: active.error,
    hasMore: ready && !local && normal.hasNextPage,
    next: () => normal.fetchNextPage(),
    refresh: () => (ready ? active.refetch() : voteIdentity.retry()),
  };
}
