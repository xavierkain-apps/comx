import {DurableObject} from 'cloudflare:workers';
import type {Env} from './index';

const RIDER_TTL_MS = 120_000;
const EVENT_TTL_MS = 15 * 60_000;
const MAX_EVENTS = 200;
const FIRST_SYNC_WINDOW_MS = 120_000;
const MIN_SYNC_GAP_MS = 1_000;
const WIPE_AFTER_MS = 60 * 60_000;
const ALARM_REFRESH_MS = 5 * 60_000;
const MAX_CLIP_CHARS = 350_000;
const MIN_CLIP_GAP_MS = 3_000;
/** A change time further ahead than this is a wrong clock: clamped to the relay's now. */
const MAX_SOS_AHEAD_MS = 10 * 60_000;
/** The cursor is `epoch * EPOCH_UNIT + lastSeq`: a new epoch after each wipe. */
const EPOCH_UNIT = 2 ** 32;
const EPOCH_LIMIT = 2 ** 20;

interface ClipBody {
  id: string; uid: number; from: string; to: number; durationMs: number; ext: string; data: string;
}

interface SyncBody {
  uid: number;
  name: string;
  source: 'phone' | 'watch';
  pos: Record<string, unknown> | null;
  sos: boolean;
  /** Epoch ms of the client's last SOS change, 0 if it never changed it. */
  sosAt: number;
  cursor: number;
  events: (Record<string, unknown> & {id: string; to?: number})[];
}

type RiderRow = {uid: number; source: string; name: string; pos: string | null; seen_at: number; sos: number; sos_at: number};
type EventRow = {seq: number; id: string; uid: number; sender: string; to_uid: number; at: number; body: string};

export class Channel extends DurableObject<Env> {
  /** Replaced in tests. */
  clock: () => number = Date.now;
  private alarmSetAt = 0;

  private lastClipAt = new Map<number, number>();

  private ensureSchema() {
    this.ctx.storage.sql.exec(`
      CREATE TABLE IF NOT EXISTS riders (
        uid INTEGER, source TEXT, name TEXT, pos TEXT, seen_at INTEGER,
        PRIMARY KEY (uid, source));
      CREATE TABLE IF NOT EXISTS events (
        seq INTEGER PRIMARY KEY AUTOINCREMENT, id TEXT UNIQUE, uid INTEGER, sender TEXT,
        to_uid INTEGER, at INTEGER, body TEXT);
      CREATE TABLE IF NOT EXISTS clips (id TEXT PRIMARY KEY, at INTEGER, body TEXT);
      CREATE TABLE IF NOT EXISTS sos_state (uid INTEGER PRIMARY KEY, active INTEGER, changed_at INTEGER);
      CREATE TABLE IF NOT EXISTS meta (k TEXT PRIMARY KEY, v INTEGER);
    `);
  }

  /** Random per channel, renewed by the wipe, so old cursors are recognised. */
  private epoch(): number {
    const sql = this.ctx.storage.sql;
    const row = sql.exec<{v: number}>("SELECT v FROM meta WHERE k = 'epoch'").toArray()[0];
    if (row) return row.v;
    const epoch = 1 + Math.floor(Math.random() * (EPOCH_LIMIT - 1));
    sql.exec("INSERT INTO meta (k, v) VALUES ('epoch', ?)", epoch);
    return epoch;
  }

  /** Last seq ever assigned, even if that event has expired since. */
  private lastSeq(): number {
    const row = this.ctx.storage.sql
      .exec<{seq: number}>("SELECT seq FROM sqlite_sequence WHERE name = 'events'")
      .toArray()[0];
    return row?.seq ?? 0;
  }

