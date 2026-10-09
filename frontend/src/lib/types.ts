export type Mode = 'shared' | 'local';
export type Rating = -1 | 0 | 1 | null;
export interface Restaurant {
  id: string;
  name: string;
  /** Legacy API metadata; no longer used to hide or exclude restaurants. */
  active?: boolean;
  address?: string | null;
  location?: RestaurantLocation | null;
  cover?: Photo | null;
}
export interface RestaurantLocation {
  lng: number;
  lat: number;
  coordinate_system: 'gcj02';
  poi_id?: string | null;
}
export interface RestaurantInput {
  name: string;
  address?: string | null;
  location?: RestaurantLocation | null;
  cover_upload_id?: string | null;
}
export interface Meal {
  id: string;
  restaurant_id: string;
  eaten_on: string;
  created_at: number;
  rating: Rating;
  cost_cents?: number | null;
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
  cost_cents?: number | null;
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
  selected?: string;
  intent?: 'record' | 'share';
}
export interface FeedScope {
  meal: Meal;
  mode: Mode;
}
