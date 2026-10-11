// Ride features shared between phones (Agora data stream) and watches.
// The wire format is documented in docs/watch-companion.md.

import {distanceMeters, bearingDegrees} from '../utils/geo';

export const PROTOCOL_VERSION = 1;

/** A position older than this is shown greyed out. */
export const STALE_AFTER_MS = 30_000;

export const QUICK_MESSAGES = [
  {id: 'ok', text: 'All good'},
  {id: 'back', text: 'Heading back'},
  {id: 'wait', text: 'Wait for me'},
  {id: 'where', text: 'Where are you?'},
  {id: 'gear', text: 'Gear broken'},
  {id: 'help', text: 'I need help'},
] as const;

export type QuickMessageId = (typeof QUICK_MESSAGES)[number]['id'];

export function quickMessageText(id: string, fallback?: string): string {
  return QUICK_MESSAGES.find(m => m.id === id)?.text ?? fallback ?? id;
}

export interface Position {
  lat: number;
  lon: number;
  /** Course over ground, degrees true, or null when not moving. */
  cog: number | null;
  /** Speed over ground in m/s, or null. */
  sog: number | null;
  /** Horizontal accuracy in metres. */
  acc: number;
  /** Fix time, epoch ms. */
  t: number;
}

export type StreamMessage =
  | {type: 'name'; name: string}
  | ({type: 'pos'} & Position)
  | {type: 'text'; id: string; text: string}
  | {type: 'sos'; active: boolean; lat: number | null; lon: number | null};

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const numOrNull = (v: unknown): number | null => (isNum(v) ? v : null);

/** Validate a data-stream message from another phone. Unknown or malformed → null. */
export function parseStreamMessage(raw: unknown): StreamMessage | null {
  if (!raw || typeof raw !== 'object') return null;
  const m = raw as Record<string, unknown>;
  switch (m.type) {
    case 'name':
      return typeof m.name === 'string' ? {type: 'name', name: m.name} : null;
    case 'pos':
      if (!isNum(m.lat) || !isNum(m.lon) || Math.abs(m.lat) > 90 || Math.abs(m.lon) > 180) return null;
      return {
        type: 'pos',
        lat: m.lat,
        lon: m.lon,
        cog: numOrNull(m.cog),
        sog: numOrNull(m.sog),
        acc: isNum(m.acc) ? m.acc : 0,
        t: isNum(m.t) ? m.t : Date.now(),
      };
    case 'text':
      if (typeof m.text !== 'string' || m.text.length === 0) return null;
      return {type: 'text', id: typeof m.id === 'string' ? m.id : 'custom', text: m.text.slice(0, 200)};
    case 'sos':
      return {type: 'sos', active: m.active === true, lat: numOrNull(m.lat), lon: numOrNull(m.lon)};
    default:
      return null;
  }
}

/** A remote rider as shown on the phone and sent to watches. */
export interface RiderView {
  uid: number;
  name: string;
  lat: number | null;
  lon: number | null;
  t: number | null;
  dist: number | null;
  brg: number | null;
  speaking: boolean;
  sos: boolean;
  stale: boolean;
}

export interface RiderInput {
  uid: number;
  name: string;
  speaking: boolean;
  position?: Position;
  sos: boolean;
}

export function buildRiderViews(me: Position | null, riders: RiderInput[], now: number): RiderView[] {
  return riders
    .map(r => {
      const p = r.position;
      const hasBoth = !!(p && me);
      return {
        uid: r.uid,
        name: r.name,
        lat: p ? p.lat : null,
        lon: p ? p.lon : null,
        t: p ? p.t : null,
        dist: hasBoth ? Math.round(distanceMeters(me!, p!)) : null,
        brg: hasBoth ? Math.round(bearingDegrees(me!, p!) * 10) / 10 : null,
        speaking: r.speaking,
        sos: r.sos,
        stale: !p || now - p.t > STALE_AFTER_MS,
      };
    })
    .sort((a, b) => {
      // SOS first, then nearest, unknown positions last
      if (a.sos !== b.sos) return a.sos ? -1 : 1;
      if (a.dist === null && b.dist === null) return a.name.localeCompare(b.name);
      if (a.dist === null) return 1;
      if (b.dist === null) return -1;
      return a.dist - b.dist;
    });
}

export interface WatchState {
  v: number;
  kind: 'state';
  connected: boolean;
  channel: string;
  watchMode: boolean;
  me: {name: string; lat: number | null; lon: number | null; cog: number | null; sog: number | null; t: number | null};
  riders: RiderView[];
  ts: number;
}

export function buildWatchState(args: {
  connected: boolean;
  channel: string;
  watchMode: boolean;
  myName: string;
  me: Position | null;
  riders: RiderView[];
  now: number;
}): WatchState {
  const {me} = args;
  return {
    v: PROTOCOL_VERSION,
    kind: 'state',
    connected: args.connected,
    channel: args.channel,
    watchMode: args.watchMode,
    me: {
      name: args.myName,
      lat: me ? me.lat : null,
      lon: me ? me.lon : null,
      cog: me ? me.cog : null,
      sog: me ? me.sog : null,
      t: me ? me.t : null,
    },
    riders: args.riders,
    ts: args.now,
  };
}

/** Messages a watch sends to the phone. */
export type WatchToPhone =
  | {kind: 'text'; id: string; text: string}
  | {kind: 'sos'; active: boolean}
  | {kind: 'ptt'; active: boolean}
  | {kind: 'hello'; platform: string; model?: string; hasCompass?: boolean};

export function parseWatchMessage(json: string): WatchToPhone | null {
  let m: Record<string, unknown>;
  try {
    m = JSON.parse(json);
  } catch {
    return null;
  }
  if (!m || typeof m !== 'object') return null;
  switch (m.kind) {
    case 'text': {
      const id = typeof m.id === 'string' ? m.id : 'custom';
      const text = typeof m.text === 'string' && m.text ? m.text : quickMessageText(id);
      return {kind: 'text', id, text: text.slice(0, 200)};
    }
    case 'sos':
      return {kind: 'sos', active: m.active === true};
    case 'ptt':
      return {kind: 'ptt', active: m.active === true};
    case 'hello':
      return {
        kind: 'hello',
        platform: typeof m.platform === 'string' ? m.platform : 'unknown',
        model: typeof m.model === 'string' ? m.model : undefined,
        hasCompass: m.hasCompass === true,
      };
    default:
      return null;
  }
}