  async fetch(request: Request): Promise<Response> {
    this.ensureSchema();
    const path = new URL(request.url).pathname;
    const isSync = path.endsWith('/sync');
    if (!isSync && !path.endsWith('/clips')) return this.getClip(path.split('/').pop() ?? '');
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return badRequest('not json');
    }
    if (isSync) return isSyncBody(body) ? this.sync(body) : badRequest('bad sync');
    return isClipBody(body) ? this.putClip(body) : badRequest('bad clip');
  }

  private putClip(clip: ClipBody): Response {
    const now = this.clock();
    if (clip.data.length > MAX_CLIP_CHARS) return new Response('too large', {status: 413});
    const last = this.lastClipAt.get(clip.uid);
    if (last !== undefined && now - last < MIN_CLIP_GAP_MS) return new Response('too fast', {status: 429});
    this.lastClipAt.set(clip.uid, now);
    this.ctx.storage.sql.exec('INSERT OR REPLACE INTO clips (id, at, body) VALUES (?, ?, ?)', clip.id, now, JSON.stringify(clip));
    const who = {uid: clip.uid, name: clip.from} as SyncBody;
    this.addEvent(clip.id, who, {type: 'clip', clip: clip.id, durationMs: clip.durationMs, ext: clip.ext}, clip.to);
    this.keepAlarm(now);
    return Response.json({ok: true});
  }

  private getClip(id: string): Response {
    this.ctx.storage.sql.exec('DELETE FROM clips WHERE at < ?', this.clock() - EVENT_TTL_MS);
    const row = this.ctx.storage.sql.exec<{body: string}>('SELECT body FROM clips WHERE id = ?', id).toArray()[0];
    return row ? new Response(row.body, {headers: {'content-type': 'application/json'}}) : new Response('not found', {status: 404});
  }

  private sync(body: SyncBody): Response {
    const sql = this.ctx.storage.sql;
    const now = this.clock();
    const previous = sql
      .exec<{seen_at: number}>('SELECT seen_at FROM riders WHERE uid = ? AND source = ?', body.uid, body.source)
      .toArray()[0];
    if (previous && now - previous.seen_at < MIN_SYNC_GAP_MS) return new Response('too fast', {status: 429});

    sql.exec(
      'INSERT OR REPLACE INTO riders (uid, source, name, pos, seen_at) VALUES (?, ?, ?, ?, ?)',
      body.uid, body.source, body.name, body.pos ? JSON.stringify(body.pos) : null, now,
    );

    this.updateSos(body, now);
    const acked: string[] = [];
    for (const e of body.events) {
      const {id, to, ...rest} = e;
      this.addEvent(id, body, rest, to ?? 0);
      acked.push(id);
    }

    sql.exec('DELETE FROM events WHERE at < ?', now - EVENT_TTL_MS);
    sql.exec('DELETE FROM clips WHERE at < ?', now - EVENT_TTL_MS);
    sql.exec('DELETE FROM events WHERE seq <= (SELECT MAX(seq) FROM events) - ?', MAX_EVENTS);
    this.keepAlarm(now);

    return Response.json({
      now,
      riders: this.riders(body, now),
      self: this.selfSos(body.uid),
      events: this.events(body, now),
      cursor: this.epoch() * EPOCH_UNIT + this.lastSeq(),
      acked,
    });
  }

  /**
   * One SOS state per uid: the newest change wins, by the time the client
   * says it made it. An older or equal time never changes the state, so a
   * client re-sending a stale value cannot reverse a newer change.
   */
  private updateSos(body: SyncBody, now: number) {
    const sql = this.ctx.storage.sql;
    const sosAt = body.sosAt > now + MAX_SOS_AHEAD_MS ? now : body.sosAt;
    if (sosAt <= 0) return;
    const state = sql
      .exec<{active: number; changed_at: number}>('SELECT active, changed_at FROM sos_state WHERE uid = ?', body.uid)
      .toArray()[0];
    if (state && sosAt <= state.changed_at) return;
    const active = body.sos ? 1 : 0;
    sql.exec('INSERT OR REPLACE INTO sos_state (uid, active, changed_at) VALUES (?, ?, ?)', body.uid, active, sosAt);
    if ((state?.active ?? 0) === active) return;
    const lat = (body.pos?.lat as number | undefined) ?? null;
    const lon = (body.pos?.lon as number | undefined) ?? null;
    this.addEvent(`sos-${body.uid}-${sosAt}`, body, {type: 'sos', active: !!active, at: sosAt, lat, lon}, 0);
  }

  /** The caller's own SOS state: a solo watch has no row of its own to read it from. */
  private selfSos(uid: number) {
    const state = this.ctx.storage.sql
      .exec<{active: number; changed_at: number}>('SELECT active, changed_at FROM sos_state WHERE uid = ?', uid)
      .toArray()[0];
    return {sos: state?.active === 1, sosAt: state?.changed_at ?? 0};
  }

  private addEvent(id: string, who: SyncBody, body: Record<string, unknown>, to: number) {
    this.ctx.storage.sql.exec(
      'INSERT OR IGNORE INTO events (id, uid, sender, to_uid, at, body) VALUES (?, ?, ?, ?, ?, ?)',
      id, who.uid, who.name, to, this.clock(), JSON.stringify(body),
    );
  }

  private riders(body: SyncBody, now: number) {
    return this.ctx.storage.sql
      .exec<RiderRow>(
        `SELECT r.uid, r.source, r.name, r.pos, r.seen_at,
           COALESCE(s.active, 0) AS sos, COALESCE(s.changed_at, 0) AS sos_at
         FROM riders r LEFT JOIN sos_state s ON s.uid = r.uid
         WHERE r.seen_at >= ? AND NOT (r.uid = ? AND r.source = ?)`,
        now - RIDER_TTL_MS, body.uid, body.source,
      )
      .toArray()
      .map(r => ({
        uid: r.uid, name: r.name, source: r.source,
        pos: r.pos ? JSON.parse(r.pos) : null, sos: r.sos === 1, sosAt: r.sos_at, seenAt: r.seen_at,
      }));
  }

  private events(body: SyncBody, now: number) {
    const sql = this.ctx.storage.sql;
    const cursor = body.cursor;
    let rows;
    if (cursor > 0) {
      // A cursor from another epoch predates a wipe: send everything retained.
      const after = Math.floor(cursor / EPOCH_UNIT) === this.epoch() ? cursor % EPOCH_UNIT : 0;
      rows = sql.exec<EventRow>(
        'SELECT * FROM events WHERE seq > ? AND uid != ? AND to_uid IN (0, ?) ORDER BY seq',
        after, body.uid, body.uid);
    } else {
      rows = sql.exec<EventRow>(
        'SELECT * FROM events WHERE at >= ? AND uid != ? AND to_uid IN (0, ?) ORDER BY seq',
        now - FIRST_SYNC_WINDOW_MS, body.uid, body.uid);
    }
    return rows.toArray().map(e => ({...JSON.parse(e.body), seq: e.seq, id: e.id, uid: e.uid, from: e.sender, to: e.to_uid, sentAt: e.at}));
  }

  private keepAlarm(now: number) {
    if (now - this.alarmSetAt < ALARM_REFRESH_MS) return;
    this.alarmSetAt = now;
    void this.ctx.storage.setAlarm(Date.now() + WIPE_AFTER_MS);
  }

  /** Runs one hour after the last refresh: nobody has synced since. */
  async alarm() {
    await this.ctx.storage.deleteAll();
    this.lastClipAt.clear();
    this.alarmSetAt = 0;
  }
}

function badRequest(reason: string): Response {
  return new Response(reason, {status: 400});
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** Checks the fields the relay relies on and fills the optional ones. */
function isSyncBody(v: unknown): v is SyncBody {
  if (!isObject(v)) return false;
  if (typeof v.uid !== 'number' || !Number.isFinite(v.uid)) return false;
  if (v.source !== 'phone' && v.source !== 'watch') return false;
  if (v.events === undefined || v.events === null) v.events = [];
  if (!Array.isArray(v.events) || !v.events.every(e => isObject(e) && typeof e.id === 'string')) return false;
  if (typeof v.cursor !== 'number' || !Number.isFinite(v.cursor) || v.cursor < 0) v.cursor = 0;
  if (!isObject(v.pos)) v.pos = null;
  if (typeof v.sosAt !== 'number' || !Number.isFinite(v.sosAt) || v.sosAt < 0) v.sosAt = 0;
  if (typeof v.name !== 'string') v.name = '';
  return true;
}

function isClipBody(v: unknown): v is ClipBody {
  return isObject(v) && typeof v.id === 'string' && typeof v.data === 'string'
    && typeof v.uid === 'number' && Number.isFinite(v.uid);
}
