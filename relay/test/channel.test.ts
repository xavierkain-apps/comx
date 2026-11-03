import {env, runInDurableObject, SELF} from 'cloudflare:test';
import {describe, expect, it} from 'vitest';
import type {Channel} from '../src/channel';
import type {Env as RelayEnv} from '../src/index';

declare global {
  namespace Cloudflare {
    interface Env extends RelayEnv {}
  }
}

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
