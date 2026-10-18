import {
  MIN_FARTHEST_M,
  arrowHeading,
  initials,
  layoutRadar,
  nextRotation,
  niceDistance,
  point,
  ringDistance,
  shortDistance,
  spread,
} from '../radar';

const c = {x: 150, y: 150};
const dist = (a: {x: number; y: number}, b: {x: number; y: number}) => Math.hypot(a.x - b.x, a.y - b.y);

describe('point', () => {
  it('measures angles clockwise from the top of the screen', () => {
    expect(point({x: 100, y: 100}, 50, 0, 1)).toEqual({x: 100, y: 50});
    const east = point({x: 100, y: 100}, 50, 90, 1);
    expect(east.x).toBeCloseTo(150);
    expect(east.y).toBeCloseTo(100);
    const half = point({x: 100, y: 100}, 50, 180, 0.5);
    expect(half.x).toBeCloseTo(100);
    expect(half.y).toBeCloseTo(125);
  });
});

describe('niceDistance', () => {
  it('rounds down to 1, 2 or 5 times a power of ten', () => {
    expect(niceDistance(0)).toBe(0);
    expect(niceDistance(-3)).toBe(0);
    expect(niceDistance(7)).toBe(5);
    expect(niceDistance(25)).toBe(20);
    expect(niceDistance(450)).toBe(200);
    expect(niceDistance(1000)).toBe(1000);
    expect(niceDistance(1999)).toBe(1000);
    expect(niceDistance(2000)).toBe(2000);
    expect(niceDistance(4999)).toBe(2000);
    expect(niceDistance(5000)).toBe(5000);
  });
});

describe('shortDistance and ringDistance', () => {
  it('formats badge distances without a unit, like Format.short', () => {
    expect(shortDistance(null)).toBe('--');
    expect(shortDistance(NaN)).toBe('--');
    expect(shortDistance(180.4)).toBe('180');
    expect(shortDistance(999.6)).toBe('1000');
    expect(shortDistance(1400)).toBe('1.4K');
    expect(shortDistance(12345)).toBe('12K');
  });

  it('formats ring labels in uppercase, like Format.distance', () => {
    expect(ringDistance(500)).toBe('500 M');
    expect(ringDistance(1400)).toBe('1.4 KM');
    expect(ringDistance(20000)).toBe('20 KM');
  });
});

describe('layoutRadar', () => {
  const riders = [
    {uid: 1, dist: 900, brg: 0},
    {uid: 2, dist: 225, brg: 180},
    {uid: 3, dist: null, brg: null},
  ];

  it('puts the farthest rider on the outer ring and scales by the square root', () => {
    const l = layoutRadar(riders, 300, 300, 0, 44);
    expect(l.centre).toEqual(c);
    expect(l.radius).toBe(126); // 300 / 2 - 44 / 2 - 2
    expect(l.farthest).toBe(900);
    const a = l.spots.find(s => s.uid === 1)!;
    const b = l.spots.find(s => s.uid === 2)!;
    expect(a.x).toBeCloseTo(150);
    expect(a.y).toBeCloseTo(24);
    expect(b.x).toBeCloseTo(150);
    expect(b.y).toBeCloseTo(213); // sqrt(225 / 900) = 0.5 of the radius, south
    expect(l.unplaced).toEqual([3]);
  });

  it('draws a round inner ring at the square-root radius', () => {
    const l = layoutRadar(riders, 300, 300, 0, 44);
    expect(l.inner).toBe(200);
    expect(l.innerRadius).toBeCloseTo(59.4, 1);
    expect(l.north.x).toBeCloseTo(150);
    expect(l.north.y).toBeCloseTo(14);
  });

  it('turns everything by the heading', () => {
    const l = layoutRadar([{uid: 1, dist: 900, brg: 90}], 300, 300, 90, 44);
    expect(l.spots[0].x).toBeCloseTo(150);
    expect(l.spots[0].y).toBeCloseTo(24);
    expect(l.north.x).toBeCloseTo(14);
    expect(l.north.y).toBeCloseTo(150);
  });

  it('never lets a lone near rider sit on the edge', () => {
    const l = layoutRadar([{uid: 1, dist: 10, brg: 90}], 300, 300, 0, 44);
    expect(l.farthest).toBe(MIN_FARTHEST_M);
    expect(l.spots[0].x).toBeCloseTo(150 + 126 * Math.sqrt(10 / 50));
    expect(l.inner).toBe(20);
    expect(l.innerRadius).toBeCloseTo(126 * Math.sqrt(20 / 50));
  });

  it('leaves riders with a NaN distance or an undefined bearing unplaced', () => {
    const bad = [
      {uid: 1, dist: 900, brg: 0},
      {uid: 4, dist: NaN, brg: 90},
      {uid: 5, dist: 300, brg: undefined as unknown as number | null},
    ];
    const l = layoutRadar(bad, 300, 300, 0, 44);
    expect(l.unplaced).toEqual([4, 5]);
    expect(l.spots.map(s => s.uid)).toEqual([1]);
    expect(l.farthest).toBe(900);
    expect(Number.isFinite(l.innerRadius as number)).toBe(true);
    l.spots.forEach(s => {
      expect(Number.isFinite(s.x)).toBe(true);
      expect(Number.isFinite(s.y)).toBe(true);
    });
  });

  it('uses the 50 m floor when nobody has a position', () => {
    const l = layoutRadar([{uid: 3, dist: null, brg: null}], 300, 300, 0, 44);
    expect(l.farthest).toBe(50);
    expect(l.inner).toBe(20);
    expect(l.innerRadius).toBeCloseTo(126 * Math.sqrt(20 / 50));
    expect(l.spots).toEqual([]);
    expect(l.unplaced).toEqual([3]);
  });
});

