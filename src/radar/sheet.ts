// Detents of the live screen's bottom sheet: controls only, about 370 pt,
// and 90 % of the screen (design handoff, "Bottom sheet").

/** Grabber plus the space around it. */
export const HANDLE_HEIGHT = 25;
/** The SOS · TALK · MEMO · MSG row. */
export const CONTROL_HEIGHT = 68;
export const SHEET_MEDIUM = 370;
/** A release faster than this (px/ms) is a flick. */
const FLICK_VELOCITY = 0.5;

export interface Detents {
  collapsed: number;
  medium: number;
  large: number;
}

/** `bottomPad` is the padding under the control row (home indicator). */
export function sheetDetents(screenHeight: number, bottomPad: number): Detents {
  const collapsed = 10 + HANDLE_HEIGHT + CONTROL_HEIGHT + 8 + bottomPad;
  const large = Math.max(Math.round(screenHeight * 0.9), SHEET_MEDIUM, collapsed);
  const medium = Math.min(Math.max(SHEET_MEDIUM, collapsed + 60), large);
  return {collapsed, medium, large};
}

export function clampSheet(height: number, d: Detents): number {
  return Math.min(d.large, Math.max(d.collapsed, height));
}

function stops(d: Detents): number[] {
  return [d.collapsed, d.medium, d.large];
}

function nearest(height: number, d: Detents): number {
  return stops(d).reduce((best, s) => (Math.abs(s - height) < Math.abs(best - height) ? s : best), d.collapsed);
}

/** Where the sheet rests after a drag. `vy` > 0 is a move down (px/ms). */
export function settleDetent(height: number, vy: number, d: Detents): number {
  if (Math.abs(vy) > FLICK_VELOCITY) {
    if (vy < 0) return stops(d).find(s => s > height + 1) ?? d.large;
    return [...stops(d)].reverse().find(s => s < height - 1) ?? d.collapsed;
  }
  return nearest(height, d);
}

/** A tap on the grabber: collapsed → medium → large → collapsed. */
export function nextDetent(height: number, d: Detents): number {
  const all = stops(d);
  const i = all.indexOf(nearest(height, d));
  return all[(i + 1) % all.length];
}
