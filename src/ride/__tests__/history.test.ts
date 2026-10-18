import {HISTORY_MAX_CLIPS, HISTORY_MAX_ITEMS, addToHistory} from '../history';

type Item = {key: string; clip?: {n: number}};
const text = (key: string): Item => ({key});
const voice = (key: string): Item => ({key, clip: {n: 1}});
const keys = (items: Item[]) => items.map(i => i.key);

describe('addToHistory', () => {
  it('uses the watch limits', () => {
    expect(HISTORY_MAX_ITEMS).toBe(30);
    expect(HISTORY_MAX_CLIPS).toBe(10);
  });

  it('puts the newest item first', () => {
    expect(keys(addToHistory([text('a')], text('b')))).toEqual(['b', 'a']);
  });

  it('keeps 30 items and drops the oldest', () => {
    let h: Item[] = [];
    for (let i = 0; i < 31; i++) h = addToHistory(h, text(`t${i}`));
    expect(h).toHaveLength(30);
    expect(h[0].key).toBe('t30');
    expect(keys(h)).not.toContain('t0');
  });

  it('keeps the 10 newest voice memos and every text', () => {
    let h: Item[] = [];
    for (let i = 0; i < 11; i++) {
      h = addToHistory(h, voice(`v${i}`));
      h = addToHistory(h, text(`t${i}`));
    }
    expect(h.filter(i => i.clip)).toHaveLength(10);
    expect(keys(h)).not.toContain('v0');
    expect(keys(h)).toContain('v1');
    expect(h.filter(i => !i.clip)).toHaveLength(11);
  });

  it('accepts other limits', () => {
    const h = addToHistory([voice('v1'), text('t1'), voice('v0')], voice('v2'), 3, 1);
    expect(keys(h)).toEqual(['v2', 't1']);
  });

  it('does not change the list it is given', () => {
    const before = [text('a')];
    addToHistory(before, text('b'));
    expect(keys(before)).toEqual(['a']);
  });
});
