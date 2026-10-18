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
  readClipBase64?(path: string): Promise<string>;
  writeClip?(base64: string, ext: string): Promise<string>;
  selectGarminDevices?(): Promise<void>;
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

  /** Read a clip as base64 to send it as a memo over the data stream. */
  async readClipBase64(path: string): Promise<string | null> {
    if (!native?.readClipBase64) return null;
    try {
      return await native.readClipBase64(path);
    } catch {
      return null;
    }
  },

  /** Save a received clip and return its path. */
  async writeClip(base64: string, ext: string): Promise<string | null> {
    if (!native?.writeClip) return null;
    try {
      return await native.writeClip(base64, ext);
    } catch {
      return null;
    }
  },

  /** iOS: let the user pick Garmin watches in Garmin Connect. */
  canSelectGarmin: !!native?.selectGarminDevices,
  async selectGarminDevices(): Promise<void> {
    await native?.selectGarminDevices?.();
  },

  onMessage(cb: (e: {platform: WatchPlatform; json: string}) => void): EmitterSubscription | null {
    return emitter ? emitter.addListener('WatchMessage', cb) : null;
  },

  onClip(cb: (e: {platform: WatchPlatform; path: string; durationMs: number; to?: number | null}) => void): EmitterSubscription | null {
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
