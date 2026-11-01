# ComX watch solo mode Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** An Apple Watch with its own network keeps sharing its GPS position, seeing the group, and sending and receiving quick messages, SOS and voice memos when its phone stays on the beach.

**Architecture:** A Cloudflare Worker with one SQLite Durable Object per channel keeps riders, events and clips. Phones keep Agora and also sync with the relay every 5 s. A watch that loses its phone switches to solo mode: own GPS, and an HTTPS sync every 10 s.

**Tech Stack:** TypeScript, Cloudflare Workers and Durable Objects, Wrangler, Vitest; React Native (Jest); SwiftUI, CoreLocation, URLSession (watchOS 10+).

**Spec:** `docs/superpowers/specs/2026-11-01-comx-watch-solo-design.md`.

---

## Rules for every task

- Read `CLAUDE.md` first. No `Co-Authored-By` or AI attribution in commits.
- Never commit `.env`, tokens or the relay key, and never print them.
- Never send a real SOS. A demo SOS is cancelled at once, and only on a test channel.
- The Cloudflare zone `frenchrdv.com` is a client site: nothing here touches it.
- `ios/SoarXVoice.xcodeproj/project.pbxproj` only changes through
  `scripts/add-watch-target.rb`. After `pod install`, run
  `git checkout -- ios/Podfile.lock ios/SoarXVoice.xcodeproj/project.pbxproj`
  once the local build is done, unless the task changed the project on purpose.
- Local checks: `npx tsc --noEmit`, `npx eslint src --quiet`, `npx jest --maxWorkers=1`.

## File structure

| File | Responsibility |
|---|---|
| `relay/src/index.ts` | Worker: routing and key check |
| `relay/src/channel.ts` | Durable Object: all channel logic and storage |
| `relay/test/channel.test.ts` | Relay tests |
| `relay/wrangler.toml`, `relay/package.json`, `relay/tsconfig.json`, `relay/vitest.config.ts` | Relay project |
| `.github/workflows/relay-deploy.yml` | Tests on PRs, deploy on `main` |
| `src/ride/relay.ts` | Pure: wire types, channel key, rider merge, seen ids |
| `src/ride/__tests__/relay.test.ts` | Tests of the above |
| `src/services/relayClient.ts` | Phone HTTP calls |
| `src/contexts/RideContext.tsx` | Phone sync loop, merged riders, events |
| `src/contexts/MemoContext.tsx` | Phone clips to and from the relay |
| `src/contexts/WatchContext.tsx` | Relay settings in the watch state |
| `ios/SoarXVoiceWatch/RelayClient.swift` | Watch HTTP calls and wire types |
| `ios/SoarXVoiceWatch/SoloLink.swift` | Solo sync loop, queues, rider merge, geometry |
| `ios/SoarXVoiceWatch/Sensors.swift` | `SoloLocation`: watch GPS |
| `ios/SoarXVoiceWatch/AppModel.swift` | Phone and solo modes, routing |
| `ios/SoarXVoiceWatch/Protocol.swift` | `relay` in the phone state |
| `ios/SoarXVoiceWatch/Views.swift` | Status row |

## Changes from the spec, found while planning

Task 0 records them in the spec:

1. Clip bodies are JSON with base64 (`data`), not raw audio: React Native `fetch`
   has no reliable binary upload or `arrayBuffer`. The limit is 350,000 base64
   characters, about 256 KB of audio. Clips also carry `ext`.
2. SOS needs no `mid`: `receiveSos` already ignores repeats. Only `text` gets one.
3. Relay events are not delivered between a phone and a watch with the same
   uid, as they are one rider.

---

### Task 0: Prerequisites

**Files:**
- Modify: `docs/superpowers/specs/2026-11-01-comx-watch-solo-design.md`

- [ ] **Step 1: Owner actions (stop and ask if missing)**

PR #4 merged into `main`. In the Cloudflare dashboard, the `workers.dev`
subdomain chosen, and a token created with *Account > Workers Scripts > Edit*.
Repository secrets set by the owner: `CLOUDFLARE_API_TOKEN`,
`CLOUDFLARE_ACCOUNT_ID`, `COMX_RELAY_KEY` (from `openssl rand -hex 32`).

- [ ] **Step 2: Rebase on main**

```bash
git fetch origin
git rebase origin/main
```

Expected: `ios/SoarXVoiceWatch/AppModel.swift` contains `keepSessionAlive`.

- [ ] **Step 3: Record the three changes in the spec**

In section *Clips* replace the upload and download bullets with:

```markdown
- `POST /v1/channels/{channelKey}/clips`, JSON body
  `{"id", "uid", "from", "to", "durationMs", "ext", "data"}`, `data` being the
  audio in base64, 350,000 characters at most. Stored in SQLite.
- `GET /v1/channels/{channelKey}/clips/{id}` returns the same fields.
```

In *Identity and merging riders*, replace "Quick messages and SOS sent by a phone
go out on both, so `text` and `sos` stream messages gain a message id" with
"Quick messages sent by a phone go out on both, so `text` stream messages gain a
message id; SOS repeats are already ignored". Add to the *sync* bullets:
"Events are not returned to a client with the sender's uid: a phone and its
watch are one rider."

- [ ] **Step 4: Commit**

```bash
git add docs/superpowers/specs/2026-11-01-comx-watch-solo-design.md
git commit -m "docs: relay clips as JSON, SOS without message ids"
```

---

### Task 1: Relay project and first deployment

Proves Durable Objects work on this account before anything depends on them.

**Files:**
- Create: `relay/package.json`, `relay/tsconfig.json`, `relay/wrangler.toml`, `relay/vitest.config.ts`, `relay/src/index.ts`, `relay/src/channel.ts`, `relay/test/channel.test.ts`, `relay/.gitignore`
- Modify: `tsconfig.json`, `jest.config.js`, `.eslintignore` (create if absent)

- [ ] **Step 1: Project files**

`relay/package.json`:

```json
{
  "name": "comx-relay",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "wrangler dev --port 8787",
    "test": "vitest run",
    "typecheck": "tsc --noEmit",
    "deploy": "wrangler deploy"
  }
}
```

```bash
cd relay
npm i -D wrangler @cloudflare/workers-types @cloudflare/vitest-pool-workers vitest typescript
```

`relay/wrangler.toml` (the date is the day of implementation):

```toml
name = "comx-relay"
main = "src/index.ts"
compatibility_date = "2026-11-01"

[[durable_objects.bindings]]
name = "CHANNEL"
class_name = "Channel"

[[migrations]]
tag = "v1"
new_sqlite_classes = ["Channel"]
```

`relay/tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ES2022",
    "moduleResolution": "bundler",
    "strict": true,
    "noEmit": true,
    "skipLibCheck": true,
    "types": ["@cloudflare/workers-types", "@cloudflare/vitest-pool-workers"]
  },
  "include": ["src", "test"]
}
```

`relay/vitest.config.ts`:

```ts
import {defineWorkersConfig} from '@cloudflare/vitest-pool-workers/config';

export default defineWorkersConfig({
  test: {
    poolOptions: {
      workers: {
        wrangler: {configPath: './wrangler.toml'},
        miniflare: {bindings: {RELAY_KEY: 'test-key'}},
      },
    },
  },
});
```

`relay/.gitignore`:

```
node_modules
.wrangler
.dev.vars
```

- [ ] **Step 2: Keep the app tooling out of `relay/`**

In the root `tsconfig.json`: `"exclude": ["**/node_modules", "**/Pods", "relay"]`.
In `jest.config.js` add `testPathIgnorePatterns: ['/node_modules/', '/relay/']`.
Add a line `relay/` to `.eslintignore`.

- [ ] **Step 3: Write the failing test**

`relay/test/channel.test.ts`:

```ts
import {SELF} from 'cloudflare:test';
import {describe, expect, it} from 'vitest';

const KEY = 'a'.repeat(64);

function post(path: string, body: unknown, key = 'test-key') {
  return SELF.fetch(`https://relay.test${path}`, {
    method: 'POST',
    headers: {'content-type': 'application/json', 'x-comx-key': key},
    body: JSON.stringify(body),
  });
}

function syncBody(uid: number, extra: object = {}) {
  return {uid, name: `R${uid}`, source: 'phone', pos: null, sos: false, cursor: 0, events: [], ...extra};
}

describe('routing', () => {
  it('refuses a wrong key', async () => {
    const res = await post(`/v1/channels/${KEY}/sync`, syncBody(1), 'nope');
    expect(res.status).toBe(401);
  });

  it('refuses an unknown path', async () => {
    const res = await post('/v1/nothing', {});
    expect(res.status).toBe(404);
  });

  it('answers a sync', async () => {
    const res = await post(`/v1/channels/${KEY}/sync`, syncBody(1));
    expect(res.status).toBe(200);
    const body = (await res.json()) as {riders: unknown[]; cursor: number};
    expect(body.riders).toEqual([]);
    expect(body.cursor).toBe(0);
  });
});
```

- [ ] **Step 4: Run it to see it fail**

Run: `cd relay && npm test`
Expected: FAIL, `src/index.ts` not found.

- [ ] **Step 5: Implement the Worker and a minimal Durable Object**

`relay/src/index.ts`:

```ts
import {Channel} from './channel';

