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
    expect(typeof body.cursor).toBe('number');
  });

  it('refuses a body that is not JSON', async () => {
    const res = await SELF.fetch(`https://relay.test/v1/channels/${KEY}/sync`, {
      method: 'POST',
      headers: {'content-type': 'application/json', 'x-comx-key': 'test-key'},
      body: '{nope',
    });
    expect(res.status).toBe(400);
  });

  it('refuses a sync without a numeric uid or a known source', async () => {
    expect((await post(`/v1/channels/${KEY}/sync`, syncBody(1, {uid: 'x'}))).status).toBe(400);
    expect((await post(`/v1/channels/${KEY}/sync`, syncBody(1, {source: 'tablet'}))).status).toBe(400);
    expect((await post(`/v1/channels/${KEY}/sync`, null)).status).toBe(400);
  });

  it('refuses a clip without a string id or data', async () => {
    const base = {id: 'c', uid: 1, from: 'R1', to: 0, durationMs: 1, ext: 'm4a', data: 'QUJD'};
    expect((await post(`/v1/channels/${KEY}/clips`, {...base, id: 3})).status).toBe(400);
    expect((await post(`/v1/channels/${KEY}/clips`, {...base, data: undefined})).status).toBe(400);
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

  it('keeps the cursor when every event has expired', async () => {
    const key = channelFor();
    await at(key, 10_000);
    const first = await sync(key, syncBody(1));
    await at(key, 12_000);
    await sync(key, syncBody(2, {events: [{id: 'e1', type: 'text', msg: 'ok', text: 'x'}]}));
    await at(key, 12_000 + 15 * 60_000 + 1_000);
    const quiet = await sync(key, syncBody(1, {cursor: first.body.cursor}));
    expect(quiet.body.events).toEqual([]);
    const t = 12_000 + 20 * 60_000;
    await at(key, t);
    await sync(key, syncBody(2, {events: [{id: 'e2', type: 'text', msg: 'ok', text: 'x'}]}));
    await at(key, t + 3 * 60_000);
    const back = await sync(key, syncBody(1, {cursor: quiet.body.cursor}));
    expect(back.body.events.map((e: any) => e.id)).toEqual(['e2']);
  });

  it('gives a client with a cursor from before the wipe the new events', async () => {
    const key = channelFor();
    await at(key, 10_000);
    await sync(key, syncBody(2, {events: [{id: 'e0', type: 'text', msg: 'ok', text: 'x'}]}));
    await at(key, 12_000);
    const a = await sync(key, syncBody(1));
    const stub = env.CHANNEL.get(env.CHANNEL.idFromName(key));
    await runInDurableObject(stub, (c: Channel) => c.alarm());
    await at(key, 20_000);
    await sync(key, syncBody(2, {events: [{id: 'e1', type: 'text', msg: 'ok', text: 'x'}]}));
    await at(key, 22_000);
    const back = await sync(key, syncBody(1, {cursor: a.body.cursor}));
    expect(back.body.events.map((e: any) => e.id)).toEqual(['e1']);
  });

  it('keeps the server fields of an event', async () => {
    const key = channelFor();
    await at(key, 10_000);
    await sync(key, syncBody(1, {events: [{id: 'e1', type: 'text', msg: 'ok', text: 'x', seq: 999, uid: 7, from: 'X'}]}));
    const {body} = await sync(key, syncBody(2));
    expect(body.events[0]).toMatchObject({id: 'e1', uid: 1, from: 'R1', to: 0});
    expect(body.events[0].seq).not.toBe(999);
  });

  it('stamps an event with the relay time it was stored', async () => {
    const key = channelFor();
    await at(key, 10_000);
    await sync(key, syncBody(1, {events: [{id: 'e1', type: 'text', msg: 'ok', text: 'x'}]}));
    await at(key, 20_000);
    const {body} = await sync(key, syncBody(2));
    expect(body.events[0].sentAt).toBe(10_000);
  });

  it('refuses a second sync within 1 s', async () => {
    const key = channelFor();
    await at(key, 10_000);
    await sync(key, syncBody(1));
    await at(key, 10_500);
    expect((await sync(key, syncBody(1))).status).toBe(429);
  });
});

const sosEvents = (b: any) => b.events.filter((e: any) => e.type === 'sos');
const uid1 = (b: any) => b.riders.filter((r: any) => r.uid === 1).map((r: any) => [r.sos, r.sosAt]);

