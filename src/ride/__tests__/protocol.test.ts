import {
  parseStreamMessage,
  parseWatchMessage,
  buildRiderViews,
  buildWatchState,
  quickMessageText,
  isOlderRider,
  Position,
} from '../protocol';

const pos = (lat: number, lon: number, t = 1000): Position => ({lat, lon, cog: null, sog: null, acc: 5, t});

describe('parseStreamMessage', () => {
  it('accepts a position and fills optional fields', () => {
    expect(parseStreamMessage({type: 'pos', lat: 36, lon: -5.6, t: 5})).toEqual({
      type: 'pos', lat: 36, lon: -5.6, cog: null, sog: null, acc: 0, t: 5,
    });
  });

  it('rejects impossible coordinates and unknown types', () => {
    expect(parseStreamMessage({type: 'pos', lat: 91, lon: 0})).toBeNull();
    expect(parseStreamMessage({type: 'pos', lat: 'x', lon: 0})).toBeNull();
    expect(parseStreamMessage({type: 'nope'})).toBeNull();
    expect(parseStreamMessage(null)).toBeNull();
  });

  it('caps text length and defaults the id', () => {
    const m = parseStreamMessage({type: 'text', text: 'a'.repeat(500)});
    expect(m).toEqual({type: 'text', id: 'custom', text: 'a'.repeat(200)});
  });

  it('reads SOS with or without a position', () => {
    expect(parseStreamMessage({type: 'sos', active: true, lat: 1, lon: 2})).toEqual({type: 'sos', active: true, lat: 1, lon: 2});
    expect(parseStreamMessage({type: 'sos'})).toEqual({type: 'sos', active: false, lat: null, lon: null});
  });
});

describe('parseWatchMessage', () => {
  it('fills the text of a quick message from its id', () => {
    expect(parseWatchMessage('{"v":1,"kind":"text","id":"back"}')).toEqual({kind: 'text', id: 'back', text: 'Heading back'});
  });

  it('parses sos, ptt and hello', () => {
    expect(parseWatchMessage('{"kind":"sos","active":true}')).toEqual({kind: 'sos', active: true});
    expect(parseWatchMessage('{"kind":"ptt","active":false}')).toEqual({kind: 'ptt', active: false});
    expect(parseWatchMessage('{"kind":"hello","platform":"garmin"}')).toEqual({
      kind: 'hello', platform: 'garmin', model: undefined, hasCompass: false,
    });
  });

  it('ignores garbage', () => {
    expect(parseWatchMessage('not json')).toBeNull();
    expect(parseWatchMessage('{"kind":"x"}')).toBeNull();
  });
});

describe('buildRiderViews', () => {
  const me = pos(0, 0, 10_000);

  it('computes distance and bearing, nearest first, SOS on top', () => {
    const views = buildRiderViews(
      me,
      [
        {uid: 1, name: 'Far', speaking: false, sos: false, position: pos(0.01, 0, 10_000)},
        {uid: 2, name: 'Near', speaking: true, sos: false, position: pos(0, 0.001, 10_000)},
        {uid: 3, name: 'Help', speaking: false, sos: true, position: pos(-0.02, 0, 10_000)},
        {uid: 4, name: 'Unknown', speaking: false, sos: false},
      ],
      10_000,
    );
    expect(views.map(v => v.name)).toEqual(['Help', 'Near', 'Far', 'Unknown']);
    expect(views[1].brg).toBeCloseTo(90, 0);
    expect(views[1].dist).toBeGreaterThan(100);
    expect(views[1].dist).toBeLessThan(120);
    expect(views[3].dist).toBeNull();
    expect(views[3].stale).toBe(true);
  });

  it('marks old positions as stale and keeps distances null without my position', () => {
    const [v] = buildRiderViews(null, [{uid: 1, name: 'A', speaking: false, sos: false, position: pos(1, 1, 0)}], 60_000);
    expect(v.stale).toBe(true);
    expect(v.dist).toBeNull();
    expect(v.lat).toBe(1);
  });
});

describe('buildWatchState', () => {
  it('matches the documented shape', () => {
    const s = buildWatchState({
      connected: true, channel: 'TARIFA-01', watchMode: true, myName: 'Xav', me: null, riders: [], now: 42,
    });
    expect(s).toEqual({
      v: 2, kind: 'state', connected: true, channel: 'TARIFA-01', watchMode: true,
      me: {name: 'Xav', lat: null, lon: null, cog: null, sog: null, t: null},
      riders: [], ts: 42,
    });
  });
});

it('quickMessageText falls back', () => {
  expect(quickMessageText('help')).toBe('I need help');
  expect(quickMessageText('zzz', 'custom words')).toBe('custom words');
  expect(quickMessageText('zzz')).toBe('zzz');
});

describe('isOlderRider', () => {
  it('flags a name message without a protocol version or with an older one', () => {
    expect(isOlderRider({type: 'name', name: 'Ana'})).toBe(true);
    expect(isOlderRider({type: 'name', name: 'Ana', v: 1})).toBe(true);
    expect(isOlderRider({type: 'name', name: 'Ana', v: '2'})).toBe(true);
    expect(isOlderRider({type: 'name', name: 'Ana', v: 2})).toBe(false);
    expect(isOlderRider({type: 'name', name: 'Ana', v: 3})).toBe(false);
  });
});
