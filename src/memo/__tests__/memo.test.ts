import {
  MEMO_MAX_MS,
  MEMO_MIN_MS,
  historyTitle,
  memoDurationMs,
  memoRecipient,
  memoSecondsLeft,
  memoSummary,
  memoTargetLabel,
  newClipId,
  resolveMemoTarget,
  toggleMemoTarget,
} from '../memo';

describe('memo limits', () => {
  it('caps a memo at 30 s and ignores taps shorter than 0.6 s', () => {
    expect(MEMO_MAX_MS).toBe(30_000);
    expect(MEMO_MIN_MS).toBe(600);
  });

  it('counts down whole seconds to 0', () => {
    expect(memoSecondsLeft(1000, 1000)).toBe(30);
    expect(memoSecondsLeft(0, 200)).toBe(30);
    expect(memoSecondsLeft(0, 29_100)).toBe(1);
    expect(memoSecondsLeft(0, 30_000)).toBe(0);
    expect(memoSecondsLeft(0, 45_000)).toBe(0);
  });

  it('measures the recorded length within 0 and 30 s', () => {
    expect(memoDurationMs(0, 4200)).toBe(4200);
    expect(memoDurationMs(0, 45_000)).toBe(30_000);
    expect(memoDurationMs(100, 50)).toBe(0);
  });
});

describe('memoRecipient', () => {
  it('sends to the group unless a rider uid is given', () => {
    expect(memoRecipient(undefined)).toBe(0);
    expect(memoRecipient(null)).toBe(0);
    expect(memoRecipient(0)).toBe(0);
    expect(memoRecipient(NaN)).toBe(0);
    expect(memoRecipient('42')).toBe(0);
    expect(memoRecipient(42)).toBe(42);
    expect(memoRecipient(3_000_000_000)).toBe(3_000_000_000);
  });
});

describe('recipient while recording', () => {
  it('picks a rider, moves to another, and goes back to the group on a second tap', () => {
    expect(toggleMemoTarget(0, 42)).toBe(42);
    expect(toggleMemoTarget(42, 7)).toBe(7);
    expect(toggleMemoTarget(7, 7)).toBe(0);
    expect(toggleMemoTarget(0, 0)).toBe(0);
  });

  it('never sends to a rider who left, nor redirects to the group', () => {
    const present = new Set([42]);
    expect(resolveMemoTarget(0, present)).toBe(0);
    expect(resolveMemoTarget(0, new Set())).toBe(0);
    expect(resolveMemoTarget(42, present)).toBe(42);
    expect(resolveMemoTarget(7, present)).toBeNull();
  });

  it('labels the recipient', () => {
    expect(memoTargetLabel(0)).toBe('TO GROUP');
    expect(memoTargetLabel(0, 'Léa')).toBe('TO GROUP');
    expect(memoTargetLabel(42, 'Léa')).toBe('TO LÉA');
    expect(memoTargetLabel(42)).toBe('TO A RIDER');
  });
});

describe('labels', () => {
  it('summarises a memo like the watch history', () => {
    expect(memoSummary(6200)).toBe('Voice, 6 s');
    expect(memoSummary(300)).toBe('Voice, 1 s');
  });

  it('titles a history row "NAME · HH:MM"', () => {
    expect(historyTitle('Léa', new Date(2026, 9, 19, 9, 5).getTime())).toBe('LÉA · 09:05');
    expect(historyTitle('To group', new Date(2026, 9, 19, 14, 30).getTime())).toBe('TO GROUP · 14:30');
  });

  it('makes short clip ids', () => {
    expect(newClipId(36, () => 0.5)).toBe('10i');
    expect(newClipId(Date.now())).toMatch(/^[0-9a-z]+$/);
  });
});
