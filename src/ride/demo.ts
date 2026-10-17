// Demo mode: virtual riders so one person can try ComX with a single phone and
// watch. They circle around where the demo started, send quick messages, answer
// ours and echo voice messages back. Nothing goes over the network.

import {LatLon} from '../utils/geo';
import {Position} from './protocol';

export interface DemoRider {
  uid: number;
  name: string;
  /** Radius of the circle the rider rides around the anchor, metres. */
  radius: number;
  /** Time for one lap, seconds. */
  periodS: number;
  /** Starting angle, radians from north. */
  phase: number;
}

// High uids: Agora uids are random 32-bit values, so a clash is negligible.
export const DEMO_RIDERS: readonly DemoRider[] = [
  {uid: 990001, name: 'Lea (demo)', radius: 150, periodS: 240, phase: 0},
  {uid: 990002, name: 'Tom (demo)', radius: 450, periodS: 420, phase: 2.1},
  {uid: 990003, name: 'Max (demo)', radius: 900, periodS: 600, phase: 4.2},
];

/** Quick messages the virtual riders send on their own. */
export const DEMO_CHATTER_IDS = ['ok', 'wait', 'where', 'back'] as const;

/** Delay between two spontaneous demo messages. */
export const DEMO_CHATTER_MIN_MS = 45_000;
export const DEMO_CHATTER_MAX_MS = 90_000;

export function isDemoUid(uid: number): boolean {
  return DEMO_RIDERS.some(r => r.uid === uid);
}

export function demoRider(uid: number): DemoRider | undefined {
  return DEMO_RIDERS.find(r => r.uid === uid);
}

const EARTH_RADIUS_M = 6371008.8;

/** The point `northM` metres north and `eastM` metres east of `anchor`. */
export function offsetLatLon(anchor: LatLon, northM: number, eastM: number): LatLon {
  const lat = anchor.lat + (northM / EARTH_RADIUS_M) * (180 / Math.PI);
  const lon = anchor.lon + (eastM / (EARTH_RADIUS_M * Math.cos((anchor.lat * Math.PI) / 180))) * (180 / Math.PI);
  return {lat, lon};
}

/** Where a virtual rider is at `now`, riding clockwise around `anchor`. */
export function demoPosition(rider: DemoRider, anchor: LatLon, now: number): Position {
  const theta = rider.phase + (2 * Math.PI * (now / 1000)) / rider.periodS;
  const {lat, lon} = offsetLatLon(anchor, rider.radius * Math.cos(theta), rider.radius * Math.sin(theta));
  const cog = ((((theta * 180) / Math.PI + 90) % 360) + 360) % 360;
  const sog = (2 * Math.PI * rider.radius) / rider.periodS;
  return {lat, lon, cog: Math.round(cog), sog: Math.round(sog * 10) / 10, acc: 5, t: now};
}
