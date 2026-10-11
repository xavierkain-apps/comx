// Distance and direction between riders, from GPS positions.

const EARTH_RADIUS_M = 6371008.8;

export interface LatLon {
  lat: number;
  lon: number;
}

const toRad = (deg: number) => (deg * Math.PI) / 180;
const toDeg = (rad: number) => (rad * 180) / Math.PI;

/** Great-circle distance in metres (haversine). */
export function distanceMeters(a: LatLon, b: LatLon): number {
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Initial bearing from a to b, degrees true in [0, 360). */
export function bearingDegrees(a: LatLon, b: LatLon): number {
  const phi1 = toRad(a.lat);
  const phi2 = toRad(b.lat);
  const dLon = toRad(b.lon - a.lon);
  const y = Math.sin(dLon) * Math.cos(phi2);
  const x = Math.cos(phi1) * Math.sin(phi2) - Math.sin(phi1) * Math.cos(phi2) * Math.cos(dLon);
  return normalizeDegrees(toDeg(Math.atan2(y, x)));
}

export function normalizeDegrees(deg: number): number {
  const d = deg % 360;
  return d < 0 ? d + 360 : d;
}

/**
 * Angle to draw an arrow at, relative to where the rider faces.
 * Without a heading the arrow is north-up (the bearing itself).
 */
export function relativeBearing(bearing: number, heading: number | null | undefined): number {
  if (heading === null || heading === undefined || Number.isNaN(heading)) {
    return normalizeDegrees(bearing);
  }
  return normalizeDegrees(bearing - heading);
}

/** "85 m", "340 m", "1.2 km", "12 km". */
export function formatDistance(meters: number | null | undefined): string {
  if (meters === null || meters === undefined || !Number.isFinite(meters)) return '—';
  const rounded = Math.round(meters / 5) * 5;
  if (rounded < 1000) return `${rounded} m`;
  if (meters < 10000) return `${(meters / 1000).toFixed(1)} km`;
  return `${Math.round(meters / 1000)} km`;
}

/** 8-point compass label for a bearing: N, NE, E… */
export function compassLabel(bearing: number): string {
  const labels = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
  return labels[Math.round(normalizeDegrees(bearing) / 45) % 8];
}
