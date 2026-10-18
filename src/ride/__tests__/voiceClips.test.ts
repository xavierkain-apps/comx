import {
  splitClip,
  parseVoiceChunk,
  ClipAssembler,
  CHUNK_CHARS,
  ASSEMBLY_TIMEOUT_MS,
  GROUP_UID,
  isClipForMe,
} from '../voiceClips';

const clip = 'A'.repeat(CHUNK_CHARS * 2 + 10);

describe('splitClip', () => {
  it('cuts into slices and puts duration and extension on the first one', () => {
    const chunks = splitClip(clip, 'c1', 42, 3100, 'm4a');
    expect(chunks).toHaveLength(3);
    expect(chunks[0]).toMatchObject({seq: 0, n: 3, ms: 3100, ext: 'm4a', to: 42});
    expect(chunks[2].d).toHaveLength(10);
    expect(chunks[1].ms).toBeUndefined();
    // every message stays well under Agora's 1 KB limit
    chunks.forEach(c => expect(JSON.stringify(c).length).toBeLessThan(1000));
  });
});

describe('parseVoiceChunk', () => {
  it('rejects malformed slices', () => {
    expect(parseVoiceChunk({type: 'vc', id: 'x', to: 1, seq: 3, n: 3, d: ''})).toBeNull();
    expect(parseVoiceChunk({type: 'vc', id: 'x', to: 1, seq: 0, n: 100000, d: ''})).toBeNull();
    expect(parseVoiceChunk({type: 'vc', id: 'x', to: 'me', seq: 0, n: 1, d: ''})).toBeNull();
    expect(parseVoiceChunk({type: 'vc', id: 'x', to: 1, seq: 0, n: 1, d: 'Zg==', ext: '../evil'})?.ext).toBeUndefined();
  });
});

describe('ClipAssembler', () => {
  it('reassembles slices received out of order, once', () => {
    const a = new ClipAssembler();
    const [c0, c1, c2] = splitClip(clip, 'c1', 42, 3100, 'm4a');
    expect(a.add(7, c2, 0)).toBeNull();
    expect(a.add(7, c0, 10)).toBeNull();
    expect(a.add(7, c0, 11)).toBeNull(); // duplicate
    const done = a.add(7, c1, 20);
    expect(done).toEqual({id: 'c1', fromUid: 7, base64: clip, durationMs: 3100, ext: 'm4a'});
    expect(a.size).toBe(0);
  });

  it('keeps clips from different senders apart and drops stalled ones', () => {
    const a = new ClipAssembler();
    const [c0] = splitClip(clip, 'same', 42, 1000, 'm4a');
    a.add(1, c0, 0);
    a.add(2, c0, 0);
    expect(a.size).toBe(2);
    a.expire(ASSEMBLY_TIMEOUT_MS + 1);
    expect(a.size).toBe(0);
  });
});

describe('group clips', () => {
  it('addresses every rider with to: 0 and reassembles like a private clip', () => {
    const chunks = splitClip(clip, 'g1', GROUP_UID, 5000, 'aac');
    expect(chunks).toHaveLength(3);
    expect(chunks.every(c => c.to === 0)).toBe(true);
    // What travels is JSON: parse it back as the receiving phone does
    const parsed = chunks.map(c => parseVoiceChunk(JSON.parse(JSON.stringify(c))));
    expect(parsed.every(c => c !== null && c.to === 0)).toBe(true);
    const a = new ClipAssembler();
    const results = parsed.map((c, i) => a.add(9, c!, i));
    expect(results[0]).toBeNull();
    expect(results[2]).toEqual({id: 'g1', fromUid: 9, base64: clip, durationMs: 5000, ext: 'aac'});
  });

  it('keeps a group clip and a private clip with the same id apart per sender', () => {
    const a = new ClipAssembler();
    const [g0] = splitClip(clip, 'x', GROUP_UID, 1000, 'aac');
    const [p0] = splitClip(clip, 'x', 42, 1000, 'aac');
    a.add(1, g0, 0);
    a.add(2, p0, 0);
    expect(a.size).toBe(2);
  });
});

describe('isClipForMe', () => {
  it('uses 0 for the group, a uid Agora never assigns', () => {
    expect(GROUP_UID).toBe(0);
  });

  it('takes group clips and clips addressed to our uid only', () => {
    expect(isClipForMe(GROUP_UID, 42)).toBe(true);
    expect(isClipForMe(GROUP_UID, null)).toBe(true);
    expect(isClipForMe(42, 42)).toBe(true);
    expect(isClipForMe(42, 7)).toBe(false);
    expect(isClipForMe(42, null)).toBe(false);
  });
});
