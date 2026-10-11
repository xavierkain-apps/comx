// Typed wrapper over the native WatchBridge module (iOS: WatchConnectivity and
// Garmin; Android: Wear OS Data Layer and Garmin). Every call is a no-op when
// the native module is missing, so the app still runs without watch support.

import {NativeEventEmitter, NativeModules, EmitterSubscription} from 'react-native';
import {appLog} from '../utils/logger';

export type WatchPlatform = 'watchos' | 'wearos' | 'garmin';

export interface WatchInfo {
  platform: WatchPlatform;
  name: string;
  paired: boolean;
  installed: boolean;
  reachable: boolean;
}

interface NativeWatchBridge {
  start(): void;
  sendState(json: string): void;
  sendEvent(json: string): void;
  sendClip(path: string, metaJson: string): void;
  getStatus(): Promise<WatchInfo[]>;
  getClipDir(): Promise<string>;
}

const native: NativeWatchBridge | undefined = NativeModules.WatchBridge;
const emitter = native ? new NativeEventEmitter(NativeModules.WatchBridge) : null;

/** Platforms whose watch app can record and play voice clips. */
export const VOICE_PLATFORMS: WatchPlatform[] = ['watchos', 'wearos'];

export const WatchBridge = {
  available: !!native,

  start() {
    try {
      native?.start();
    } catch (e) {
      appLog('Watch', `start failed: ${String(e)}`);
    }
  },

  sendState(state: object) {
    native?.sendState(JSON.stringify(state));
  },

  sendEvent(event: object) {
    native?.sendEvent(JSON.stringify(event));
  },

  sendClip(path: string, meta: object) {
    native?.sendClip(path, JSON.stringify(meta));
  },

  async getStatus(): Promise<WatchInfo[]> {
    if (!native) return [];
    try {
      return await native.getStatus();
    } catch {
      return [];
    }
  },

  async getClipDir(): Promise<string | null> {
    if (!native?.getClipDir) return null;
    try {
      return await native.getClipDir();
    } catch {
      return null;
    }
  },

  onMessage(cb: (e: {platform: WatchPlatform; json: string}) => void): EmitterSubscription | null {
    return emitter ? emitter.addListener('WatchMessage', cb) : null;
  },

  onClip(cb: (e: {platform: WatchPlatform; path: string; durationMs: number}) => void): EmitterSubscription | null {
    return emitter ? emitter.addListener('WatchClip', cb) : null;
  },

  onStatus(cb: (e: {watches: WatchInfo[]}) => void): EmitterSubscription | null {
    return emitter ? emitter.addListener('WatchStatus', cb) : null;
  },
};

/** A watch that is paired, has our app and is reachable right now. */
export function isActiveWatch(w: WatchInfo): boolean {
  return w.paired && w.installed && w.reachable;
}
