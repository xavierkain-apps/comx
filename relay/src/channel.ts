import {DurableObject} from 'cloudflare:workers';
import type {Env} from './index';

const RIDER_TTL_MS = 120_000;
const EVENT_TTL_MS = 15 * 60_000;
const MAX_EVENTS = 200;
const FIRST_SYNC_WINDOW_MS = 120_000;
const MIN_SYNC_GAP_MS = 1_000;
const WIPE_AFTER_MS = 60 * 60_000;
const ALARM_REFRESH_MS = 5 * 60_000;

interface SyncBody {
  uid: number;
  name: string;
  source: 'phone' | 'watch';
  pos: Record<string, unknown> | null;
  sos: boolean;
  cursor: number;
  events: (Record<string, unknown> & {id: string; to?: number})[];
}

type RiderRow = {uid: number; source: string; name: string; pos: string | null; sos: number; seen_at: number};
type EventRow = {seq: number; id: string; uid: number; sender: string; to_uid: number; body: string};

export class Channel extends DurableObject<Env> {
  /** Replaced in tests. */
  clock: () => number = Date.now;
  private alarmSetAt = 0;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    ctx.storage.sql.exec(`
      CREATE TABLE IF NOT EXISTS riders (
        uid INTEGER, source TEXT, name TEXT, pos TEXT, sos INTEGER, seen_at INTEGER,
        PRIMARY KEY (uid, source));
      CREATE TABLE IF NOT EXISTS events (
        seq INTEGER PRIMARY KEY AUTOINCREMENT, id TEXT UNIQUE, uid INTEGER, sender TEXT,
        to_uid INTEGER, at INTEGER, body TEXT);
    `);
  }

  async fetch(request: Request): Promise<Response> {
    const path = new URL(request.url).pathname;
    if (path.endsWith('/sync')) return this.sync((await request.json()) as SyncBody);
    return new Response('not found', {status: 404});
  }

  private sync(body: SyncBody): Response {
    const sql = this.ctx.storage.sql;
    const now = this.clock();
    const previous = sql
      .exec<RiderRow>('SELECT * FROM riders WHERE uid = ? AND source = ?', body.uid, body.source)
      .toArray()[0];
    if (previous && now - previous.seen_at < MIN_SYNC_GAP_MS) return new Response('too fast', {status: 429});

    sql.exec(
      'INSERT OR REPLACE INTO riders (uid, source, name, pos, sos, seen_at) VALUES (?, ?, ?, ?, ?, ?)',
      body.uid, body.source, body.name, body.pos ? JSON.stringify(body.pos) : null, body.sos ? 1 : 0, now,
    );

    if (!!previous?.sos !== !!body.sos) {
      const lat = (body.pos?.lat as number | undefined) ?? null;
      const lon = (body.pos?.lon as number | undefined) ?? null;
      this.addEvent(`sos-${body.uid}-${now}`, body, {type: 'sos', active: !!body.sos, lat, lon}, 0);
    }
    const acked: string[] = [];
    for (const e of body.events ?? []) {
      const {id, to, ...rest} = e;
      this.addEvent(id, body, rest, to ?? 0);
      acked.push(id);
    }

    sql.exec('DELETE FROM events WHERE at < ?', now - EVENT_TTL_MS);
    sql.exec('DELETE FROM events WHERE seq <= (SELECT MAX(seq) FROM events) - ?', MAX_EVENTS);
    this.keepAlarm(now);

    return Response.json({
      now,
      riders: this.riders(body, now),
      events: this.events(body, now),
      cursor: sql.exec<{c: number}>('SELECT COALESCE(MAX(seq), 0) AS c FROM events').one().c,
      acked,
    });
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
        'SELECT * FROM riders WHERE seen_at >= ? AND NOT (uid = ? AND source = ?)',
        now - RIDER_TTL_MS, body.uid, body.source,
      )
      .toArray()
      .map(r => ({
        uid: r.uid, name: r.name, source: r.source,
        pos: r.pos ? JSON.parse(r.pos) : null, sos: r.sos === 1, seenAt: r.seen_at,
      }));
  }

  private events(body: SyncBody, now: number) {
    const sql = this.ctx.storage.sql;
    const rows = body.cursor > 0
      ? sql.exec<EventRow>(
          'SELECT * FROM events WHERE seq > ? AND uid != ? AND to_uid IN (0, ?) ORDER BY seq',
          body.cursor, body.uid, body.uid)
      : sql.exec<EventRow>(
          'SELECT * FROM events WHERE at >= ? AND uid != ? AND to_uid IN (0, ?) ORDER BY seq',
          now - FIRST_SYNC_WINDOW_MS, body.uid, body.uid);
    return rows.toArray().map(e => ({seq: e.seq, id: e.id, uid: e.uid, from: e.sender, to: e.to_uid, ...JSON.parse(e.body)}));
  }

  private keepAlarm(now: number) {
    if (now - this.alarmSetAt < ALARM_REFRESH_MS) return;
    this.alarmSetAt = now;
    void this.ctx.storage.setAlarm(Date.now() + WIPE_AFTER_MS);
  }

  /** Runs one hour after the last refresh: nobody has synced since. */
  async alarm() {
    await this.ctx.storage.deleteAll();
  }
}
