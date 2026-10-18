// Radar placement, ported as is from the Apple Watch OverviewPage
// (ios/SoarXVoiceWatch/Views.swift): me in the centre, the top of the screen
// is the heading the arrows use, the farthest rider on the outer ring.
// Distance from the centre is the square root of the distance, so near riders
// do not sit on me; badges that would overlap are pushed apart and kept inside
// the ring. The Wear OS port must pass the cases in __tests__/radar.test.ts.

export interface Point {
  x: number;
  y: number;
}

/** Smallest "farthest" distance, so a lone rider at 5 m is not on the edge. */
export const MIN_FARTHEST_M = 50;

/** `angle` in degrees clockwise from the top of the screen. */
export function point(c: Point, radius: number, angle: number, fraction: number): Point {
  const a = (angle * Math.PI) / 180;
  const r = radius * fraction;
  return {x: c.x + r * Math.sin(a), y: c.y - r * Math.cos(a)};
}

/**
 * Pushes apart badges closer than a badge (and its distance label), a few
 * relaxation passes, keeping them inside the outer ring. Riders on the same
 * bearing are also pushed sideways, or they would only slide along the ray
 * and out of the ring. Returns new points; the input is not changed.
 */
export function spread(points: Point[], c: Point, radius: number, badge: number): Point[] {
  const p = points.map(q => ({x: q.x, y: q.y}));
  const minGap = badge + 10;
  for (let pass = 0; pass < 20; pass++) {
    let moved = false;
    for (let i = 0; i < p.length; i++) {
      for (let j = i + 1; j < p.length; j++) {
        const dx = p[j].x - p[i].x;
        const dy = p[j].y - p[i].y;
        const d = Math.sqrt(dx * dx + dy * dy);
        if (d >= minGap) continue;
        // Away from each other, plus sideways (perpendicular to the ray).
        const mx = (p[i].x + p[j].x) / 2 - c.x;
        const my = (p[i].y + p[j].y) / 2 - c.y;
        const m = Math.max(Math.sqrt(mx * mx + my * my), 0.01);
        let ux = d > 0.01 ? dx / d : 0;
        let uy = d > 0.01 ? dy / d : 1;
        ux += (-my / m) * 0.7;
        uy += (mx / m) * 0.7;
        const u = Math.max(Math.sqrt(ux * ux + uy * uy), 0.01);
        const push = (minGap - d) / 2;
        p[i].x -= (ux / u) * push;
        p[i].y -= (uy / u) * push;
        p[j].x += (ux / u) * push;
        p[j].y += (uy / u) * push;
        moved = true;
      }
    }
    for (let i = 0; i < p.length; i++) {
      const dx = p[i].x - c.x;
      const dy = p[i].y - c.y;
      const d = Math.sqrt(dx * dx + dy * dy);
      if (d > radius) p[i] = {x: c.x + (dx / d) * radius, y: c.y + (dy / d) * radius};
    }
    if (!moved) break;
  }
  return p;
}

/** A round ring distance: 1, 2 or 5 times a power of ten, not above `d`. */
export function niceDistance(d: number): number {
  if (!(d > 0)) return 0;
  const base = Math.pow(10, Math.floor(Math.log10(d)));
  for (const m of [5, 2, 1]) {
    if (m * base <= d) return m * base;
  }
  return base;
}

/** Under a radar badge, no unit: "180", "1.4K", "12K", "--" (Format.short). */
export function shortDistance(m: number | null | undefined): string {
  if (m === null || m === undefined || !Number.isFinite(m)) return '--';
  if (m < 1000) return `${Math.round(m)}`;
  if (m < 10_000) return `${(m / 1000).toFixed(1)}K`;
  return `${Math.round(m / 1000)}K`;
}

/** Ring label: "500 M", "1.4 KM", "20 KM" (Format.distance, uppercase). */
export function ringDistance(m: number): string {
  if (m < 1000) return `${Math.round(m)} M`;
  if (m < 10_000) return `${(m / 1000).toFixed(1)} KM`;
  return `${Math.round(m / 1000)} KM`;
}

/**
 * "Xavier Kain" gives "XK", "Lea (demo)" gives "L": the first letter of the
 * first two words, ignoring anything in parentheses (RiderBadge.initials).
 */
export function initials(name: string): string {
  const words = name
    .replace(/\(.*?\)/g, '')
    .split(/[ \-_]/)
    .filter(w => w.length > 0);
  const letters = words.slice(0, 2).map(w => Array.from(w)[0].toUpperCase());
  return letters.length === 0 ? '?' : letters.join('');
}

export interface RadarRider {
  uid: number;
  dist: number | null;
  brg: number | null;
}

export interface RadarLayout {
  centre: Point;
  /** Outer ring radius: the farthest rider's distance. */
  radius: number;
  farthest: number;
  /** Round distance of the inner ring. */
  inner: number;
  /** Inner ring radius, null when the round distance is not inside. */
  innerRadius: number | null;
  spots: {uid: number; x: number; y: number}[];
  /** Riders without a distance or bearing (shown in the list only). */
  unplaced: number[];
  /** Where the red "N" goes, just outside the outer ring. */
  north: Point;
}

/** A rider goes on the radar only with a finite distance and bearing. */
function isPlaced(r: RadarRider): boolean {
  return r.dist != null && r.brg != null && Number.isFinite(r.dist) && Number.isFinite(r.brg);
}

/**
 * Lays out every rider in a `width` × `height` box. `heading` is the true
 * bearing at the top of the screen (0 = north up). `badge` is the badge
 * diameter (44 on the phone, 34 on the watch).
 */
export function layoutRadar(riders: RadarRider[], width: number, height: number, heading: number, badge: number): RadarLayout {
  const placed = riders.filter(isPlaced);
  const unplaced = riders.filter(r => !isPlaced(r)).map(r => r.uid);
  const farthest = Math.max(Math.max(0, ...placed.map(r => r.dist as number)), MIN_FARTHEST_M);
  const size = Math.min(width, height);
  // The farthest badge sits on the edge ring, inside the box.
  const radius = size / 2 - badge / 2 - 2;
  const centre = {x: width / 2, y: height / 2};
  const inner = niceDistance(farthest / 2);
  const raw = placed.map(r =>
    point(centre, radius, (r.brg as number) - heading, Math.sqrt((r.dist as number) / farthest)),
  );
  const spots = spread(raw, centre, radius, badge).map((p, i) => ({uid: placed[i].uid, x: p.x, y: p.y}));
  return {
    centre,
    radius,
    farthest,
    inner,
    innerRadius: inner < farthest ? radius * Math.sqrt(inner / farthest) : null,
    spots,
    unplaced,
    north: point(centre, radius + 10, -heading, 1),
  };
}

/** North up, or my course up. The phone compass is never used (pouch). */
export type ArrowMode = 'north' | 'course';

/** True bearing at the top of the screen for an arrow mode. */
export function arrowHeading(mode: ArrowMode, cog: number | null | undefined): number {
  return mode === 'course' && typeof cog === 'number' && Number.isFinite(cog) ? cog : 0;
}

/** The rotation to animate to from `current` so the arrow turns the short way. */
export function nextRotation(current: number, target: number): number {
  const delta = ((((target - current) % 360) + 540) % 360) - 180;
  return current + delta;
}
