// Voice memo rules shared by the MEMO button, the watch clips and the history.

import {GROUP_UID} from '../ride/voiceClips';

/** A memo is sent by itself after 30 s (spec: clips are capped at 30 s). */
export const MEMO_MAX_MS = 30_000;
/** Shorter recordings are a mis-tap and are not sent. */
export const MEMO_MIN_MS = 600;

/** Whole seconds left on the MEMO button while recording. */
export function memoSecondsLeft(startedAt: number, now: number): number {
  return Math.max(0, Math.ceil((MEMO_MAX_MS - (now - startedAt)) / 1000));
}

export function memoDurationMs(startedAt: number, stoppedAt: number): number {
  return Math.min(MEMO_MAX_MS, Math.max(0, stoppedAt - startedAt));
}

/** A rider uid, else the whole group (GROUP_UID). Accepts a watch's `to`. */
export function memoRecipient(to: unknown): number {
  return typeof to === 'number' && Number.isFinite(to) && to !== GROUP_UID ? to : GROUP_UID;
}

/**
 * A tap on a rider row while recording: picks that rider, or goes back to the
 * group when they were already picked (owner decision 8).
 */
export function toggleMemoTarget(current: number, tapped: number): number {
  return tapped === current ? GROUP_UID : memoRecipient(tapped);
}

/** The recipient at send time; null when the picked rider has left. */
export function resolveMemoTarget(target: number, present: ReadonlySet<number>): number | null {
  return target === GROUP_UID || present.has(target) ? target : null;
}

/** Recipient label while recording: "TO GROUP", "TO LÉA". */
export function memoTargetLabel(target: number, name?: string): string {
  return (target === GROUP_UID ? 'To group' : `To ${name ?? 'a rider'}`).toUpperCase();
}

/** "Voice, 6 s", as on the watch history. */
export function memoSummary(durationMs: number): string {
  return `Voice, ${Math.max(1, Math.round(durationMs / 1000))} s`;
}

/** Short id for the slices of one memo. */
export function newClipId(now: number, random: () => number = Math.random): string {
  return `${now.toString(36)}${random().toString(36).slice(2, 6)}`;
}

/** History row title: "LÉA · 09:41". */
export function historyTitle(from: string, t: number): string {
  const d = new Date(t);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${from} · ${pad(d.getHours())}:${pad(d.getMinutes())}`.toUpperCase();
}