describe('spread', () => {
  it('pushes two riders on the same spot one badge + 10 apart, inside the ring', () => {
    const out = spread([{x: 150, y: 50}, {x: 150, y: 50}], c, 126, 44);
    expect(dist(out[0], out[1])).toBeGreaterThanOrEqual(53.99);
    out.forEach(p => expect(dist(p, c)).toBeLessThanOrEqual(126 + 1e-9));
  });

  it('pushes riders on the same bearing sideways, not only along the ray', () => {
    const out = spread([{x: 150, y: 60}, {x: 150, y: 80}], c, 126, 44);
    expect(out[0].x).toBeLessThan(150);
    expect(out[1].x).toBeGreaterThan(150);
    expect(dist(out[0], out[1])).toBeGreaterThanOrEqual(53.99);
  });

  it('leaves riders far apart where they are', () => {
    const pts = [{x: 150, y: 30}, {x: 150, y: 270}];
    expect(spread(pts, c, 126, 44)).toEqual(pts);
  });

  it('brings a badge outside the ring back onto it', () => {
    const out = spread([{x: 150, y: 0}], c, 126, 44);
    expect(out[0].x).toBeCloseTo(150);
    expect(out[0].y).toBeCloseTo(24);
  });

  it('does not change its input', () => {
    const pts = [{x: 150, y: 50}, {x: 150, y: 50}];
    spread(pts, c, 126, 44);
    expect(pts).toEqual([{x: 150, y: 50}, {x: 150, y: 50}]);
  });
});

describe('initials', () => {
  it('takes the first letter of the first two words, ignoring parentheses', () => {
    expect(initials('Xavier Kain')).toBe('XK');
    expect(initials('Lea (demo)')).toBe('L');
    expect(initials('jean-luc picard')).toBe('JL');
    expect(initials('léa_martin')).toBe('LM');
    expect(initials('')).toBe('?');
    expect(initials('(demo)')).toBe('?');
  });
});

describe('arrow helpers', () => {
  it('uses north up, or my course in course mode when known', () => {
    expect(arrowHeading('north', 90)).toBe(0);
    expect(arrowHeading('course', 90)).toBe(90);
    expect(arrowHeading('course', null)).toBe(0);
    expect(arrowHeading('course', undefined)).toBe(0);
  });

  it('turns the shortest way', () => {
    expect(nextRotation(350, 10)).toBe(370);
    expect(nextRotation(10, 350)).toBe(-10);
    expect(nextRotation(0, 90)).toBe(90);
    expect(nextRotation(720, 0)).toBe(720);
  });
});
