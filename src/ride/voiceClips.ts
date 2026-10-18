// Voice memos between riders: a clip file is cut into base64 slices small
// enough for the Agora data stream (1 KB per message) and reassembled on the
// recipients' phones. `to` is one rider's uid (private memo) or GROUP_UID
// (every rider). See "Voice memos" in docs/watch-companion.md.

/** base64 characters per data-stream message. */
export const CHUNK_CHARS = 600;
/** Pause between two slices: keeps us under Agora's ~6 KB/s data-stream cap. */
export const CHUNK_INTERVAL_MS = 150;
/** A clip whose slices stop arriving for this long is dropped. */
export const ASSEMBLY_TIMEOUT_MS = 20_000;
/** Larger clips are refused rather than flooding the data stream (~40 s at 16 kbit/s). */
export const MAX_CLIP_CHARS = 120_000;

/** `to` of a memo for every rider of the channel: Agora never assigns uid 0. */
export const GROUP_UID = 0;

/** A memo is for us when it goes to the whole group or to our uid. */
export function isClipForMe(to: number, localUid: number | null): boolean {
  return to === GROUP_UID || (localUid !== null && to === localUid);
}

export interface VoiceChunk {
  type: 'vc';
  id: string;
  to: number;
  seq: number;
  n: number;
  d: string;
  ms?: number;
  ext?: string;
}

export function splitClip(base64: string, id: string, to: number, durationMs: number, ext: string): VoiceChunk[] {
  const n = Math.max(1, Math.ceil(base64.length / CHUNK_CHARS));
  const chunks: VoiceChunk[] = [];
  for (let seq = 0; seq < n; seq++) {
    const chunk: VoiceChunk = {type: 'vc', id, to, seq, n, d: base64.slice(seq * CHUNK_CHARS, (seq + 1) * CHUNK_CHARS)};
    if (seq === 0) {
      chunk.ms = durationMs;
      chunk.ext = ext;
    }
    chunks.push(chunk);
  }
  return chunks;
}

export function parseVoiceChunk(raw: Record<string, unknown>): VoiceChunk | null {
  const {id, to, seq, n, d, ms, ext} = raw;
  if (raw.type !== 'vc' || typeof id !== 'string' || typeof d !== 'string') return null;
  if (typeof to !== 'number' || typeof seq !== 'number' || typeof n !== 'number') return null;
  if (n < 1 || n > Math.ceil(MAX_CLIP_CHARS / CHUNK_CHARS) || seq < 0 || seq >= n) return null;
  return {
    type: 'vc', id, to, seq, n, d,
    ms: typeof ms === 'number' ? ms : undefined,
    ext: typeof ext === 'string' && /^[a-z0-9]{2,4}$/.test(ext) ? ext : undefined,
  };
}

export interface AssembledClip {
  id: string;
  fromUid: number;
  base64: string;
  durationMs: number;
  ext: string;
}

interface Pending {
  fromUid: number;
  parts: (string | undefined)[];
  received: number;
  durationMs: number;
  ext: string;
  lastAt: number;
}

/** Collects slices per (sender, clip id) and returns the clip once complete. */
export class ClipAssembler {
  private pending = new Map<string, Pending>();

  add(fromUid: number, chunk: VoiceChunk, now: number): AssembledClip | null {
    this.expire(now);
    const key = `${fromUid}:${chunk.id}`;
    let p = this.pending.get(key);
    if (!p) {
      p = {fromUid, parts: new Array(chunk.n), received: 0, durationMs: 0, ext: 'm4a', lastAt: now};
      this.pending.set(key, p);
    }
    if (chunk.n !== p.parts.length) return null;
    if (p.parts[chunk.seq] === undefined) {
      p.parts[chunk.seq] = chunk.d;
      p.received++;
    }
    if (chunk.ms !== undefined) p.durationMs = chunk.ms;
    if (chunk.ext !== undefined) p.ext = chunk.ext;
    p.lastAt = now;
    if (p.received < p.parts.length) return null;
    this.pending.delete(key);
    return {id: chunk.id, fromUid, base64: p.parts.join(''), durationMs: p.durationMs, ext: p.ext};
  }

  expire(now: number) {
    for (const [key, p] of this.pending) {
      if (now - p.lastAt > ASSEMBLY_TIMEOUT_MS) this.pending.delete(key);
    }
  }

  get size() {
    return this.pending.size;
  }
}
