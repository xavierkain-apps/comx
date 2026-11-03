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
