import { useEffect, useMemo } from 'react';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { dataStore } from '@/lib/data-store';
import { localPostIds, sortPosts } from '@/lib/meal-posts';
import { queryClient } from '@/lib/query-client';
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
) {
  const local = scope?.mode === 'local';
  const idsKey = local ? JSON.stringify(localPostIds(scope.meal)) : '';
  const normal = useInfiniteQuery({
    queryKey: ['feed', 'pages', filters],
    enabled: enabled && !local,
    initialPageParam: 0,
    queryFn: async ({ pageParam, signal }) => {
      const version = dataStore.version();
      const params = new URLSearchParams(filters);
      params.set('offset', String(pageParam));
      return { posts: await api<Post[]>(`/posts?${params}`, { signal }), version };
    },
    getNextPageParam: (last, pages) => (last.posts.length === 20 ? pages.length * 20 : undefined),
    refetchInterval: enabled && !local ? 30_000 : false,
  });
  const linked = useQuery({
    queryKey: ['feed', 'linked', filters, idsKey],
    enabled: enabled && local,
    queryFn: async ({ signal }) => {
      const ids = JSON.parse(idsKey) as string[];
      const version = dataStore.version();
      const all: Post[] = [];
      for (let batch = 0; batch < ids.length; batch += 100) {
        const subset = ids.slice(batch, batch + 100);
        for (let offset = 0; offset < subset.length; offset += 20) {
          const params = new URLSearchParams(filters);
          params.set('ids', subset.join(','));
          params.set('offset', String(offset));
          const page = await api<Post[]>(`/posts?${params}`, { signal });
          all.push(...page);
          if (page.length < 20) break;
        }
      }
      return { posts: sortPosts(all, sort), version };
    },
    refetchInterval: enabled && local ? 30_000 : false,
  });
  const pages = useMemo(
    () => (local ? (linked.data ? [linked.data] : []) : normal.data?.pages || []),
    [local, linked.data, normal.data],
  );
  useEffect(() => {
    const current = pages.filter((page) => page.version === dataStore.version());
    const state = dataStore.serverSnapshot();
    const missing = pages.some(
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
  }, [pages, enabled]);
  const ids = useMemo(
    () => [...new Set(pages.flatMap((page) => page.posts.map((post) => post.id)))],
    [pages],
  );
  const active = local ? linked : normal;
  return {
    ids,
    local,
    loading: active.isPending && enabled,
    busy: active.isFetching,
    error: active.error,
    hasMore: !local && normal.hasNextPage,
    next: () => normal.fetchNextPage(),
    refresh: () => active.refetch(),
  };
}
