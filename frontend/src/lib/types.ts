export type Mode = 'shared' | 'local';
export type Rating = -1 | 0 | 1 | null;
export interface Restaurant {
  id: string;
  name: string;
  active: boolean;
}
export interface Meal {
  id: string;
  restaurant_id: string;
  eaten_on: string;
  created_at: number;
  rating: Rating;
  // Local-only links; never sent as shared history metadata.
  post_ids?: string[];
}
export interface Settings {
  window_size: number;
}
export interface Photo {
  id: string;
  url: string;
}
export interface Post {
  id: string;
  restaurant_id: string;
  eaten_on: string;
  nickname: string;
  body: string;
  created_at: number;
  shared_meal_id: string | null;
  images: Photo[];
  likes: number;
  dislikes: number;
  my_vote: number;
}
export interface LocalData {
  version: 1;
  window_size: number;
  meals: Meal[];
}
export interface ComposeSeed {
  meal?: Meal;
  mode: Mode;
}
export interface FeedScope {
  meal: Meal;
  mode: Mode;
}
