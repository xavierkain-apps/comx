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
