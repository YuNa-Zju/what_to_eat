import type { RestaurantLocation } from './types.ts';

export function validLocation(point?: RestaurantLocation | null): point is RestaurantLocation {
  return (
    !!point &&
    point.coordinate_system === 'gcj02' &&
    Number.isFinite(point.lng) &&
    Math.abs(point.lng) <= 180 &&
    Number.isFinite(point.lat) &&
    Math.abs(point.lat) <= 90
  );
}

/** Approximate straight-line distance between points in the same coordinate system. */
export function distanceKm(
  from?: RestaurantLocation | null,
  to?: RestaurantLocation | null,
): number | null {
  if (!validLocation(from) || !validLocation(to)) return null;
  const radians = Math.PI / 180;
  const a =
    Math.sin(((to.lat - from.lat) * radians) / 2) ** 2 +
    Math.cos(from.lat * radians) *
      Math.cos(to.lat * radians) *
      Math.sin(((to.lng - from.lng) * radians) / 2) ** 2;
  return 6371.0088 * 2 * Math.asin(Math.sqrt(Math.min(1, Math.max(0, a))));
}

/** A mild 0.8–1.2 multiplier leaves taste as the main signal. Unknown stays neutral. */
export function distanceWeight(km: number | null): number {
  return km === null || !Number.isFinite(km) || km < 0 ? 1 : 0.8 + 0.4 / (1 + km / 2);
}

export function formatDistance(km: number): string {
  if (km < 0.1) return '100 米内';
  if (km < 1) return `约 ${Math.round(km * 10) * 100} 米`;
  return `约 ${km < 10 ? km.toFixed(1) : Math.round(km)} 公里`;
}