describe('sos', () => {
  it('raises from a phone row with its change time', async () => {
    const key = channelFor();
    await at(key, 10_000);
    await sync(key, syncBody(1, {sos: true, sosAt: 1_000, pos: pos(9_000)}));
    const {body} = await sync(key, syncBody(2));
    expect(uid1(body)).toEqual([[true, 1_000]]);
    expect(sosEvents(body).map((e: any) => [e.active, e.at, e.lat, e.lon])).toEqual([[true, 1_000, 36, -5.6]]);
  });

  it('answers a client with its own sos state, after this sync update', async () => {
    const key = channelFor();
    await at(key, 10_000);
    const raised = await sync(key, syncBody(1, {sos: true, sosAt: 1_000}));
    expect(raised.body.self).toEqual({sos: true, sosAt: 1_000});
    await at(key, 12_000);
    const watch = await sync(key, syncBody(1, {source: 'watch', sos: false, sosAt: 0}));
    expect(watch.body.self).toEqual({sos: true, sosAt: 1_000});
  });

  it('answers self as off for a client that never touched sos', async () => {
    const key = channelFor();
    await at(key, 10_000);
    const {body} = await sync(key, syncBody(1));
    expect(body.self).toEqual({sos: false, sosAt: 0});
  });

  it('lets the watch row of the same uid cancel with a newer time', async () => {
    const key = channelFor();
    await at(key, 10_000);
    await sync(key, syncBody(1, {sos: true, sosAt: 1_000}));
    const b0 = await sync(key, syncBody(2));
    await at(key, 12_000);
    await sync(key, syncBody(1, {source: 'watch', sos: false, sosAt: 2_000}));
    const b1 = await sync(key, syncBody(2, {cursor: b0.body.cursor}));
    expect(sosEvents(b1.body).map((e: any) => [e.active, e.at])).toEqual([[false, 2_000]]);
    expect(uid1(b1.body)).toEqual([[false, 2_000], [false, 2_000]]);
  });

  it('ignores a phone that keeps sending an older change', async () => {
    const key = channelFor();
    await at(key, 10_000);
    await sync(key, syncBody(1, {sos: true, sosAt: 1_000}));
    await sync(key, syncBody(1, {source: 'watch', sos: false, sosAt: 2_000}));
    const b0 = await sync(key, syncBody(2));
    await at(key, 12_000);
    await sync(key, syncBody(1, {sos: true, sosAt: 1_000}));
    await at(key, 14_000);
    await sync(key, syncBody(1, {sos: true, sosAt: 1_000}));
    const b1 = await sync(key, syncBody(2, {cursor: b0.body.cursor}));
    expect(sosEvents(b1.body)).toEqual([]);
    expect(uid1(b1.body)).toEqual([[false, 2_000], [false, 2_000]]);
  });

  it('lets a phone that adopted the state raise again', async () => {
    const key = channelFor();
    await at(key, 10_000);
    await sync(key, syncBody(1, {sos: true, sosAt: 1_000}));
    await sync(key, syncBody(1, {source: 'watch', sos: false, sosAt: 2_000}));
    const b0 = await sync(key, syncBody(2));
    await at(key, 12_000);
    await sync(key, syncBody(1, {sos: false, sosAt: 2_000}));
    const b1 = await sync(key, syncBody(2, {cursor: b0.body.cursor}));
    expect(sosEvents(b1.body)).toEqual([]);
    await at(key, 14_000);
    await sync(key, syncBody(1, {sos: true, sosAt: 3_000}));
    const b2 = await sync(key, syncBody(2, {cursor: b1.body.cursor}));
    expect(sosEvents(b2.body).map((e: any) => [e.active, e.at])).toEqual([[true, 3_000]]);
    expect(uid1(b2.body)).toEqual([[true, 3_000], [true, 3_000]]);
  });

  it('raises the sos of a newcomer whose first sync has it on', async () => {
    const key = channelFor();
    await at(key, 10_000);
    await sync(key, syncBody(1, {sos: true, sosAt: 500}));
    await at(key, 12_000);
    await sync(key, syncBody(1, {sos: true, sosAt: 500}));
    const {body} = await sync(key, syncBody(2));
    expect(uid1(body)).toEqual([[true, 500]]);
    expect(sosEvents(body).map((e: any) => e.active)).toEqual([true]);
  });

  it('keeps no state for a rider who never touched sos', async () => {
    const key = channelFor();
    await at(key, 10_000);
    await sync(key, syncBody(1, {sos: true}));
    await sync(key, syncBody(1, {source: 'watch', sos: true, sosAt: 'x'}));
    const {body} = await sync(key, syncBody(2));
    expect(sosEvents(body)).toEqual([]);
    expect(uid1(body)).toEqual([[false, 0], [false, 0]]);
  });

  it('clamps a change time far in the future to the relay clock', async () => {
    const key = channelFor();
    await at(key, 10_000);
    await sync(key, syncBody(1, {sos: true, sosAt: 10_000 + 60 * 60_000}));
    const b0 = await sync(key, syncBody(2));
    expect(uid1(b0.body)).toEqual([[true, 10_000]]);
    await at(key, 20_000);
    await sync(key, syncBody(1, {sos: false, sosAt: 21_000}));
    const b1 = await sync(key, syncBody(2, {cursor: b0.body.cursor}));
    expect(sosEvents(b1.body).map((e: any) => [e.active, e.at])).toEqual([[false, 21_000]]);
    expect(uid1(b1.body)).toEqual([[false, 21_000]]);
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
