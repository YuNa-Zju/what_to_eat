import { useSyncExternalStore } from 'react';
import { OptimisticStore } from './optimistic';
import type { Meal, Post, Restaurant, Settings } from './types';
export interface ServerData {
  restaurants: Restaurant[];
  meals: Meal[];
  settings: Settings;
  posts: Record<string, Post>;
}
export const dataStore = new OptimisticStore<ServerData>({
  restaurants: [],
  meals: [],
  settings: { window_size: 5 },
  posts: {},
});
export function useServerData() {
  return useSyncExternalStore(dataStore.subscribe, dataStore.snapshot);
}
export function votePatch(id: string, value: number) {
  return (state: ServerData): ServerData => {
    const post = state.posts[id];
    if (!post) return state;
    return {
      ...state,
      posts: {
        ...state.posts,
        [id]: {
          ...post,
          my_vote: value,
          likes: post.likes - Number(post.my_vote === 1) + Number(value === 1),
          dislikes: post.dislikes - Number(post.my_vote === -1) + Number(value === -1),
        },
      },
    };
  };
}
