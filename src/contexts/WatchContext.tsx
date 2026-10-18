// Bridges the channel to the rider's watch (Apple Watch, Wear OS, Garmin).
// The phone stays in the Agora channel; the watch is its microphone, speaker
// and screen. Voice memos (watch or phone, group or private) are handled by
// MemoContext. See docs/watch-companion.md.

import React, {createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, ReactNode} from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {AudioFileRecordingType, AudioRecordingQualityType} from 'react-native-agora';
import {useAgoraContext} from './AgoraContext';
import {useUser} from './UserContext';
import {useRide} from './RideContext';
import {WatchBridge, WatchInfo, WatchPlatform, VOICE_PLATFORMS, isActiveWatch} from '../services/WatchBridge';
import {PROTOCOL_VERSION, buildWatchState, parseWatchMessage} from '../ride/protocol';
import {appLog} from '../utils/logger';
import {micPolicy, WatchModeSetting} from '../ride/micPolicy';

export type {WatchModeSetting};
const SETTING_KEY = '@soarx_watch_mode';

const STATE_INTERVAL_MS = 2000;
/** Remote speech is cut into a clip after this much silence. */
const CLIP_SILENCE_MS = 1200;
const CLIP_MAX_MS = 30_000;
const CLIP_MIN_MS = 400;
/** A rider counts as done talking after this much silence. */
const SPEAKING_END_MS = 1500;
/** A watch that said hello is considered active for this long. */
const HELLO_TTL_MS = 5 * 60_000;
/** "Talk via phone" closes by itself after this long. */
const PTT_TIMEOUT_MS = 60_000;

interface WatchContextValue {
  available: boolean;
  watches: WatchInfo[];
  /** True when the phone mic is off and voice goes through the watch. */
  watchMode: boolean;
  /** An Apple Watch or Wear OS watch with ComX is active: memos go to it. */
  voiceWatch: boolean;
  setting: WatchModeSetting;
  setSetting: (s: WatchModeSetting) => void;
  /**
   * A Garmin (no microphone) is in use: the phone mic stays off except while
   * the rider holds "talk via phone" on the watch.
   */
  pttMode: boolean;
  /** "Talk via phone" is active right now. */
  phonePtt: boolean;
}

const WatchContext = createContext<WatchContextValue | null>(null);

