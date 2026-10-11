import { useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { dataStore, type ServerData } from '@/lib/data-store';
import { queryClient } from '@/lib/query-client';

function useResource<K extends 'restaurants' | 'meals' | 'settings'>(key: K, enabled: boolean) {
  const query = useQuery({
    queryKey: ['server', key],
    enabled,
    queryFn: async ({ signal }) => {
      const version = dataStore.version();
      const value = await api<ServerData[K]>(`/${key}`, { signal });
      return { value, version };
    },
    refetchInterval: 30_000,
  });
  useEffect(() => {
    if (query.data && query.data.version !== dataStore.version()) {
      // A mutation finished while this read was in flight. Refill the cache from a fresh read.
      void query.refetch();
      return;
    }
    if (query.data)
      dataStore.refresh(
        { ...dataStore.serverSnapshot(), [key]: query.data.value },
        query.data.version,
      );
  }, [key, query.data]);
  return query;
}

export async function refreshServer() {
  await queryClient.invalidateQueries({ queryKey: ['server'] });
}

export function useServerResources() {
  // Establish the visitor cookie before starting concurrent resource requests.
  const visitor = useQuery({
    queryKey: ['visitor'],
    queryFn: ({ signal }) => api('/health', { signal }),
    staleTime: Infinity,
  });
  const restaurants = useResource('restaurants', visitor.isSuccess);
  const meals = useResource('meals', visitor.isSuccess);
  const settings = useResource('settings', visitor.isSuccess);
  const error = visitor.error || restaurants.error || meals.error || settings.error;
  return {
    ready: !!(restaurants.data && meals.data && settings.data),
    connectionError: error instanceof Error ? error.message : '',
    refresh: async () => {
      if (!visitor.isSuccess) await visitor.refetch();
      await refreshServer();
    },
  };
}
