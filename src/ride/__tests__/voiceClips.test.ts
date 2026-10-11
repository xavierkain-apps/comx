import {splitClip, parseVoiceChunk, ClipAssembler, CHUNK_CHARS, ASSEMBLY_TIMEOUT_MS} from '../voiceClips';

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
