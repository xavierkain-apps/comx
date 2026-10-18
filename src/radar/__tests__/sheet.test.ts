import {CONTROL_HEIGHT, HANDLE_HEIGHT, SHEET_MEDIUM, clampSheet, nextDetent, settleDetent, sheetDetents} from '../sheet';

describe('sheetDetents', () => {
  it('gives controls only, about 370 pt, and 90 % of the screen', () => {
    expect(sheetDetents(812, 34)).toEqual({collapsed: 10 + HANDLE_HEIGHT + CONTROL_HEIGHT + 8 + 34, medium: SHEET_MEDIUM, large: 731});
  });

  it('never lets medium go above large on a short screen', () => {
    expect(sheetDetents(600, 0)).toEqual({collapsed: 111, medium: 370, large: 540});
    expect(sheetDetents(400, 0).large).toBe(370);
  });
});

describe('settling', () => {
  const d = sheetDetents(812, 34); // 145 / 370 / 731

  it('goes to the nearest detent after a slow drag', () => {
    expect(settleDetent(300, 0, d)).toBe(370);
    expect(settleDetent(200, 0.1, d)).toBe(145);
    expect(settleDetent(600, 0, d)).toBe(731);
  });

  it('moves one detent in the direction of a flick', () => {
    expect(settleDetent(300, 1, d)).toBe(145);
    expect(settleDetent(300, -1, d)).toBe(370);
    expect(settleDetent(400, -1, d)).toBe(731);
    expect(settleDetent(731, -1, d)).toBe(731);
    expect(settleDetent(145, 1, d)).toBe(145);
  });

  it('keeps the sheet between collapsed and large', () => {
    expect(clampSheet(1000, d)).toBe(731);
    expect(clampSheet(0, d)).toBe(145);
    expect(clampSheet(500, d)).toBe(500);
  });

  it('cycles detents on a tap of the grabber', () => {
    expect(nextDetent(145, d)).toBe(370);
    expect(nextDetent(370, d)).toBe(731);
    expect(nextDetent(731, d)).toBe(145);
    expect(nextDetent(200, d)).toBe(370);
  });
});
