// Bridges the channel to the rider's watch (Apple Watch, Wear OS, Garmin).
// The phone stays in the Agora channel; the watch is its microphone, speaker
// and screen. See docs/watch-companion.md.

import React, {createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, ReactNode} from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  AudioFileRecordingType,
  AudioMixingStateType,
  AudioRecordingQualityType,
} from 'react-native-agora';
import {useAgoraContext} from './AgoraContext';
import {useUser} from './UserContext';
import {useRide} from './RideContext';
import {WatchBridge, WatchInfo, WatchPlatform, VOICE_PLATFORMS, isActiveWatch} from '../services/WatchBridge';
import {PROTOCOL_VERSION, buildWatchState, parseWatchMessage} from '../ride/protocol';
import {appLog} from '../utils/logger';
import {micPolicy, WatchModeSetting} from '../ride/micPolicy';
import {
  CHUNK_INTERVAL_MS,
  ClipAssembler,
  MAX_CLIP_CHARS,
  parseVoiceChunk,
  splitClip,
} from '../ride/voiceClips';

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
    connectionState, channelName, getEngine, setMicOverride, isHeadphonesConnected,
    sendStreamJson, subscribeStream, localUid,
  } = useAgoraContext();
  const {pilotName} = useUser();
  const {myPosition, riders, sendQuickMessage, setSos, subscribeRideEvents, logMessage} = useRide();
  const connected = connectionState === 'connected';

  const [watches, setWatches] = useState<WatchInfo[]>([]);
  const [setting, setSettingState] = useState<WatchModeSetting>('auto');
  const [phonePtt, setPhonePtt] = useState(false);
  const [injecting, setInjecting] = useState(false);
  const [helloAt, setHelloAt] = useState<Partial<Record<WatchPlatform, number>>>({});
  const clipDirRef = useRef<string | null>(null);
  const voiceWatchActiveRef = useRef(false);

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

  voiceWatchActiveRef.current = voiceWatchActive;

  const {watchMode, pttMode, override} = micPolicy({
    connected,
    setting,
    voiceWatchActive,
    garminActive,
    headphones: isHeadphonesConnected,
    phonePtt,
    injecting,
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
  // held on a Garmin, and the stream stays published while a watch clip plays.
  useEffect(() => {
    if (connected) setMicOverride(override);
  }, [connected, override, setMicOverride]);

  // ---- Watch clips → channel ------------------------------------------------
  const clipQueueRef = useRef<{path: string; durationMs: number}[]>([]);
  const playingRef = useRef(false);
  const fallbackTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const playNextClip = useCallback(() => {
    const engine = getEngine();
    const next = clipQueueRef.current.shift();
    if (!engine || !next) {
      playingRef.current = false;
      setInjecting(false);
      return;
    }
    playingRef.current = true;
    setInjecting(true);
    // Give the stream a moment to unmute before the clip starts
    setTimeout(() => {
      const ret = engine.startAudioMixing(next.path, false, 1);
      appLog('Watch', `inject clip ${next.path} (${next.durationMs} ms) ret=${ret}`);
      if (fallbackTimerRef.current) clearTimeout(fallbackTimerRef.current);
      // Never get stuck if the mixing-finished callback does not come
      fallbackTimerRef.current = setTimeout(playNextClip, Math.max(next.durationMs, 1000) + 2000);
    }, 150);
  }, [getEngine]);

  useEffect(() => {
    const engine = getEngine();
    if (!engine || !connected) return;
    const onMixing = (state: AudioMixingStateType) => {
      if (state === AudioMixingStateType.AudioMixingStatePlaying) {
        // Others hear the clip; the phone in the pouch does not need to
        engine.adjustAudioMixingPlayoutVolume(0);
        engine.adjustAudioMixingPublishVolume(100);
      }
      if (
        playingRef.current &&
        (state === AudioMixingStateType.AudioMixingStateStopped ||
          state === AudioMixingStateType.AudioMixingStateFailed)
      ) {
        if (fallbackTimerRef.current) clearTimeout(fallbackTimerRef.current);
        playNextClip();
      }
    };
    engine.addListener('onAudioMixingStateChanged', onMixing);
    return () => engine.removeListener('onAudioMixingStateChanged', onMixing);
  }, [connected, getEngine, playNextClip]);

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
    const clipSub = WatchBridge.onClip(({platform, path, durationMs, to}) => {
      appLog('Watch', `clip from ${platform}: ${durationMs} ms${typeof to === 'number' ? ` to ${to}` : ''}`);
      setHelloAt(prev => ({...prev, [platform]: Date.now()}));
      if (typeof to === 'number' && to !== 0) {
        sendPrivateClipRef.current(path, to, durationMs);
        return;
      }
      clipQueueRef.current.push({path, durationMs});
      if (!playingRef.current) playNextClip();
    });
    return () => {
      msgSub?.remove();
      clipSub?.remove();
    };
  }, [sendQuickMessage, setSos, playNextClip]);

  // ---- Private voice messages (one rider) ----------------------------------
  const ridersByUid = useRef(new Map<number, string>());
  ridersByUid.current = new Map(riders.map(r => [r.uid, r.name]));

  const sendPrivateClip = useCallback(async (path: string, to: number, durationMs: number) => {
    const name = ridersByUid.current.get(to) ?? 'a rider';
    const base64 = await WatchBridge.readClipBase64(path);
    if (!base64 || base64.length > MAX_CLIP_CHARS) {
      appLog('Watch', `private clip not sent (${base64 ? 'too long' : 'unreadable'})`);
      logMessage('You', 'voice', `Voice message to ${name} not sent`);
      return;
    }
    const ext = path.split('.').pop()?.toLowerCase() || 'm4a';
    const chunks = splitClip(base64, `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`, to, durationMs, ext);
    chunks.forEach((chunk, i) => {
      setTimeout(() => sendStreamJson(chunk), i * CHUNK_INTERVAL_MS);
    });
    logMessage('You', 'voice', `🎤 Voice message to ${name}`);
  }, [sendStreamJson, logMessage]);
  const sendPrivateClipRef = useRef(sendPrivateClip);
  sendPrivateClipRef.current = sendPrivateClip;

  const assemblerRef = useRef(new ClipAssembler());
  const localUidRef = useRef<number | null>(null);
  localUidRef.current = localUid;

  useEffect(() => {
    return subscribeStream(async (fromUid, raw) => {
      if (raw.type !== 'vc') return;
      const chunk = parseVoiceChunk(raw);
      if (!chunk || chunk.to !== localUidRef.current) return;
      const clip = assemblerRef.current.add(fromUid, chunk, Date.now());
      if (!clip) return;
      const from = ridersByUid.current.get(fromUid) ?? 'A rider';
      const path = await WatchBridge.writeClip(clip.base64, clip.ext);
      logMessage(from, 'voice', '🎤 Voice message for you', fromUid);
      if (!path) {
        appLog('Watch', 'private clip received but could not be saved');
        return;
      }
      if (voiceWatchActiveRef.current) {
        WatchBridge.sendClip(path, {
          v: PROTOCOL_VERSION, kind: 'clip', uid: fromUid, from, durationMs: clip.durationMs, private: true,
        });
      } else {
        // No watch: play it on this phone only (loopback = not sent to the channel)
        getEngine()?.startAudioMixing(path, true, 1);
      }
    });
  }, [subscribeStream, logMessage, getEngine]);

  // ---- Channel → watches ----------------------------------------------------
  const stateRef = useRef<object | null>(null);
  stateRef.current = buildWatchState({
    connected,
    channel: channelName,
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
  }, [connected, watchMode]);

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
  const recordingRef = useRef<{path: string; startedAt: number; lastVoiceAt: number; uids: Set<number>} | null>(null);

  const stopRecording = useCallback(() => {
    const engine = getEngine();
    const rec = recordingRef.current;
    recordingRef.current = null;
    if (!engine || !rec) return;
    engine.stopAudioRecording();
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
      if (recordingRef.current) stopRecording();
      return;
    }
    const timer = setInterval(() => {
      const engine = getEngine();
      const t = Date.now();
      const speaking = ridersRef.current.filter(r => r.speaking).map(r => r.uid);
      const rec = recordingRef.current;

      if (rec) {
        if (speaking.length > 0) {
          rec.lastVoiceAt = t;
          speaking.forEach(uid => rec.uids.add(uid));
        }
        if (!watchMode || t - rec.lastVoiceAt > CLIP_SILENCE_MS || t - rec.startedAt > CLIP_MAX_MS) {
          stopRecording();
        }
        return;
      }

      if (!engine || !watchMode || !clipDirRef.current || speaking.length === 0) return;
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
      recordingRef.current = {path, startedAt: t, lastVoiceAt: t, uids: new Set(speaking)};
    }, 250);
    return () => clearInterval(timer);
  }, [watchMode, getEngine, stopRecording]);

  useEffect(() => {
    if (!connected) {
      recordingRef.current = null;
      clipQueueRef.current = [];
      playingRef.current = false;
      setInjecting(false);
      setPhonePtt(false);
    }
  }, [connected]);

  const value = useMemo(
    () => ({available: WatchBridge.available, watches, watchMode, setting, setSetting, pttMode, phonePtt}),
    [watches, watchMode, setting, setSetting, pttMode, phonePtt],
  );

  return <WatchContext.Provider value={value}>{children}</WatchContext.Provider>;
}

export function useWatch(): WatchContextValue {
  const ctx = useContext(WatchContext);
  if (!ctx) throw new Error('useWatch must be used within a WatchProvider');
  return ctx;
}
