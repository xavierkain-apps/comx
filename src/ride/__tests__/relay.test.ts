import {SeenIds, SosState, applySosChange, channelKey, mergeRelayRiders, pickPosition, hasSoloRider, WATCH_FIX_MAX_AGE_MS} from '../relay';
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

  it('keeps the newest SOS change of a uid', () => {
    const merged = mergeRelayRiders([
      {uid: 1, name: 'A', source: 'phone', pos: null, sos: true, sosAt: 10, seenAt: 1},
      {uid: 1, name: 'A', source: 'watch', pos: null, sos: false, sosAt: 20, seenAt: 2},
    ]);
    expect(merged[1].sos).toBe(false);
    expect(merged[1].sosAt).toBe(20);
  });
});

describe('applySosChange', () => {
  const known: Record<number, SosState> = {1: {active: true, at: 100}};

  it('takes a newer state', () => {
    const {next, changed} = applySosChange(known, 1, false, 101);
    expect(next[1]).toEqual({active: false, at: 101});
    expect(changed).toBe(true);
  });

  it('ignores an older or equal state', () => {
    for (const at of [99, 100]) {
      const {next, changed} = applySosChange(known, 1, false, at);
      expect(next).toBe(known);
      expect(changed).toBe(false);
    }
  });

  it('accepts a rider seen for the first time', () => {
    expect(applySosChange(known, 2, true, 1)).toEqual({next: {...known, 2: {active: true, at: 1}}, changed: true});
    const quiet = applySosChange(known, 2, false, 1);
    expect(quiet.next[2]).toEqual({active: false, at: 1});
    expect(quiet.changed).toBe(false);
  });

  it('reports a change only when the value changes', () => {
    const {next, changed} = applySosChange(known, 1, true, 200);
    expect(next[1]).toEqual({active: true, at: 200});
    expect(changed).toBe(false);
  });

  it('keeps an Agora cancel against a stale relay row', () => {
    let k: Record<number, SosState> = {};
    k = applySosChange(k, 1, true, 1_000).next; // raised
    const cancel = applySosChange(k, 1, false, 2_000); // cancelled on Agora
    expect(cancel.changed).toBe(true);
    const stale = applySosChange(cancel.next, 1, true, 1_000); // relay row not yet updated
    expect(stale.changed).toBe(false);
    expect(stale.next[1].active).toBe(false);
  });

  it('lets a re-raise right after an adoption win', () => {
    // Our watch cancelled at 10 000; the phone adopts that state and time
    let k: Record<number, SosState> = {1: {active: true, at: 5_000}};
    k = applySosChange(k, 1, false, 10_000).next;
    // The rider raises again 3 s later, before the next sync
    const raise = applySosChange(k, 1, true, 13_000);
    expect(raise.changed).toBe(true);
    // The next relay row still carries the adopted cancel: it loses
    const row = applySosChange(raise.next, 1, false, 10_000);
    expect(row.changed).toBe(false);
    expect(row.next[1].active).toBe(true);
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