export {Channel};

export interface Env {
  CHANNEL: DurableObjectNamespace<Channel>;
  RELAY_KEY: string;
}

const ROUTE = /^\/v1\/channels\/([0-9a-f]{64})\/(sync|clips(?:\/[\w-]+)?)$/;

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (request.headers.get('x-comx-key') !== env.RELAY_KEY) {
      return new Response('unauthorized', {status: 401});
    }
    const match = ROUTE.exec(new URL(request.url).pathname);
    if (!match) return new Response('not found', {status: 404});
    const stub = env.CHANNEL.get(env.CHANNEL.idFromName(match[1]));
    return stub.fetch(request);
  },
};
```

`relay/src/channel.ts`:

```ts
import {DurableObject} from 'cloudflare:workers';
import type {Env} from './index';

export class Channel extends DurableObject<Env> {
  /** Replaced in tests. */
  clock: () => number = Date.now;

  async fetch(_request: Request): Promise<Response> {
    return Response.json({now: this.clock(), riders: [], events: [], cursor: 0, acked: []});
  }
}
```

- [ ] **Step 6: Run the tests**

Run: `cd relay && npm test && npm run typecheck`
Expected: 3 tests pass, no type errors.

- [ ] **Step 7: Prove it on the owner's account**

The owner provides the token in their own terminal; never paste it in chat.

```bash
cd relay
CLOUDFLARE_API_TOKEN=... CLOUDFLARE_ACCOUNT_ID=... npx wrangler deploy
CLOUDFLARE_API_TOKEN=... CLOUDFLARE_ACCOUNT_ID=... npx wrangler secret put RELAY_KEY
```

Then, with `URL` and `KEY` set in the shell:

```bash
curl -s -X POST "$URL/v1/channels/$(printf 'a%.0s' {1..64})/sync" -H "x-comx-key: $KEY" -d '{}'
```

Expected: JSON with `riders`. If the deploy refuses Durable Objects, stop and tell the owner: the design depends on them.

- [ ] **Step 8: Commit**

```bash
git add relay tsconfig.json jest.config.js .eslintignore
git commit -m "feat(relay): Cloudflare Worker and channel Durable Object"
```

---

### Task 2: Relay sync

**Files:**
- Modify: `relay/src/channel.ts`, `relay/test/channel.test.ts`

- [ ] **Step 1: Write the failing tests**

Append to `relay/test/channel.test.ts`. `at()` sets the Durable Object clock, so
tests never wait. `channelFor` gives each test its own channel:

```ts
import {env, runInDurableObject} from 'cloudflare:test';
import type {Channel} from '../src/channel';

let nextChannel = 1;
const channelFor = () => (nextChannel++).toString(16).padStart(64, '0');

async function at(key: string, time: number) {
  const stub = env.CHANNEL.get(env.CHANNEL.idFromName(key));
  await runInDurableObject(stub, (c: Channel) => {
    c.clock = () => time;
  });
}

async function sync(key: string, body: object) {
  const res = await post(`/v1/channels/${key}/sync`, body);
  return {status: res.status, body: (await res.json().catch(() => null)) as any};
}

const pos = (t: number) => ({lat: 36, lon: -5.6, cog: null, sog: null, acc: 5, t});

