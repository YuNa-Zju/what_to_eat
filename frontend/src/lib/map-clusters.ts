import type { Restaurant } from './types';

export interface MapPoint {
  restaurant: Restaurant;
  x: number;
  y: number;
}

export interface RestaurantCluster {
  restaurants: Restaurant[];
  x: number;
  y: number;
}

export const MAP_MARKER_WIDTH = 148;
export const MAP_MARKER_HEIGHT = 44;

const COLLISION_WIDTH = MAP_MARKER_WIDTH + 8;
const COLLISION_HEIGHT = MAP_MARKER_HEIGHT + 10;

/** Group overlapping screen markers around fixed seeds, without spreading along a chain. */
export function clusterMapPoints(points: MapPoint[]): RestaurantCluster[] {
  const ordered = points
    .filter((point) => Number.isFinite(point.x) && Number.isFinite(point.y))
    .sort((a, b) => {
      if (a.restaurant.id !== b.restaurant.id) return a.restaurant.id < b.restaurant.id ? -1 : 1;
      return a.x - b.x || a.y - b.y;
    });
  const clusters: RestaurantCluster[] = [];

  for (const point of ordered) {
    let nearest: RestaurantCluster | undefined;
    let nearestDistance = Infinity;
    for (const cluster of clusters) {
      const dx = Math.abs(point.x - cluster.x);
      const dy = Math.abs(point.y - cluster.y);
      if (dx >= COLLISION_WIDTH || dy >= COLLISION_HEIGHT) continue;
      const distance = dx * dx + dy * dy;
      if (distance < nearestDistance) {
        nearest = cluster;
        nearestDistance = distance;
      }
    }

    if (nearest) {
      nearest.restaurants.push(point.restaurant);
    } else {
      // Keeping this center fixed bounds every member's distance and prevents chain merging.
      clusters.push({ restaurants: [point.restaurant], x: point.x, y: point.y });
    }
  }

  return clusters;
}