export function WatchProvider({children}: {children: ReactNode}) {
  const {
    connectionState, channelName, getEngine, setMicOverride, isHeadphonesConnected, isMemoCapture, memoCaptureEpoch,
  } = useAgoraContext();
  const {pilotName} = useUser();
  const {myPosition, riders, sendQuickMessage, setSos, subscribeRideEvents, demo} = useRide();
  const connected = connectionState === 'connected';

  const [watches, setWatches] = useState<WatchInfo[]>([]);
  const [setting, setSettingState] = useState<WatchModeSetting>('auto');
  const [phonePtt, setPhonePtt] = useState(false);
  const [helloAt, setHelloAt] = useState<Partial<Record<WatchPlatform, number>>>({});
  const clipDirRef = useRef<string | null>(null);

  useEffect(() => {
    AsyncStorage.getItem(SETTING_KEY).then(v => {
      if (v === 'on' || v === 'off' || v === 'auto') setSettingState(v);
    });
  }, []);

  const setSetting = useCallback((s: WatchModeSetting) => {
    setSettingState(s);
    AsyncStorage.setItem(SETTING_KEY, s);
  }, []);

  // Native links and watch status
  useEffect(() => {
    if (!WatchBridge.available) return;
    WatchBridge.start();
    WatchBridge.getStatus().then(setWatches);
    WatchBridge.getClipDir().then(dir => {
      clipDirRef.current = dir;
    });
    const sub = WatchBridge.onStatus(e => setWatches(e.watches ?? []));
    return () => sub?.remove();
  }, []);

  const now = Date.now();
  const voiceWatchActive =
    watches.some(w => isActiveWatch(w) && VOICE_PLATFORMS.includes(w.platform)) ||
    VOICE_PLATFORMS.some(p => (helloAt[p] ?? 0) > now - HELLO_TTL_MS);

  const garminActive =
    watches.some(w => isActiveWatch(w) && w.platform === 'garmin') ||
    (helloAt.garmin ?? 0) > now - HELLO_TTL_MS;

  const {watchMode, pttMode, override} = micPolicy({
    connected,
    setting,
    voiceWatchActive,
    garminActive,
    headphones: isHeadphonesConnected,
    phonePtt,
  });

  // If the Garmin drops while "talk via phone" is on, never leave the mic open
  useEffect(() => {
    if (!phonePtt) return;
    const timer = setTimeout(() => {
      appLog('Watch', 'talk via phone timed out');
      setPhonePtt(false);
    }, PTT_TIMEOUT_MS);
    return () => clearTimeout(timer);
  }, [phonePtt]);

  // Phone mic: off while it sits in a pouch, open while "talk via phone" is
  // held on a Garmin.
  useEffect(() => {
    if (connected) setMicOverride(override);
  }, [connected, override, setMicOverride]);

  // ---- Messages from watches ------------------------------------------------
  useEffect(() => {
    const msgSub = WatchBridge.onMessage(({platform, json}) => {
      const msg = parseWatchMessage(json);
      if (!msg) return;
      switch (msg.kind) {
        case 'hello':
          appLog('Watch', `hello from ${platform} ${msg.model ?? ''}`);
          setHelloAt(prev => ({...prev, [platform]: Date.now()}));
          break;
        case 'text':
          sendQuickMessage(msg.id, msg.text);
          break;
        case 'sos':
          setSos(msg.active);
          break;
        case 'ptt':
          setPhonePtt(msg.active);
          break;
      }
    });
    // The clip itself is MemoContext's; it still proves the watch is there.
    const clipSub = WatchBridge.onClip(({platform}) => {
      setHelloAt(prev => ({...prev, [platform]: Date.now()}));
    });
    return () => {
      msgSub?.remove();
      clipSub?.remove();
    };
  }, [sendQuickMessage, setSos]);

  // ---- Channel → watches ----------------------------------------------------
  const stateRef = useRef<object | null>(null);
  // Demo mode without a channel still looks like one to the watch
  const demoOnly = demo && !connected;
  stateRef.current = buildWatchState({
    connected: connected || demo,
    channel: demoOnly ? 'Demo' : channelName,
    watchMode,
    myName: pilotName,
    me: myPosition,
    riders,
    now,
  });

  useEffect(() => {
    if (!WatchBridge.available) return;
    if (stateRef.current) WatchBridge.sendState(stateRef.current);
    const timer = setInterval(() => {
      if (stateRef.current) WatchBridge.sendState(stateRef.current);
    }, STATE_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [connected, watchMode, demo]);

  // Text and SOS events
  const ridersRef = useRef(riders);
  ridersRef.current = riders;
  useEffect(() => {
    return subscribeRideEvents(e => {
      const rider = ridersRef.current.find(r => r.uid === e.uid);
      if (e.type === 'text') {
        WatchBridge.sendEvent({v: PROTOCOL_VERSION, kind: 'event', type: 'text', uid: e.uid, from: e.from, id: e.id, text: e.text});
      } else {
        WatchBridge.sendEvent({
          v: PROTOCOL_VERSION, kind: 'event', type: 'sos', uid: e.uid, from: e.from, active: e.active,
          dist: rider?.dist ?? null, brg: rider?.brg ?? null,
        });
      }
    });
  }, [subscribeRideEvents]);

  // Speaking events + remote speech recorded into clips for the watch speaker
  // `epoch`: memoCaptureEpoch() when it started; a later value means a phone
  // memo took Agora's recorder (and stopped this clip), even if the memo failed.
  const recordingRef = useRef<{path: string; startedAt: number; lastVoiceAt: number; uids: Set<number>; epoch: number} | null>(null);

  /** `engineStopped`: a phone memo already stopped Agora's recorder. */
  const stopRecording = useCallback((engineStopped = false) => {
    const engine = getEngine();
    const rec = recordingRef.current;
    recordingRef.current = null;
    if (!engine || !rec) return;
    if (!engineStopped) engine.stopAudioRecording();
    const durationMs = Math.min(Date.now(), rec.lastVoiceAt + 300) - rec.startedAt;
    if (durationMs < CLIP_MIN_MS) return;
    const names = [...rec.uids].map(uid => ridersRef.current.find(r => r.uid === uid)?.name ?? 'A rider');
    const uid = [...rec.uids][0] ?? 0;
    // Let the SDK finish writing the file
    setTimeout(() => {
      WatchBridge.sendClip(rec.path, {v: PROTOCOL_VERSION, kind: 'clip', uid, from: names.join(', '), durationMs});
    }, 400);
  }, [getEngine]);

  // Tell watches who is talking (haptic cue before the clip arrives). Volume
  // drops between words, so "stopped" is only sent after a real pause.
  useEffect(() => {
    if (!connected || !WatchBridge.available) return;
    const announced = new Map<number, number>();
    const timer = setInterval(() => {
      const t = Date.now();
      for (const r of ridersRef.current) {
        const announcedAt = announced.get(r.uid);
        if (r.speaking) {
          if (announcedAt === undefined) {
            WatchBridge.sendEvent({v: PROTOCOL_VERSION, kind: 'event', type: 'speaking', uid: r.uid, from: r.name, active: true});
          }
          announced.set(r.uid, t);
        } else if (announcedAt !== undefined && t - announcedAt > SPEAKING_END_MS) {
          announced.delete(r.uid);
          WatchBridge.sendEvent({v: PROTOCOL_VERSION, kind: 'event', type: 'speaking', uid: r.uid, from: r.name, active: false});
        }
      }
    }, 250);
    return () => clearInterval(timer);
  }, [connected]);

  // Record remote speech while in watch mode. Polled because the pilot list
  // only re-renders when a volume bucket changes, not while someone keeps talking.
  useEffect(() => {
    if (!watchMode) {
      // Never stop Agora's recorder if a phone memo owns it now
      const rec = recordingRef.current;
      if (rec) stopRecording(isMemoCapture() || rec.epoch !== memoCaptureEpoch());
      return;
    }
    const timer = setInterval(() => {
      // A phone memo owns Agora's single file recorder (it stopped ours when it
      // started): send what we had and wait until it is done.
      if (isMemoCapture()) {
        if (recordingRef.current) stopRecording(true);
        return;
      }
      // A memo took the recorder and failed to start: ours is stopped already
      if (recordingRef.current && recordingRef.current.epoch !== memoCaptureEpoch()) {
        stopRecording(true);
      }
      const engine = getEngine();
      const t = Date.now();
      const speaking = ridersRef.current.filter(r => r.speaking).map(r => r.uid);
      const rec = recordingRef.current;

      if (rec) {
        if (speaking.length > 0) {
          rec.lastVoiceAt = t;
          speaking.forEach(uid => rec.uids.add(uid));
        }
        if (t - rec.lastVoiceAt > CLIP_SILENCE_MS || t - rec.startedAt > CLIP_MAX_MS) {
          stopRecording();
        }
        return;
      }

      if (!engine || !clipDirRef.current || speaking.length === 0) return;
      const path = `${clipDirRef.current}/rx-${t}.aac`;
      const ret = engine.startAudioRecording({
        filePath: path,
        encode: true,
        sampleRate: 16000,
        fileRecordingType: AudioFileRecordingType.AudioFileRecordingPlayback,
        quality: AudioRecordingQualityType.AudioRecordingQualityLow,
        recordingChannel: 1,
      });
      if (ret !== 0) {
        appLog('Watch', `startAudioRecording failed ret=${ret}`);
        return;
      }
      recordingRef.current = {path, startedAt: t, lastVoiceAt: t, uids: new Set(speaking), epoch: memoCaptureEpoch()};
    }, 250);
    return () => clearInterval(timer);
  }, [watchMode, getEngine, stopRecording, isMemoCapture, memoCaptureEpoch]);

  useEffect(() => {
    if (!connected) {
      recordingRef.current = null;
      setPhonePtt(false);
    }
  }, [connected]);

  const value = useMemo(
    () => ({
      available: WatchBridge.available, watches, watchMode, voiceWatch: voiceWatchActive, setting, setSetting, pttMode, phonePtt,
    }),
    [watches, watchMode, voiceWatchActive, setting, setSetting, pttMode, phonePtt],
  );

  return <WatchContext.Provider value={value}>{children}</WatchContext.Provider>;
}

export function useWatch(): WatchContextValue {
  const ctx = useContext(WatchContext);
  if (!ctx) throw new Error('useWatch must be used within a WatchProvider');
  return ctx;
}
