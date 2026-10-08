import type { LocalData, Meal, Post } from './types.ts';

export function localPostIds(meal: Meal): string[] {
  // v0.1.0 used the post ID as the ID of a local meal created while publishing.
  return [...new Set([meal.id, ...(meal.post_ids || [])])];
}
export function linkLocalPost(data: LocalData, mealId: string, postId: string): LocalData {
  if (!data.meals.some((meal) => meal.id === mealId))
    throw new Error('本地记录已不存在，分享已发布，可在分享页查看');
  return {
    ...data,
    meals: data.meals.map((meal) =>
      meal.id === mealId
        ? {
            ...meal,
            post_ids: [...new Set([...(meal.post_ids || []), postId])],
          }
        : meal,
    ),
  };
}
export function sortPosts(posts: Post[], sort: string): Post[] {
  return [...posts].sort((a, b) => {
    if (sort === 'oldest') return a.created_at - b.created_at || a.id.localeCompare(b.id);
    const primary =
      sort === 'liked'
        ? b.likes - a.likes
        : sort === 'eaten'
          ? b.eaten_on.localeCompare(a.eaten_on)
          : 0;
    return primary || b.created_at - a.created_at || b.id.localeCompare(a.id);
  });
}