describe('sync', () => {
  it('returns the other riders with both sources of a uid', async () => {
    const key = channelFor();
    await at(key, 10_000);
    await sync(key, syncBody(1, {pos: pos(9_000)}));
    await sync(key, syncBody(1, {source: 'watch', pos: pos(9_500)}));
    const {body} = await sync(key, syncBody(2));
    expect(body.riders.map((r: any) => [r.uid, r.source]).sort()).toEqual([[1, 'phone'], [1, 'watch']]);
  });

  it('shows a client its own other source, not its own row', async () => {
    const key = channelFor();
    await at(key, 10_000);
    await sync(key, syncBody(1, {source: 'watch'}));
    const {body} = await sync(key, syncBody(1));
    expect(body.riders.map((r: any) => r.source)).toEqual(['watch']);
  });

  it('drops riders not seen for 2 minutes', async () => {
    const key = channelFor();
    await at(key, 10_000);
    await sync(key, syncBody(1));
    await at(key, 10_000 + 120_001);
    const {body} = await sync(key, syncBody(2));
    expect(body.riders).toEqual([]);
  });

  it('delivers an event once, not to the sender', async () => {
    const key = channelFor();
    await at(key, 10_000);
    const first = await sync(key, syncBody(2));
    const event = {id: 'e1', type: 'text', msg: 'ok', text: 'All good'};
    await at(key, 12_000);
    const sent = await sync(key, syncBody(1, {events: [event]}));
    expect(sent.body.acked).toEqual(['e1']);
    expect(sent.body.events).toEqual([]);
    await at(key, 14_000);
    const got = await sync(key, syncBody(2, {cursor: first.body.cursor}));
    expect(got.body.events.map((e: any) => [e.id, e.uid, e.from, e.msg])).toEqual([['e1', 1, 'R1', 'ok']]);
    await at(key, 16_000);
    const again = await sync(key, syncBody(2, {cursor: got.body.cursor}));
    expect(again.body.events).toEqual([]);
  });

  it('does not store a resent id twice, and still acknowledges it', async () => {
    const key = channelFor();
    const event = {id: 'e1', type: 'text', msg: 'ok', text: 'All good'};
    await at(key, 10_000);
    await sync(key, syncBody(1, {events: [event]}));
    await at(key, 12_000);
    const resent = await sync(key, syncBody(1, {events: [event]}));
    expect(resent.body.acked).toEqual(['e1']);
    await at(key, 14_000);
    const got = await sync(key, syncBody(2));
    expect(got.body.events).toHaveLength(1);
  });

  it('gives a first sync only the last 2 minutes', async () => {
    const key = channelFor();
    await at(key, 10_000);
    await sync(key, syncBody(1, {events: [{id: 'old', type: 'text', msg: 'ok', text: 'x'}]}));
    await at(key, 10_000 + 120_001);
    await sync(key, syncBody(1, {events: [{id: 'new', type: 'text', msg: 'ok', text: 'x'}]}));
    await at(key, 10_000 + 122_000);
    const {body} = await sync(key, syncBody(2));
    expect(body.events.map((e: any) => e.id)).toEqual(['new']);
  });

  it('keeps private events for their recipient', async () => {
    const key = channelFor();
    await at(key, 10_000);
    await sync(key, syncBody(1, {events: [{id: 'p', type: 'text', msg: 'ok', text: 'x', to: 3}]}));
    await at(key, 12_000);
    expect((await sync(key, syncBody(2))).body.events).toEqual([]);
    expect((await sync(key, syncBody(3))).body.events).toHaveLength(1);
  });

  it('adds a sos event when the state changes, once', async () => {
    const key = channelFor();
    await at(key, 10_000);
    await sync(key, syncBody(1, {sos: false}));
    await at(key, 12_000);
    await sync(key, syncBody(1, {sos: true, pos: pos(11_000)}));
    await at(key, 14_000);
    await sync(key, syncBody(1, {sos: true}));
    await at(key, 16_000);
    const {body} = await sync(key, syncBody(2));
    expect(body.riders[0].sos).toBe(true);
    expect(body.events.filter((e: any) => e.type === 'sos').map((e: any) => e.active)).toEqual([true]);
  });

  it('refuses a second sync within 1 s', async () => {
    const key = channelFor();
    await at(key, 10_000);
    await sync(key, syncBody(1));
    await at(key, 10_500);
    expect((await sync(key, syncBody(1))).status).toBe(429);
  });
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `cd relay && npm test`
Expected: the `sync` tests FAIL.

- [ ] **Step 3: Implement**

Replace `relay/src/channel.ts`:

```ts
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
```

`keepAlarm` uses the real clock because alarms do.

- [ ] **Step 4: Run the tests**

Run: `cd relay && npm test && npm run typecheck`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add relay
git commit -m "feat(relay): sync of riders and events"
```

---

### Task 3: Relay clips and expiry

**Files:**
- Modify: `relay/src/channel.ts`, `relay/test/channel.test.ts`

- [ ] **Step 1: Write the failing tests**

Append to `relay/test/channel.test.ts`:

```ts
const clip = (id: string, extra: object = {}) => ({
  id, uid: 1, from: 'R1', to: 0, durationMs: 3100, ext: 'm4a', data: 'QUJD', ...extra,
});

async function getClip(key: string, id: string) {
  return SELF.fetch(`https://relay.test/v1/channels/${key}/clips/${id}`, {headers: {'x-comx-key': 'test-key'}});
}

describe('clips', () => {
  it('stores a clip and announces it', async () => {
    const key = channelFor();
    await at(key, 10_000);
    expect((await post(`/v1/channels/${key}/clips`, clip('c1'))).status).toBe(200);
    expect(await (await getClip(key, 'c1')).json()).toMatchObject({id: 'c1', data: 'QUJD', ext: 'm4a'});
    await at(key, 12_000);
    const {body} = await sync(key, syncBody(2));
    expect(body.events[0]).toMatchObject({id: 'c1', type: 'clip', clip: 'c1', durationMs: 3100, ext: 'm4a', from: 'R1'});
  });

  it('refuses a clip over the limit', async () => {
    const key = channelFor();
    await at(key, 10_000);
    const res = await post(`/v1/channels/${key}/clips`, clip('big', {data: 'A'.repeat(350_001)}));
    expect(res.status).toBe(413);
  });

  it('refuses a second clip from a rider within 3 s', async () => {
    const key = channelFor();
    await at(key, 10_000);
    await post(`/v1/channels/${key}/clips`, clip('c1'));
    await at(key, 12_000);
    expect((await post(`/v1/channels/${key}/clips`, clip('c2'))).status).toBe(429);
  });

  it('forgets clips after 15 minutes', async () => {
    const key = channelFor();
    await at(key, 10_000);
    await post(`/v1/channels/${key}/clips`, clip('c1'));
    await at(key, 10_000 + 15 * 60_000 + 1);
    await sync(key, syncBody(2));
    expect((await getClip(key, 'c1')).status).toBe(404);
  });

  it('wipes the channel when the alarm fires', async () => {
    const key = channelFor();
    await at(key, 10_000);
    await sync(key, syncBody(1));
    const stub = env.CHANNEL.get(env.CHANNEL.idFromName(key));
    await runInDurableObject(stub, (c: Channel) => c.alarm());
    await at(key, 20_000);
    expect((await sync(key, syncBody(2))).body.riders).toEqual([]);
  });
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `cd relay && npm test`
Expected: the `clips` tests FAIL.

- [ ] **Step 3: Implement**

The alarm test wipes the tables, so the schema moves to a method that runs on
every request. In `relay/src/channel.ts`, delete the constructor and add:

```ts
const MAX_CLIP_CHARS = 350_000;
const MIN_CLIP_GAP_MS = 3_000;

interface ClipBody {
  id: string; uid: number; from: string; to: number; durationMs: number; ext: string; data: string;
}
```

```ts
  private lastClipAt = new Map<number, number>();

  private ensureSchema() {
    this.ctx.storage.sql.exec(`
      CREATE TABLE IF NOT EXISTS riders (
        uid INTEGER, source TEXT, name TEXT, pos TEXT, sos INTEGER, seen_at INTEGER,
        PRIMARY KEY (uid, source));
      CREATE TABLE IF NOT EXISTS events (
        seq INTEGER PRIMARY KEY AUTOINCREMENT, id TEXT UNIQUE, uid INTEGER, sender TEXT,
        to_uid INTEGER, at INTEGER, body TEXT);
      CREATE TABLE IF NOT EXISTS clips (id TEXT PRIMARY KEY, at INTEGER, body TEXT);
    `);
  }

  async fetch(request: Request): Promise<Response> {
    this.ensureSchema();
    const path = new URL(request.url).pathname;
    if (path.endsWith('/sync')) return this.sync((await request.json()) as SyncBody);
    if (path.endsWith('/clips')) return this.putClip((await request.json()) as ClipBody);
    return this.getClip(path.split('/').pop() ?? '');
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
```

In `sync`, next to the event cleanup add:

```ts
    sql.exec('DELETE FROM clips WHERE at < ?', now - EVENT_TTL_MS);
```

In `alarm()` also reset the memory:

```ts
  async alarm() {
    await this.ctx.storage.deleteAll();
    this.lastClipAt.clear();
    this.alarmSetAt = 0;
  }
```

- [ ] **Step 4: Run the tests**

Run: `cd relay && npm test && npm run typecheck`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add relay
git commit -m "feat(relay): clips, limits and expiry"
```

---

### Task 4: Relay CI and deployment

**Files:**
- Create: `.github/workflows/relay-deploy.yml`

- [ ] **Step 1: Workflow**

```yaml
name: Relay

on:
  pull_request:
    paths: ['relay/**']
  push:
    branches: [main]
    paths: ['relay/**']

jobs:
  relay:
    runs-on: ubuntu-latest
    defaults:
      run:
        working-directory: relay
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
      - run: npm ci
      - run: npm run typecheck
      - run: npm test
      - if: github.event_name == 'push'
        uses: cloudflare/wrangler-action@v3
        with:
          workingDirectory: relay
          apiToken: ${{ secrets.CLOUDFLARE_API_TOKEN }}
          accountId: ${{ secrets.CLOUDFLARE_ACCOUNT_ID }}
          secrets: RELAY_KEY
        env:
          RELAY_KEY: ${{ secrets.COMX_RELAY_KEY }}
```

- [ ] **Step 2: Commit**

```bash
git add .github/workflows/relay-deploy.yml relay/package-lock.json
git commit -m "ci: test and deploy the relay"
```

---

### Task 5: Pure relay logic for the phone

**Files:**
- Create: `src/ride/relay.ts`, `src/ride/__tests__/relay.test.ts`
- Modify: `package.json` (`js-sha256`), `src/ride/protocol.ts`, `src/ride/__tests__/protocol.test.ts`

- [ ] **Step 1: Add the hash dependency**

```bash
npm i js-sha256
```

- [ ] **Step 2: Write the failing tests**

`src/ride/__tests__/relay.test.ts`:

```ts
import {SeenIds, channelKey, mergeRelayRiders, pickPosition, hasSoloRider, WATCH_FIX_MAX_AGE_MS} from '../relay';
import {parseStreamMessage, Position} from '../protocol';

const pos = (t: number, lat = 36): Position => ({lat, lon: -5.6, cog: null, sog: null, acc: 5, t});

describe('channelKey', () => {
  it('is the hash of the upper-case name', () => {
    expect(channelKey('tarifa-01')).toBe(channelKey('TARIFA-01'));
    expect(channelKey('TARIFA-01')).toMatch(/^[0-9a-f]{64}$/);
    expect(channelKey('TARIFA-02')).not.toBe(channelKey('TARIFA-01'));
  });
});

describe('pickPosition', () => {
  const now = 100_000;

  it('prefers a fresh watch fix over a newer phone fix', () => {
    expect(pickPosition(pos(now, 1), pos(now - 5_000, 2), now)?.lat).toBe(2);
  });

  it('uses the newest fix once the watch fix is too old', () => {
    const old = pos(now - WATCH_FIX_MAX_AGE_MS - 1, 2);
    expect(pickPosition(pos(now, 1), old, now)?.lat).toBe(1);
    expect(pickPosition(pos(now - WATCH_FIX_MAX_AGE_MS - 5_000, 1), old, now)?.lat).toBe(2);
  });

  it('copes with a missing side', () => {
    expect(pickPosition(undefined, undefined, now)).toBeUndefined();
    expect(pickPosition(pos(5), undefined, now)?.t).toBe(5);
    expect(pickPosition(undefined, pos(5), now)?.t).toBe(5);
  });
});

describe('mergeRelayRiders', () => {
  it('groups both sources of a uid', () => {
    const merged = mergeRelayRiders([
      {uid: 1, name: 'A', source: 'phone', pos: pos(1), sos: false, seenAt: 1},
      {uid: 1, name: 'A', source: 'watch', pos: pos(2), sos: true, seenAt: 2},
    ]);
    expect(merged[1].phone?.t).toBe(1);
    expect(merged[1].watch?.t).toBe(2);
    expect(merged[1].sos).toBe(true);
    expect(merged[1].name).toBe('A');
  });
});

describe('hasSoloRider', () => {
  it('needs a watch seen in the last 30 s', () => {
    const rider = (seenAt: number) => ({uid: 1, name: 'A', source: 'watch' as const, pos: null, sos: false, seenAt});
    expect(hasSoloRider([rider(90_000)], 100_000)).toBe(true);
    expect(hasSoloRider([rider(60_000)], 100_000)).toBe(false);
    expect(hasSoloRider([{...rider(90_000), source: 'phone'}], 100_000)).toBe(false);
  });
});

describe('SeenIds', () => {
  it('reports an id once', () => {
    const seen = new SeenIds();
    expect(seen.firstTime('a')).toBe(true);
    expect(seen.firstTime('a')).toBe(false);
  });

  it('forgets the oldest past its size', () => {
    const seen = new SeenIds(2);
    seen.firstTime('a');
    seen.firstTime('b');
    seen.firstTime('c');
    expect(seen.firstTime('a')).toBe(true);
  });
});

describe('text message id', () => {
  it('keeps mid when present', () => {
    expect(parseStreamMessage({type: 'text', id: 'ok', text: 'x', mid: 'm1'})).toEqual({type: 'text', id: 'ok', text: 'x', mid: 'm1'});
  });
});
```

- [ ] **Step 3: Run them to see them fail**

Run: `npx jest --maxWorkers=1 src/ride/__tests__/relay.test.ts`
Expected: FAIL, module `../relay` not found.

- [ ] **Step 4: Implement**

`src/ride/relay.ts`:

```ts
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
```

In `src/ride/protocol.ts`:

```ts
// StreamMessage
  | {type: 'text'; id: string; text: string; mid?: string}
```

```ts
// parseStreamMessage, case 'text'
      if (typeof m.text !== 'string' || m.text.length === 0) return null;
      return {
        type: 'text',
        id: typeof m.id === 'string' ? m.id : 'custom',
        text: m.text.slice(0, 200),
        ...(typeof m.mid === 'string' ? {mid: m.mid} : {}),
      };
```

- [ ] **Step 5: Run the tests**

Run: `npx jest --maxWorkers=1 && npx tsc --noEmit`
Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add src/ride package.json package-lock.json
git commit -m "feat(ride): relay types, position pick and channel key"
```

---

### Task 6: Phone relay client and sync loop

**Files:**
- Create: `src/services/relayClient.ts`
- Modify: `src/types/env.d.ts`, `.env.example`, `.github/workflows/comx-testflight.yml`, `src/contexts/RideContext.tsx`

- [ ] **Step 1: Configuration**

`src/types/env.d.ts`:

```ts
declare module '@env' {
  export const AGORA_APP_ID: string;
  export const COMX_RELAY_URL: string | undefined;
  export const COMX_RELAY_KEY: string | undefined;
}
```

Append to `.env.example`:

```
# ComX relay (watch solo mode). Empty = relay off.
COMX_RELAY_URL=
COMX_RELAY_KEY=
```

In `comx-testflight.yml`, next to `AGORA_APP_ID: ${{ secrets.AGORA_APP_ID }}`
in the job's `env`, add the following, and do not add them to the `missing` list:

```yaml
          COMX_RELAY_URL: ${{ vars.COMX_RELAY_URL }}
          COMX_RELAY_KEY: ${{ secrets.COMX_RELAY_KEY }}
```

The owner adds the repository variable `COMX_RELAY_URL`.

- [ ] **Step 2: HTTP client**

`src/services/relayClient.ts`:

```ts
// HTTP calls to the ComX relay. Every call returns null on any failure: the
// callers retry at the next sync.

import {COMX_RELAY_KEY, COMX_RELAY_URL} from '@env';
import {RelayClip, SyncRequest, SyncResponse} from '../ride/relay';
import {appLog} from '../utils/logger';

const TIMEOUT_MS = 8_000;

export const relayEnabled = !!(COMX_RELAY_URL && COMX_RELAY_KEY);
export const relaySettings = {url: COMX_RELAY_URL ?? '', key: COMX_RELAY_KEY ?? ''};

async function call(path: string, init: RequestInit): Promise<Response | null> {
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(`${COMX_RELAY_URL}${path}`, {
      ...init,
      signal: abort.signal,
      headers: {'content-type': 'application/json', 'x-comx-key': COMX_RELAY_KEY ?? ''},
    });
    if (res.ok) return res;
    appLog('Relay', `${path.split('/').pop()}: HTTP ${res.status}`);
    return null;
  } catch (e) {
    appLog('Relay', `network failure: ${String(e)}`);
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export async function relaySync(channel: string, body: SyncRequest): Promise<SyncResponse | null> {
  const res = await call(`/v1/channels/${channel}/sync`, {method: 'POST', body: JSON.stringify(body)});
  return res ? ((await res.json()) as SyncResponse) : null;
}

export async function relayUploadClip(channel: string, clip: RelayClip): Promise<boolean> {
  return !!(await call(`/v1/channels/${channel}/clips`, {method: 'POST', body: JSON.stringify(clip)}));
}

export async function relayDownloadClip(channel: string, id: string): Promise<RelayClip | null> {
  const res = await call(`/v1/channels/${channel}/clips/${id}`, {method: 'GET'});
  return res ? ((await res.json()) as RelayClip) : null;
}
```

- [ ] **Step 3: Sync loop in `RideContext`**

Imports:

```ts
import {useUser} from './UserContext';
import {relayEnabled, relaySync} from '../services/relayClient';
import {
  RELAY_SYNC_MS, RelayEvent, RelayOutgoingText, RelayRider, SeenIds,
  channelKey, hasSoloRider, mergeRelayRiders, pickPosition,
} from '../ride/relay';
```

Extend the Agora
line and add state beside the other refs:

```ts
  const {connectionState, remotePilots, sendStreamJson, subscribeStream, channelName, localUid} = useAgoraContext();
  const {pilotName} = useUser();
```

```ts
  const [relayRiders, setRelayRiders] = useState<RelayRider[]>([]);
  const relayCursorRef = useRef(0);
  const relayOutboxRef = useRef<RelayOutgoingText[]>([]);
  const seenTextsRef = useRef(new SeenIds());
  const relayClipListenersRef = useRef<Set<(e: RelayClipEvent) => void>>(new Set());
```

Export the type beside `RideEvent`:

```ts
export type RelayClipEvent = Extract<RelayEvent, {type: 'clip'}>;
```

Add a stale-closure-safe handler after `receiveSosRef`, and the loop after the
*Messages from other phones* effect:

```ts
  const handleRelayEvent = (e: RelayEvent) => {
    if (e.type === 'text') {
      if (seenTextsRef.current.firstTime(e.id)) receiveTextRef.current(e.uid, e.msg, e.text);
    } else if (e.type === 'sos') {
      receiveSosRef.current(e.uid, e.active);
    } else {
      relayClipListenersRef.current.forEach(l => l(e));
    }
  };
  const handleRelayEventRef = useRef(handleRelayEvent);
  handleRelayEventRef.current = handleRelayEvent;

  // Relay: the way riders without a phone reach the group
  useEffect(() => {
    if (!relayEnabled || !connected || demo || localUid === null) return;
    const key = channelKey(channelName);
    relayCursorRef.current = 0;
    let busy = false;
    const timer = setInterval(async () => {
      if (busy) return;
      busy = true;
      const res = await relaySync(key, {
        uid: localUid, name: pilotName, source: 'phone', pos: myPositionRef.current,
        sos: mySosRef.current, cursor: relayCursorRef.current, events: relayOutboxRef.current,
      });
      busy = false;
      if (!res) return;
      relayCursorRef.current = res.cursor;
      relayOutboxRef.current = relayOutboxRef.current.filter(e => !res.acked.includes(e.id));
      setRelayRiders(res.riders);
      for (const r of res.riders) if (r.sos && r.uid !== localUid) receiveSosRef.current(r.uid, true);
      res.events.forEach(e => handleRelayEventRef.current(e));
    }, RELAY_SYNC_MS);
    return () => {
      clearInterval(timer);
      setRelayRiders([]);
    };
  }, [connected, demo, localUid, channelName, pilotName]);
```

Add to `RideContextValue` and to the provider value:

```ts
  /** Clip announcements from the relay, for MemoContext. */
  subscribeRelayClips: (listener: (e: RelayClipEvent) => void) => () => void;
  /** A rider is only reachable through the relay. */
  soloRiderPresent: boolean;
```

```ts
  const subscribeRelayClips = useCallback((listener: (e: RelayClipEvent) => void) => {
    relayClipListenersRef.current.add(listener);
    return () => {
      relayClipListenersRef.current.delete(listener);
    };
  }, []);
  const soloRiderPresent = hasSoloRider(relayRiders, now);
```

- [ ] **Step 4: Quick messages on both paths, with one id**

`receiveText` is unchanged. In the Agora `case 'text':` branch:

```ts
        case 'text':
          if (!msg.mid || seenTextsRef.current.firstTime(msg.mid)) receiveTextRef.current(uid, msg.id, msg.text);
          break;
```

In `sendQuickMessage`, replace the stream send:

```ts
    const mid = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    if (!sendStreamJson({type: 'text', id, text: body, mid}) && !demoRef.current) {
      appLog('Ride', `quick message not sent (not connected): ${id}`);
      return;
    }
    if (relayEnabled) relayOutboxRef.current.push({id: mid, type: 'text', msg: id, text: body});
```

- [ ] **Step 5: Merge riders**

Replace the top of the `riders` memo. Keep the demo part as it is:

```ts
  const relayMerged = useMemo(() => mergeRelayRiders(relayRiders), [relayRiders]);
  const me = useMemo(
    () => pickPosition(myPosition ?? undefined, localUid === null ? undefined : relayMerged[localUid]?.watch, now) ?? null,
    [myPosition, localUid, relayMerged, now],
  );

  const riders = useMemo(
    () => {
      const onAgora = new Set(remotePilots.map(p => p.uid));
      return buildRiderViews(
        me,
        [
          ...remotePilots.map(p => {
            const relay = relayMerged[p.uid];
            return {
              uid: p.uid,
              name: p.name,
              speaking: p.status === 'speaking',
              position: pickPosition(positions[p.uid] ?? relay?.phone, relay?.watch, now),
              sos: !!sosUids[p.uid] || !!relay?.sos,
            };
          }),
          ...Object.values(relayMerged)
            .filter(r => !onAgora.has(r.uid) && r.uid !== localUid)
            .map(r => ({
              uid: r.uid,
              name: r.name,
              speaking: false,
              position: pickPosition(r.phone, r.watch, now),
              sos: r.sos,
            })),
```

Add `me`, `relayMerged` and `localUid` to the memo dependencies and close the
added braces. `nameOf` must know relay-only riders. Add after `namesRef.current = …`:

```ts
  for (const r of relayRiders) namesRef.current[r.uid] ??= r.name;
```

- [ ] **Step 6: Run the checks**

Run: `npx tsc --noEmit && npx eslint src --quiet && npx jest --maxWorkers=1`
Expected: clean. The end-to-end check comes in Task 12.

- [ ] **Step 7: Commit**

```bash
git add src .env.example .github/workflows
git commit -m "feat(ride): phones sync with the relay and merge its riders"
```

---

### Task 7: Phone clips through the relay

**Files:**
- Modify: `src/contexts/MemoContext.tsx`, `src/contexts/WatchContext.tsx`, `src/ride/protocol.ts`, `src/ride/__tests__/protocol.test.ts`

- [ ] **Step 1: Write the failing protocol test**

Append to `src/ride/__tests__/protocol.test.ts`, adapting the base arguments to
those used by the file's existing `buildWatchState` test:

```ts
describe('buildWatchState relay', () => {
  const base = {connected: true, channel: 'A', watchMode: true, myName: 'X', me: null, riders: [], now: 1};

  it('passes the relay settings to the watch', () => {
    const relay = {url: 'https://r', key: 'k', channelKey: 'c', uid: 5};
    expect(buildWatchState({...base, relay}).relay).toEqual(relay);
  });

  it('sends null without them', () => {
    expect(buildWatchState(base).relay).toBeNull();
  });
});
```

Run: `npx jest --maxWorkers=1 src/ride/__tests__/protocol.test.ts`
Expected: FAIL.

- [ ] **Step 2: Add `relay` to the watch state**

In `src/ride/protocol.ts`:

```ts
export interface WatchRelaySettings {
  url: string;
  key: string;
  channelKey: string;
  uid: number;
}
```

Add `relay: WatchRelaySettings | null;` to `WatchState`, `relay?: WatchRelaySettings | null;`
to the `buildWatchState` arguments and `relay: args.relay ?? null,` to its result.

In `src/contexts/WatchContext.tsx`, add `localUid` to the `useAgoraContext()`
destructuring, import `relayEnabled` and `relaySettings` from
`'../services/relayClient'` and `channelKey` from `'../ride/relay'`, then:

```ts
  const relay = useMemo(
    () => (relayEnabled && connected && !demo && localUid !== null
      ? {...relaySettings, channelKey: channelKey(channelName), uid: localUid}
      : null),
    [connected, demo, localUid, channelName],
  );
```

and pass `relay` to `buildWatchState`.

- [ ] **Step 3: Mark clips on their first slice**

In `MemoContext.tsx`, extend the imports and hooks:

```ts
import {SeenIds, channelKey} from '../ride/relay';
import {relayDownloadClip, relayEnabled, relayUploadClip} from '../services/relayClient';
```

```ts
  const {connectionState, getEngine, sendStreamJson, subscribeStream, localUid, setMemoCapture, channelName} = useAgoraContext();
  const {riders, logMessage, demo, subscribeRelayClips, soloRiderPresent} = useRide();
  const seenClipsRef = useRef(new SeenIds());
  const soloRef = useRef(soloRiderPresent);
  soloRef.current = soloRiderPresent;
```

The stream handler marks the id before assembling, because the relay event can
arrive while slices are still coming:

```ts
      if (!chunk || !isClipForMe(chunk.to, live.current.localUid)) return;
      seenClipsRef.current.firstTime(chunk.id);
```

- [ ] **Step 4: Receive from the relay**

After the stream effect:

```ts
  useEffect(() => {
    return subscribeRelayClips(async e => {
      if (!seenClipsRef.current.firstTime(e.clip)) return;
      const clip = await relayDownloadClip(channelKey(channelName), e.clip);
      if (!clip) {
        logMessage(e.from, 'voice', 'Voice memo could not be downloaded');
        return;
      }
      deliver(e.uid, {base64: clip.data, ext: clip.ext, durationMs: clip.durationMs}, e.to !== GROUP_UID);
    });
  }, [subscribeRelayClips, channelName, deliver, logMessage]);
```

- [ ] **Step 5: Send to solo riders**

In `transmit`, replace the `chunks` lines:

```ts
    const id = newClipId(Date.now());
    const chunks = splitClip(clip.base64, id, to, clip.durationMs, clip.ext);
    chunks.forEach((chunk, i) => {
      setTimeout(() => sendStreamJson(chunk), i * CHUNK_INTERVAL_MS);
    });
    if (relayEnabled && soloRef.current && live.current.localUid !== null) {
      relayUploadClip(channelKey(channelName), {
        id, uid: live.current.localUid, from: pilotName, to,
        durationMs: clip.durationMs, ext: clip.ext, data: clip.base64,
      });
    }
```

Add `channelName` and `pilotName` (from `useUser()`, imported as in
`WatchContext.tsx`) to the callback dependencies.

- [ ] **Step 6: Run the checks**

Run: `npx tsc --noEmit && npx eslint src --quiet && npx jest --maxWorkers=1`
Expected: clean.

- [ ] **Step 7: Commit**

```bash
git add src
git commit -m "feat(memo): voice memos through the relay when a rider is solo"
```

---

### Task 8: Watch wire types and HTTP client

**Files:**
- Create: `ios/SoarXVoiceWatch/RelayClient.swift`
- Modify: `ios/SoarXVoiceWatch/Protocol.swift`, `ios/SoarXVoiceWatch/Info.plist`, `scripts/add-watch-target.rb`, `ios/SoarXVoice.xcodeproj/project.pbxproj` (through the script)

- [ ] **Step 1: Relay settings in the state**

In `Protocol.swift`, before `PhoneState`:

```swift
/// How to reach the relay; nil when the phone is not in a real channel.
struct RelaySettings: Codable, Equatable {
  var url: String
  var key: String
  var channelKey: String
  var uid: Int
}
```

Add `var relay: RelaySettings?` to `PhoneState`.

- [ ] **Step 2: HTTP client**

`ios/SoarXVoiceWatch/RelayClient.swift`:

```swift
import Foundation

// Calls to the ComX relay. watchOS allows URLSession HTTP on cellular for every
// app, but not WebSockets (Apple TN3135), so the watch polls. Completions run
// on the main queue, with nil on any failure: the caller retries next time.

struct RelayPosition: Codable {
  var lat: Double
  var lon: Double
  var cog: Double?
  var sog: Double?
  var acc: Double
  var t: Double
}

struct RelayOutEvent: Codable {
  var id: String
  var type = "text"
  var msg: String
  var text: String
}

struct SyncRequest: Encodable {
  var uid: Int
  var name: String
  var source = "watch"
  var pos: RelayPosition?
  var sos: Bool
  var cursor: Int
  var events: [RelayOutEvent]

  enum CodingKeys: String, CodingKey { case uid, name, source, pos, sos, cursor, events }

  func encode(to encoder: Encoder) throws {
    var c = encoder.container(keyedBy: CodingKeys.self)
    try c.encode(uid, forKey: .uid)
    try c.encode(name, forKey: .name)
    try c.encode(source, forKey: .source)
    try c.encode(pos, forKey: .pos) // explicit null before the first fix
    try c.encode(sos, forKey: .sos)
    try c.encode(cursor, forKey: .cursor)
    try c.encode(events, forKey: .events)
  }
}

struct RelayRider: Decodable {
  var uid: Int
  var name: String
  var source: String
  var pos: RelayPosition?
  var sos: Bool
  var seenAt: Double
}

struct RelayEvent: Decodable {
  var id: String
  var uid: Int
  var from: String
  var to: Int?
  var type: String
  var msg: String?
  var text: String?
  var active: Bool?
  var clip: String?
  var durationMs: Double?
  var ext: String?
}

struct SyncResponse: Decodable {
  var now: Double
  var riders: [RelayRider]
  var events: [RelayEvent]
  var cursor: Int
  var acked: [String]
}

struct RelayClip: Codable {
  var id: String
  var uid: Int
  var from: String
  var to: Int
  var durationMs: Int
  var ext: String
  var data: String
}

final class RelayClient {
  private let session: URLSession

  init() {
    let config = URLSessionConfiguration.ephemeral
    config.timeoutIntervalForRequest = 8
    config.timeoutIntervalForResource = 30
    config.waitsForConnectivity = false
    config.allowsCellularAccess = true
    session = URLSession(configuration: config)
  }

  func sync(_ settings: RelaySettings, _ body: SyncRequest, done: @escaping (SyncResponse?) -> Void) {
    call(settings, path: "sync", body: body, done: done)
  }

  func upload(_ settings: RelaySettings, _ clip: RelayClip, done: @escaping (Bool) -> Void) {
    send(request(settings, path: "clips", body: try? JSONEncoder().encode(clip))) { data in done(data != nil) }
  }

  func download(_ settings: RelaySettings, id: String, done: @escaping (RelayClip?) -> Void) {
    send(request(settings, path: "clips/\(id)", body: nil)) { data in
      done(data.flatMap { try? JSONDecoder().decode(RelayClip.self, from: $0) })
    }
  }

  private func call<Req: Encodable, Res: Decodable>(_ settings: RelaySettings, path: String, body: Req,
                                                    done: @escaping (Res?) -> Void) {
    send(request(settings, path: path, body: try? JSONEncoder().encode(body))) { data in
      done(data.flatMap { try? JSONDecoder().decode(Res.self, from: $0) })
    }
  }

  private func request(_ settings: RelaySettings, path: String, body: Data?) -> URLRequest? {
    guard let url = URL(string: "\(settings.url)/v1/channels/\(settings.channelKey)/\(path)") else { return nil }
    var req = URLRequest(url: url)
    req.httpMethod = body == nil ? "GET" : "POST"
    req.httpBody = body
    req.setValue("application/json", forHTTPHeaderField: "content-type")
    req.setValue(settings.key, forHTTPHeaderField: "x-comx-key")
    return req
  }

  private func send(_ request: URLRequest?, done: @escaping (Data?) -> Void) {
    guard let request = request else { return done(nil) }
    session.dataTask(with: request) { data, response, _ in
      let ok = (response as? HTTPURLResponse)?.statusCode == 200
      DispatchQueue.main.async { done(ok ? data : nil) }
    }.resume()
  }
}
```

- [ ] **Step 3: Permissions**

In `ios/SoarXVoiceWatch/Info.plist`, add to `WKBackgroundModes`:

```xml
		<string>location</string>
```

In `scripts/add-watch-target.rb`:

```ruby
  "INFOPLIST_KEY_NSLocationWhenInUseUsageDescription" =>
    "ComX uses the compass to point the arrows at the other riders, and shares your position with your group when your phone is out of reach.",
```

The simulator test uses a local relay over `http`, so add to `Info.plist`, at the
top level of the `dict`. It only allows local addresses:

```xml
	<key>NSAppTransportSecurity</key>
	<dict>
		<key>NSAllowsLocalNetworking</key>
		<true/>
	</dict>
```

- [ ] **Step 4: Add the file to the target**

```bash
ruby scripts/add-watch-target.rb
ruby scripts/add-watch-controls-target.rb
git diff --stat ios/SoarXVoice.xcodeproj/project.pbxproj
```

Expected: the project gains `RelayClient.swift`. `SoloLink.swift` from Task 9 requires another run.

- [ ] **Step 5: Build the watch app**

```bash
cd ios && LANG=en_US.UTF-8 xcodebuild -project SoarXVoice.xcodeproj -target SoarXVoiceWatch -sdk watchsimulator -configuration Debug CODE_SIGN_IDENTITY=- CODE_SIGN_STYLE=Manual DEVELOPMENT_TEAM= PROVISIONING_PROFILE_SPECIFIER= CODE_SIGNING_REQUIRED=NO SYMROOT="$PWD/../build-watch" build 2>&1 | grep -E ' error:|BUILD (SUCCEEDED|FAILED)'
```

Expected: `** BUILD SUCCEEDED **`.

- [ ] **Step 6: Commit**

```bash
git add ios scripts
git commit -m "feat(watch): relay client and wire types"
```

---

### Task 9: Solo link

No Swift test target exists, so the check is the build here and the simulator run in Task 12.

**Files:**
- Create: `ios/SoarXVoiceWatch/SoloLink.swift`
- Modify: `ios/SoarXVoiceWatch/Sensors.swift`, the project through the script

- [ ] **Step 1: Watch GPS**

Append to `Sensors.swift`:

```swift
/// The watch's own GPS, on only in solo mode: with a phone, the phone's is used.
final class SoloLocation: NSObject, CLLocationManagerDelegate {
  private(set) var last: RelayPosition?
  private let manager = CLLocationManager()

  /// Below this speed the GPS course is noise (same value as the phone).
  private static let minSpeedForCourse = 1.0

  func start() {
    manager.delegate = self
    manager.desiredAccuracy = kCLLocationAccuracyBest
    manager.activityType = .fitness
    manager.allowsBackgroundLocationUpdates = true
    manager.startUpdatingLocation()
  }

  func stop() {
    manager.stopUpdatingLocation()
    last = nil
  }

  func locationManager(_ manager: CLLocationManager, didUpdateLocations locations: [CLLocation]) {
    guard let l = locations.last, l.horizontalAccuracy >= 0 else { return }
    let sog = l.speed >= 0 ? l.speed : nil
    let cog = (sog ?? 0) >= SoloLocation.minSpeedForCourse && l.course >= 0 ? l.course : nil
    last = RelayPosition(lat: l.coordinate.latitude, lon: l.coordinate.longitude, cog: cog, sog: sog,
                         acc: l.horizontalAccuracy, t: l.timestamp.timeIntervalSince1970 * 1000)
  }

  func locationManager(_ manager: CLLocationManager, didFailWithError error: Error) {
    InputLog.shared.system("GPS error: \(error.localizedDescription)")
  }
}
```

- [ ] **Step 2: Solo link**

`ios/SoarXVoiceWatch/SoloLink.swift`:

```swift
import Foundation

// Solo mode: the watch talks to the relay itself. See "Watch modes" in
// docs/superpowers/specs/2026-11-01-comx-watch-solo-design.md.

struct QueuedClip {
  var clip: RelayClip
  var url: URL
  var to: Int?
  var ms: Int
}

final class SoloLink {
  static let syncInterval: TimeInterval = 10
  static let maxTexts = 20
  static let maxClips = 5
  /// A watch fix younger than this wins (same value as the phone).
  static let watchFixMaxAge: TimeInterval = 30

  var onResponse: ((SyncResponse, RelayPosition?) -> Void)?
  var onClipSent: (() -> Void)?
  var onTextAcked: (() -> Void)?

  private(set) var lastSyncOK: Date?
  private(set) var texts: [RelayOutEvent] = []
  private(set) var clips: [QueuedClip] = []
  var name = ""
  var sos = false

  private let client = RelayClient()
  private let location = SoloLocation()
  private var settings: RelaySettings?
  private var timer: Timer?
  private var cursor = 0
  private var syncing = false
  private var uploading = false

  func start(_ settings: RelaySettings, name: String) {
    self.settings = settings
    self.name = name
    cursor = 0
    lastSyncOK = nil
    location.start()
    tick()
    timer = Timer.scheduledTimer(withTimeInterval: SoloLink.syncInterval, repeats: true) { [weak self] _ in
      self?.tick()
    }
  }

  func stop() {
    timer?.invalidate()
    timer = nil
    location.stop()
    settings = nil
  }

  /// What is left to hand over to the phone when it comes back.
  func drain() -> (texts: [RelayOutEvent], clips: [QueuedClip]) {
    defer {
      texts = []
      clips = []
    }
    return (texts, clips)
  }

  func enqueue(text: RelayOutEvent) {
    texts.append(text)
    if texts.count > SoloLink.maxTexts { texts.removeFirst() }
    tick()
  }

  func enqueue(clip: QueuedClip) {
    clips.append(clip)
    if clips.count > SoloLink.maxClips { clips.removeFirst() }
    uploadNext()
  }

  func download(id: String, done: @escaping (RelayClip?) -> Void) {
    guard let settings = settings else { return done(nil) }
    client.download(settings, id: id, done: done)
  }

  private func tick() {
    guard let settings = settings, !syncing else { return }
    syncing = true
    let fix = location.last
    let body = SyncRequest(uid: settings.uid, name: name, pos: fix, sos: sos, cursor: cursor, events: texts)
    client.sync(settings, body) { [weak self] response in
      guard let self = self else { return }
      self.syncing = false
      guard let response = response else { return }
      self.lastSyncOK = Date()
      self.cursor = response.cursor
      self.texts.removeAll { response.acked.contains($0.id) }
      if !response.acked.isEmpty { self.onTextAcked?() }
      self.onResponse?(response, fix)
      self.uploadNext()
    }
  }

  private func uploadNext() {
    guard let settings = settings, !uploading, let next = clips.first else { return }
    uploading = true
    client.upload(settings, next.clip) { [weak self] ok in
      guard let self = self else { return }
      self.uploading = false
      guard ok else { return } // kept: the next sync tries again
      self.clips.removeAll { $0.clip.id == next.clip.id }
      self.onClipSent?()
      self.uploadNext()
    }
  }
}

enum SoloGeometry {
  static func distanceMeters(_ a: RelayPosition, _ b: RelayPosition) -> Double {
    let r = 6_371_000.0
    let dLat = (b.lat - a.lat) * .pi / 180
    let dLon = (b.lon - a.lon) * .pi / 180
    let h = sin(dLat / 2) * sin(dLat / 2)
      + cos(a.lat * .pi / 180) * cos(b.lat * .pi / 180) * sin(dLon / 2) * sin(dLon / 2)
    return 2 * r * asin(min(1, sqrt(h)))
  }

  static func bearingDegrees(_ a: RelayPosition, _ b: RelayPosition) -> Double {
    let lat1 = a.lat * .pi / 180
    let lat2 = b.lat * .pi / 180
    let dLon = (b.lon - a.lon) * .pi / 180
    let y = sin(dLon) * cos(lat2)
    let x = cos(lat1) * sin(lat2) - sin(lat1) * cos(lat2) * cos(dLon)
    return (atan2(y, x) * 180 / .pi + 360).truncatingRemainder(dividingBy: 360)
  }

  /// The riders of a relay answer, in the form the compass already draws.
  static func riders(_ response: SyncResponse, me: RelayPosition?, myUid: Int) -> [Rider] {
    let nowMs = response.now
    return Dictionary(grouping: response.riders.filter { $0.uid != myUid }, by: { $0.uid }).map { uid, rows in
      let watch = rows.first { $0.source == "watch" }?.pos
      let phone = rows.first { $0.source == "phone" }?.pos
      let pos: RelayPosition?
      if let w = watch, nowMs - w.t <= SoloLink.watchFixMaxAge * 1000 {
        pos = w
      } else {
        pos = [watch, phone].compactMap { $0 }.max { $0.t < $1.t }
      }
      let both = pos.flatMap { p in me.map { (p, $0) } }
      return Rider(uid: uid, name: rows.first?.name, lat: pos?.lat, lon: pos?.lon, t: pos?.t,
                   dist: both.map { distanceMeters($0.1, $0.0).rounded() },
                   brg: both.map { bearingDegrees($0.1, $0.0) },
                   speaking: false, sos: rows.contains { $0.sos },
                   stale: pos.map { nowMs - $0.t > 30_000 } ?? true)
    }
  }
}
```

- [ ] **Step 3: Add the file and build**

Run `ruby scripts/add-watch-target.rb && ruby scripts/add-watch-controls-target.rb`, then the build command from Task 8 Step 5.
Expected: `** BUILD SUCCEEDED **`.

- [ ] **Step 4: Commit**

```bash
git add ios
git commit -m "feat(watch): solo link, watch GPS and rider geometry"
```

---

### Task 10: Phone and solo modes in AppModel

**Files:**
- Modify: `ios/SoarXVoiceWatch/AppModel.swift`

- [ ] **Step 1: State**

Add below the existing session properties:

```swift
  enum Mode { case phone, solo }

  /// Without phone state for this long, the watch goes solo.
  static let soloAfter: TimeInterval = 15
  /// Phone state for this long ends solo mode.
  static let phoneBackAfter: TimeInterval = 5
  /// No relay answer for this long: say the position is not shared.
  static let noNetworkAfter: TimeInterval = 30
  /// *SOS sent* needs a relay answer within this time.
  static let sosConfirmAfter: TimeInterval = 15
  private static let batteryLogEvery: TimeInterval = 15 * 60
  private static let relayKey = "comx.relay"
  private static let nameKey = "comx.relayName"
  private static let channelKey = "comx.relayChannel"

  @Published private(set) var mode: Mode = .phone
  private let solo = SoloLink()
  private var relay: RelaySettings?
  private var relayName = ""
  private var relayChannel = ""
  private var phoneBackSince: Date?
  private var soloSince: Date?
  private var noNetworkAlerted = false
  private var sosPendingSince: Date?
  private var lastBatteryLog = Date.distantPast
```

- [ ] **Step 2: Load the settings and wire the link**

In `startIfNeeded`, before `link.activate()`:

```swift
    loadRelay()
    solo.onResponse = { [weak self] response, fix in self?.handleSolo(response, fix: fix) }
    solo.onClipSent = { WKInterfaceDevice.current().play(.success) }
    solo.onTextAcked = { WKInterfaceDevice.current().play(.success) }
```

Add:

```swift
  private func loadRelay() {
    let d = UserDefaults.standard
    if let data = d.data(forKey: AppModel.relayKey) {
      relay = try? JSONDecoder().decode(RelaySettings.self, from: data)
    }
    relayName = d.string(forKey: AppModel.nameKey) ?? ""
    relayChannel = d.string(forKey: AppModel.channelKey) ?? ""
  }

  /// Follows the phone: a channel gives settings, leaving it clears them.
  private func storeRelay(from s: PhoneState) {
    let d = UserDefaults.standard
    if let r = s.relay {
      relay = r
      relayName = s.me?.name ?? relayName
      relayChannel = s.channel ?? relayChannel
      d.set(try? JSONEncoder().encode(r), forKey: AppModel.relayKey)
      d.set(relayName, forKey: AppModel.nameKey)
      d.set(relayChannel, forKey: AppModel.channelKey)
    } else if s.connected == false {
      clearRelay()
    }
  }

  private func clearRelay() {
    relay = nil
    UserDefaults.standard.removeObject(forKey: AppModel.relayKey)
  }
```

Replace `endSession()` and guard `storeRelay`, so the phone's next state does not
bring the settings back:

```swift
  func endSession() {
    sessionEndedByUser = true
    if mode == .solo { exitSolo() }
    clearRelay()
    workout.stop()
  }
```

First line of `storeRelay(from:)`: `guard !sessionEndedByUser else { return }`.

- [ ] **Step 3: Mode changes**

Replace `watchLink()`:

```swift
  private func watchLink() {
    let up = linkUp
    if up != wasLinkUp {
      wasLinkUp = up
      InputLog.shared.system(up ? "Phone link up" : "Phone link down")
    }
    switch mode {
    case .phone:
      if up {
        linkAlerted = false
        return
      }
      let silent = lastStateAt.map { now.timeIntervalSince($0) } ?? .infinity
      if silent >= AppModel.soloAfter, let settings = relay {
        enterSolo(settings)
      } else if !linkAlerted, relay == nil, let at = lastStateAt,
                now.timeIntervalSince(at) >= AppModel.linkAlertAfter {
        linkAlerted = true
        WKInterfaceDevice.current().play(.failure)
        show(Banner(title: "No phone", body: "Your position is no longer shared", at: Date()))
      }
    case .solo:
      if !up { phoneBackSince = nil } // a phone that goes quiet again restarts the wait
      if let since = phoneBackSince, now.timeIntervalSince(since) >= AppModel.phoneBackAfter, up {
        exitSolo()
      } else {
        watchSolo()
      }
    }
  }

  private func enterSolo(_ settings: RelaySettings) {
    InputLog.shared.system("Solo mode on")
    mode = .solo
    soloSince = Date()
    noNetworkAlerted = false
    phoneBackSince = nil
    solo.sos = mySOSActive
    solo.start(settings, name: relayName)
  }

  private func exitSolo() {
    InputLog.shared.system("Solo mode off")
    mode = .phone
    solo.stop()
    let left = solo.drain()
    for t in left.texts {
      if let m = QuickMessage(rawValue: t.msg) { link.send(Outgoing.text(m)) }
    }
    for c in left.clips {
      link.sendClip(c.url, metaJSON: Outgoing.clipMeta(durationMs: c.ms, to: c.to))
    }
    link.send(Outgoing.sos(active: mySOSActive))
    sosPendingSince = nil
  }

  var soloOnline: Bool {
    guard let ok = solo.lastSyncOK else { return false }
    return now.timeIntervalSince(ok) < AppModel.noNetworkAfter
  }

  private func watchSolo() {
    let reference = solo.lastSyncOK ?? soloSince ?? now
    let silent = now.timeIntervalSince(reference)
    if silent >= AppModel.noNetworkAfter, !noNetworkAlerted {
      noNetworkAlerted = true
      InputLog.shared.system("No network")
      WKInterfaceDevice.current().play(.failure)
      show(Banner(title: "No network", body: "Your position is no longer shared", at: Date()))
    } else if silent < AppModel.noNetworkAfter, noNetworkAlerted {
      noNetworkAlerted = false
      InputLog.shared.system("Network back")
    }
    if let since = sosPendingSince, now.timeIntervalSince(since) >= AppModel.sosConfirmAfter {
      sosPendingSince = nil
      WKInterfaceDevice.current().play(.failure)
      show(Banner(title: "SOS not transmitted", body: "Still trying", at: Date()))
    }
    if now.timeIntervalSince(lastBatteryLog) >= AppModel.batteryLogEvery {
      lastBatteryLog = now
      let device = WKInterfaceDevice.current()
      device.isBatteryMonitoringEnabled = true
      InputLog.shared.system("Battery \(Int(device.batteryLevel * 100))%")
    }
  }
```

- [ ] **Step 4: Handle the relay answer**

```swift
  private func handleSolo(_ r: SyncResponse, fix: RelayPosition?) {
    guard let settings = relay else { return }
    let rider = SoloGeometry.riders(r, me: fix, myUid: settings.uid)
    state = PhoneState(v: 2, kind: "state", connected: true, channel: relayChannel, watchMode: true,
                       me: MePosition(name: relayName, lat: fix?.lat, lon: fix?.lon, cog: fix?.cog,
                                      sog: fix?.sog, t: fix?.t),
                       riders: rider, ts: r.now, relay: settings)
    now = Date()
    if sosPendingSince != nil {
      sosPendingSince = nil
      show(Banner(title: "SOS sent", body: "The group has been told", at: Date()))
    }
    for e in r.events { handle(relayEvent: e) }
  }

  private func handle(relayEvent e: RelayEvent) {
    switch e.type {
    case "text":
      handle(event: PhoneEvent(type: "text", uid: e.uid, from: e.from, id: e.msg, text: e.text))
    case "sos":
      handle(event: PhoneEvent(type: "sos", uid: e.uid, from: e.from, active: e.active))
    case "clip":
      guard let id = e.clip else { return }
      solo.download(id: id) { [weak self] clip in
        guard let self = self, let clip = clip, let data = Data(base64Encoded: clip.data) else {
          InputLog.shared.system("Clip download failed")
          return
        }
        let url = FileManager.default.temporaryDirectory.appendingPathComponent("rx-\(id).\(clip.ext)")
        guard (try? data.write(to: url)) != nil else { return }
        self.handleClip(url, ClipMeta(uid: e.uid, from: e.from, durationMs: e.durationMs, isPrivate: (e.to ?? 0) != 0))
      }
    default:
      break
    }
  }
```


- [ ] **Step 5: Route outgoing and incoming**

At the top of the `.state` case in `handle(json:)`:

```swift
    case .state(let s):
      storeRelay(from: s)
      lastStateAt = Date()
      if mode == .solo {
        // The relay feeds the compass until solo mode ends.
        if phoneBackSince == nil { phoneBackSince = Date() }
        return
      }
      state = s
```

Remove the original `state = s` and `lastStateAt = Date()` lines.

Replace `send(_:)`. In solo mode the success haptic waits for the relay's answer:

```swift
  func send(_ message: QuickMessage) {
    let queued = mode == .solo
    if queued {
      solo.enqueue(text: RelayOutEvent(id: UUID().uuidString, msg: message.rawValue, text: message.label))
    } else {
      link.send(Outgoing.text(message))
    }
    record(HistoryItem(who: "Group", outgoing: true, isPrivate: false, kind: .text(message.label)))
    if !queued { WKInterfaceDevice.current().play(.success) }
    show(Banner(title: queued ? "Queued" : "Sent", body: message.label, at: Date()))
  }
```

In `setSOS(_:)`:

```swift
    mySOSActive = active
    if mode == .solo {
      solo.sos = active
      sosPendingSince = active ? Date() : nil
    } else {
      link.send(Outgoing.sos(active: active))
    }
```

In `stopAndSend()`, replace the `link.sendClip` line and the delayed success haptic:

```swift
    if mode == .solo, let settings = relay, let data = try? Data(contentsOf: url) {
      let clip = RelayClip(id: UUID().uuidString, uid: settings.uid, from: relayName, to: target ?? 0,
                           durationMs: ms, ext: url.pathExtension, data: data.base64EncodedString())
      solo.enqueue(clip: QueuedClip(clip: clip, url: url, to: target, ms: ms))
    } else {
      link.sendClip(url, metaJSON: Outgoing.clipMeta(durationMs: ms, to: target))
      DispatchQueue.main.asyncAfter(deadline: .now() + 0.4) {
        WKInterfaceDevice.current().play(.success)
      }
    }
    lastSent = Date()
```

`solo.onClipSent` plays the success haptic in solo mode. A queued clip's file must
stay until `drain()`: the relay path does not delete it, so no change is needed.

- [ ] **Step 6: Connected state**

```swift
  var channelConnected: Bool {
    mode == .solo ? soloOnline : linkUp && (state?.connected ?? false)
  }
```

`autoLockIfReady` needs no change: going solo before the lock still locks.

- [ ] **Step 7: Build**

Run the build command from Task 8 Step 5.
Expected: `** BUILD SUCCEEDED **`.

- [ ] **Step 8: Commit**

```bash
git add ios
git commit -m "feat(watch): solo mode with routing through the relay"
```

---

### Task 11: Status row

**Files:**
- Modify: `ios/SoarXVoiceWatch/Views.swift`

- [ ] **Step 1: Colours and labels**

Replace `dotColor` and `statusText` in the status row:

```swift
  private var dotColor: Color {
    if model.mode == .solo { return model.soloOnline ? Theme.teal : Theme.red }
    return model.channelConnected ? Theme.teal : (model.linkUp ? Theme.amber : Theme.red)
  }

  private var statusText: String {
    if model.mode == .solo { return model.soloOnline ? "Solo" : "No network" }
    if !model.linkUp { return "No phone" }
    if !(model.state?.connected ?? false) { return "Not in channel" }
    return model.state?.channel ?? "Connected"
  }
```

Lines 98 and 610 of `Views.swift` show `model.linkUp ? "No riders yet" : "Waiting
for phone"`. In both, replace the condition with `model.linkUp || model.mode == .solo`.

- [ ] **Step 2: Build and commit**

Run the build command from Task 8 Step 5, then:

```bash
git add ios
git commit -m "feat(watch): solo and no network in the status row"
```

---

### Task 12: End-to-end on simulators

The watch simulator shares the Mac's network, so "no phone" is simulated by
stopping the phone app.

**Files:**
- Modify: `.env` locally only, never committed

- [ ] **Step 1: Local relay**

```bash
cd relay && printf 'RELAY_KEY=dev\n' > .dev.vars && npm run dev
```

- [ ] **Step 2: Build the apps with the relay**

Pass `COMX_RELAY_URL=http://localhost:8787` and `COMX_RELAY_KEY=dev` with the
Agora key as environment variables to `npx react-native bundle --reset-cache`.
Watch build as in Task 8. Sign every entry of `SoarXVoice.app/Frameworks` with
`codesign -f -s -`, then the app, and install.

- [ ] **Step 3: Second client**

The same iPhone app on a second simulator, `iPhone 17 Pro`
(`7C6BBA60-51FA-48C9-A501-215EACAD7F97`), on the same channel. Below it is called
the second phone. Android is not used here: its release build refuses `http`.

- [ ] **Step 4: Run the scenario**

With a test channel, not TARIFA-01:

1. Both phones join. Watch shows the second phone's rider, status shows the channel.
2. Stop the app on the watch's paired iPhone. Expected after about 15 s: session log *Solo mode on*, status `SOLO`.
3. `xcrun simctl location <watch> set 36.02,-5.61`. Expected within 20 s: the rider moves on the second phone.
4. Send a quick message from the watch. Expected: *Queued*, then it arrives on the second phone once.
5. Send one from the second phone. Expected: banner on the watch.
6. Record a clip on the watch. Expected: played on the second phone. The file transfer path is not used.
7. Record a memo on the second phone. Expected: it appears in the watch History. Simulator audio is not a proof of loudness.
8. Demo SOS from the watch on the test channel, then cancel at once. Expected: *SOS sent*, alert on the second phone, cleared on cancel.
9. Stop `wrangler dev`. Expected after 30 s: `NO NETWORK`, failure haptic, banner. A new SOS shows *SOS not transmitted* after 15 s; cancel it. Restart the relay. Expected: `SOLO`.
10. Start the app on the paired iPhone. Expected after about 5 s: *Solo mode off*.
11. With the relay settings cleared by *End session*, stop the phone. Expected: `NO PHONE` and the alert from PR #4.

- [ ] **Step 5: Fix what fails**

Use `superpowers:systematic-debugging` for each failure, commit each fix on its own, and report the result of every numbered step.

---

### Task 13: Docs and release

**Files:**
- Modify: `docs/watch-ios.md`, `docs/watch-companion.md`, `CLAUDE.md`

- [ ] **Step 1: Update the docs**

- `docs/watch-ios.md`: replace the section *Without the phone* with a *Solo mode* section: the two modes, timers, status row, session log lines, and how to test.
- `docs/watch-companion.md`: add `relay` to the state, a *Relay* section linking the spec, and `COMX_RELAY_URL` / `COMX_RELAY_KEY`.
- Tell the owner that the App Store privacy details must now declare location and audio data going through a server. Only the owner can change them.
- `CLAUDE.md`: add `relay/` to *Where things are*, `relay-deploy.yml` to the workflow table, and change the decision "a watch working alone comes later" to "a watch works alone through the relay, phone needed to join".

- [ ] **Step 2: Commit and open the PR**

```bash
git add docs CLAUDE.md
git commit -m "docs: watch solo mode and relay"
git push -u origin watch-solo-design
gh pr create -R xavierkain-apps/comx --base main --head watch-solo-design --title "Watch solo mode through a Cloudflare relay"
```

The PR body lists what was tested and states that nothing was tested on a real
watch, on cellular or in water. The merge and the `comx-v*` tag stay with the owner.

---

### Task 14: Field test (owner)

- [ ] **Step 1: Install the TestFlight build on both riders' devices.**
- [ ] **Step 2: Join on the beach, phone with each rider, then the eSIM rider leaves their phone behind and rides.**
- [ ] **Step 3: Check the *Done when* list of the spec. Note distance from shore when `NO NETWORK` appears.**
- [ ] **Step 4: Read the *Session log* on both watches: mode changes, network loss, and battery every 15 minutes.**
- [ ] **Step 5: Write the battery use over two hours in `docs/watch-ios.md`, and tune `SoloLink.syncInterval` if needed.**

A test SOS is announced to the group and cancelled at once.
