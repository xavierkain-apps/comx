import {DEMO_RIDERS, demoPosition, isDemoUid, offsetLatLon} from '../demo';
import {bearingDegrees, distanceMeters} from '../../utils/geo';

const anchor = {lat: 36.01, lon: -5.6};

describe('offsetLatLon', () => {
  it('moves the given distance in the given direction', () => {
    const north = offsetLatLon(anchor, 500, 0);
    expect(distanceMeters(anchor, north)).toBeCloseTo(500, 0);
    expect(bearingDegrees(anchor, north)).toBeCloseTo(0, 1);
    const east = offsetLatLon(anchor, 0, 300);
    expect(distanceMeters(anchor, east)).toBeCloseTo(300, 0);
    expect(bearingDegrees(anchor, east)).toBeCloseTo(90, 1);
  });
});

describe('demoPosition', () => {
  it('keeps each rider on its circle and moves it over time', () => {
    for (const r of DEMO_RIDERS) {
      const a = demoPosition(r, anchor, 0);
      const b = demoPosition(r, anchor, 30_000);
      expect(distanceMeters(anchor, a)).toBeCloseTo(r.radius, -1);
      expect(distanceMeters(anchor, b)).toBeCloseTo(r.radius, -1);
      expect(distanceMeters(a, b)).toBeGreaterThan(10);
      expect(b.t).toBe(30_000);
    }
  });

  it('reports a course tangent to the circle, clockwise', () => {
    // Phase 0 at t=0: due north of the anchor, heading east
    const p = demoPosition({...DEMO_RIDERS[0], phase: 0}, anchor, 0);
    expect(bearingDegrees(anchor, p)).toBeCloseTo(0, 0);
    expect(p.cog).toBe(90);
    expect(p.sog).toBeGreaterThan(0);
  });
});

describe('isDemoUid', () => {
  it('recognises only the virtual riders', () => {
    expect(isDemoUid(DEMO_RIDERS[1].uid)).toBe(true);
    expect(isDemoUid(12345)).toBe(false);
  });
});
