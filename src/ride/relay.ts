// Wire types of the ComX relay and the pure logic around it. The contract is
// docs/superpowers/specs/2026-11-01-comx-watch-solo-design.md.

import {sha256} from 'js-sha256';
import {Position} from './protocol';

export const RELAY_SYNC_MS = 5_000;
/** A watch fix younger than this wins over the phone of the same rider. */
export const WATCH_FIX_MAX_AGE_MS = 30_000;

export type RelaySource = 'phone' | 'watch';

export interface RelayRider {
  uid: number;
  name: string;
  source: RelaySource;
  pos: Position | null;
  sos: boolean;
  seenAt: number;
}

export type RelayEvent =
  | {seq: number; id: string; uid: number; from: string; to: number; type: 'text'; msg: string; text: string}
  | {seq: number; id: string; uid: number; from: string; to: number; type: 'sos'; active: boolean}
  | {seq: number; id: string; uid: number; from: string; to: number; type: 'clip'; clip: string; durationMs: number; ext: string};

export interface RelayOutgoingText {
  id: string;
  type: 'text';
  msg: string;
  text: string;
}

export interface SyncRequest {
  uid: number;
  name: string;
  source: RelaySource;
  pos: Position | null;
  sos: boolean;
  cursor: number;
  events: RelayOutgoingText[];
}

export interface SyncResponse {
  now: number;
  riders: RelayRider[];
  events: RelayEvent[];
  cursor: number;
  acked: string[];
}

export interface RelayClip {
  id: string;
  uid: number;
  from: string;
  to: number;
  durationMs: number;
  ext: string;
  data: string;
}

export interface MergedRelayRider {
  uid: number;
  name: string;
  phone?: Position;
  watch?: Position;
  sos: boolean;
}

export function channelKey(channel: string): string {
  return sha256(`comx:${channel.toUpperCase()}`);
}

export function pickPosition(phone: Position | undefined, watch: Position | undefined, now: number): Position | undefined {
  if (watch && now - watch.t <= WATCH_FIX_MAX_AGE_MS) return watch;
  if (!phone) return watch;
  if (!watch) return phone;
  return watch.t > phone.t ? watch : phone;
}

export function mergeRelayRiders(riders: RelayRider[]): Record<number, MergedRelayRider> {
  const out: Record<number, MergedRelayRider> = {};
  for (const r of riders) {
    const entry = out[r.uid] ?? {uid: r.uid, name: r.name, sos: false};
    if (r.pos) entry[r.source] = r.pos;
    entry.sos = entry.sos || r.sos;
    out[r.uid] = entry;
  }
  return out;
}

/** Someone can only be reached through the relay: phone memos must go there too. */
export function hasSoloRider(riders: RelayRider[], now: number): boolean {
  return riders.some(r => r.source === 'watch' && now - r.seenAt <= WATCH_FIX_MAX_AGE_MS);
}

export class SeenIds {
  private ids = new Set<string>();

  constructor(private max = 200) {}

  firstTime(id: string): boolean {
    if (this.ids.has(id)) return false;
    this.ids.add(id);
    if (this.ids.size > this.max) {
      const oldest = this.ids.values().next().value;
      if (oldest !== undefined) this.ids.delete(oldest);
    }
    return true;
  }
}
