import {
  distanceMeters,
  bearingDegrees,
  relativeBearing,
  formatDistance,
  compassLabel,
  normalizeDegrees,
} from '../geo';

// Tarifa town and Valdevaqueros beach, about 9 km apart
const tarifa = {lat: 36.0139, lon: -5.6044};
const valdevaqueros = {lat: 36.0688, lon: -5.6876};

describe('distanceMeters', () => {
  it('is zero for the same point', () => {
    expect(distanceMeters(tarifa, tarifa)).toBe(0);
  });

  it('matches a known distance within 1%', () => {
    const d = distanceMeters(tarifa, valdevaqueros);
    expect(d).toBeGreaterThan(9500);
    expect(d).toBeLessThan(9800);
  });

  it('measures 1° of latitude as about 111 km', () => {
    expect(distanceMeters({lat: 0, lon: 0}, {lat: 1, lon: 0})).toBeCloseTo(111195, -2);
  });
});

describe('bearingDegrees', () => {
  it('points north, east, south and west', () => {
    expect(bearingDegrees({lat: 0, lon: 0}, {lat: 1, lon: 0})).toBeCloseTo(0, 5);
    expect(bearingDegrees({lat: 0, lon: 0}, {lat: 0, lon: 1})).toBeCloseTo(90, 5);
    expect(bearingDegrees({lat: 1, lon: 0}, {lat: 0, lon: 0})).toBeCloseTo(180, 5);
    expect(bearingDegrees({lat: 0, lon: 1}, {lat: 0, lon: 0})).toBeCloseTo(270, 5);
  });

  it('points north-west from Tarifa to Valdevaqueros', () => {
    const b = bearingDegrees(tarifa, valdevaqueros);
    expect(b).toBeGreaterThan(300);
    expect(b).toBeLessThan(320);
  });
});

describe('relativeBearing', () => {
  it('is north-up without a heading', () => {
    expect(relativeBearing(45, null)).toBe(45);
    expect(relativeBearing(45, undefined)).toBe(45);
  });

  it('subtracts the heading and wraps', () => {
    expect(relativeBearing(45, 90)).toBe(315);
    expect(relativeBearing(10, 350)).toBe(20);
  });
});

describe('formatDistance', () => {
  it('rounds metres to 5 m and switches to km', () => {
    expect(formatDistance(83)).toBe('85 m');
    expect(formatDistance(999)).toBe('1.0 km');
    expect(formatDistance(1234)).toBe('1.2 km');
    expect(formatDistance(15400)).toBe('15 km');
  });

  it('shows a dash when unknown', () => {
    expect(formatDistance(null)).toBe('—');
    expect(formatDistance(NaN)).toBe('—');
  });
});

describe('compassLabel and normalizeDegrees', () => {
  it('labels the 8 points', () => {
    expect(compassLabel(0)).toBe('N');
    expect(compassLabel(44)).toBe('NE');
    expect(compassLabel(359)).toBe('N');
    expect(compassLabel(225)).toBe('SW');
  });

  it('normalises negative angles', () => {
    expect(normalizeDegrees(-90)).toBe(270);
    expect(normalizeDegrees(720)).toBe(0);
  });
});
