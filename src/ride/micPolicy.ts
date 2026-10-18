// When the phone microphone is on, off, or forced open, given the watches
// around. Kept pure so it can be tested without a device.

import type {MicOverride} from '../contexts/AgoraContext';

export type WatchModeSetting = 'auto' | 'on' | 'off';

export interface MicPolicyInput {
  connected: boolean;
  setting: WatchModeSetting;
  /** An Apple Watch or Wear OS watch with our app is active. */
  voiceWatchActive: boolean;
  /** A Garmin with our app is active. */
  garminActive: boolean;
  headphones: boolean;
  /** "Talk via phone" held on a Garmin. */
  phonePtt: boolean;
}

export interface MicPolicy {
  watchMode: boolean;
  pttMode: boolean;
  override: MicOverride;
}

export function micPolicy(i: MicPolicyInput): MicPolicy {
  const watchMode =
    i.connected && (i.setting === 'on' || (i.setting === 'auto' && i.voiceWatchActive && !i.headphones));
  const pttMode = i.connected && !watchMode && i.setting !== 'off' && i.garminActive && !i.headphones;
  let override: MicOverride = 'normal';
  if (i.phonePtt) override = 'open';
  else if (watchMode || pttMode) override = 'silenced';
  return {watchMode, pttMode, override};
}
