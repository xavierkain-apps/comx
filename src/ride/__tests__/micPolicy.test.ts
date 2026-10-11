import {micPolicy, MicPolicyInput} from '../micPolicy';

const base: MicPolicyInput = {
  connected: true,
  setting: 'auto',
  voiceWatchActive: false,
  garminActive: false,
  headphones: false,
  phonePtt: false,
  injecting: false,
};

describe('micPolicy', () => {
  it('leaves the mic to the mute button without a watch', () => {
    expect(micPolicy(base)).toEqual({watchMode: false, pttMode: false, override: 'normal'});
  });

  it('enters watch mode with an Apple Watch or Wear OS watch and silences the phone', () => {
    expect(micPolicy({...base, voiceWatchActive: true})).toEqual({watchMode: true, pttMode: false, override: 'silenced'});
  });

  it('stays out of watch mode when headphones are connected', () => {
    expect(micPolicy({...base, voiceWatchActive: true, headphones: true}).watchMode).toBe(false);
  });

  it('forces watch mode with "on" and never with "off"', () => {
    expect(micPolicy({...base, setting: 'on'}).watchMode).toBe(true);
    expect(micPolicy({...base, setting: 'off', voiceWatchActive: true, garminActive: true})).toEqual({
      watchMode: false, pttMode: false, override: 'normal',
    });
  });

  it('keeps the phone silent with a Garmin until talk via phone is held', () => {
    expect(micPolicy({...base, garminActive: true})).toEqual({watchMode: false, pttMode: true, override: 'silenced'});
    expect(micPolicy({...base, garminActive: true, phonePtt: true}).override).toBe('open');
  });

  it('keeps the stream published while a clip is injected', () => {
    expect(micPolicy({...base, injecting: true}).override).toBe('silenced');
  });

  it('does nothing when not connected', () => {
    expect(micPolicy({...base, connected: false, voiceWatchActive: true, garminActive: true})).toMatchObject({
      watchMode: false, pttMode: false,
    });
  });
});
