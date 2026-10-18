// Voice memos. Recorded on this phone (MEMO button) or on the watch, sent to
// the group (`to: 0`) or to one rider over the Agora data stream
// (src/ride/voiceClips.ts). Received memos play on this phone (not in watch
// mode: the phone is in a pouch), go to an active Apple Watch / Wear OS watch
// and into the history (RideContext messages, replayable).

import React, {createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, ReactNode} from 'react';
import {Vibration} from 'react-native';
import Sound from 'react-native-sound';
import {AudioFileRecordingType, AudioMixingStateType, AudioRecordingQualityType} from 'react-native-agora';
import {useAgoraContext} from './AgoraContext';
import {HistoryClip, useRide} from './RideContext';
import {useWatch} from './WatchContext';
import {WatchBridge} from '../services/WatchBridge';
import {PROTOCOL_VERSION} from '../ride/protocol';
import {
  CHUNK_INTERVAL_MS,
  ClipAssembler,
  GROUP_UID,
  MAX_CLIP_CHARS,
  isClipForMe,
  parseVoiceChunk,
  splitClip,
} from '../ride/voiceClips';
import {DEMO_RIDERS, demoRider, isDemoUid} from '../ride/demo';
import {
  MEMO_MAX_MS,
  MEMO_MIN_MS,
  memoDurationMs,
  memoRecipient,
  memoSecondsLeft,
  memoSummary,
  memoTargetLabel,
  newClipId,
  resolveMemoTarget,
  toggleMemoTarget,
} from '../memo/memo';
import {appLog} from '../utils/logger';

/** Demo mode: a virtual rider answers a memo after this long. */
const DEMO_ECHO_DELAY_MS = 2000;
/** Let Agora finish writing the memo file before reading it. */
const FILE_SETTLE_MS = 400;

interface MemoContextValue {
  /** The phone is recording a memo. */
  recording: boolean;
  /** Seconds left before the memo goes to the group by itself. */
  secondsLeft: number;
  /** A memo can be recorded (in a channel). */
  canRecord: boolean;
  startMemo: () => void;
  /** Stop and send to the selected recipient (the group by default). */
  sendMemo: () => void;
  /** Recipient while recording: GROUP_UID or a rider uid. */
  target: number;
  /** "TO GROUP" or "TO LÉA". */
  targetLabel: string;
  /** While recording: tap a rider to pick them, tap them again for the group. */
  selectTarget: (uid: number) => void;
  /** Play a memo of the history again. */
  replay: (clip: HistoryClip) => void;
}

const MemoContext = createContext<MemoContextValue | null>(null);

/** Plays a file outside Agora (no channel, or Agora could not open it). */
function playWithSound(path: string, done: () => void) {
  const sound: Sound = new Sound(path, '', err => {
    if (err) {
      appLog('Memo', `cannot play ${path}: ${String(err)}`);
      done();
      return;
    }
    sound.play(() => {
      sound.release();
      done();
    });
  });
}

export function MemoProvider({children}: {children: ReactNode}) {
  const {connectionState, getEngine, sendStreamJson, subscribeStream, localUid, setMemoCapture} = useAgoraContext();
  const {riders, logMessage, demo} = useRide();
  const {watchMode, voiceWatch} = useWatch();
  const connected = connectionState === 'connected';

  // Latest values for callbacks fired by native events and timers
  const live = useRef({connected, demo, watchMode, voiceWatch, localUid, names: new Map<number, string>()});
  live.current = {connected, demo, watchMode, voiceWatch, localUid, names: new Map(riders.map(r => [r.uid, r.name]))};

  const nameOf = useCallback(
    (uid: number) => live.current.names.get(uid) ?? demoRider(uid)?.name ?? 'A rider',
    [],
  );

  // ---- Playback on this phone ----------------------------------------------
  const queueRef = useRef<HistoryClip[]>([]);
  const playingRef = useRef(false);
  const fallbackRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const currentPathRef = useRef<string | null>(null);

  const playNext = useCallback(async () => {
    if (fallbackRef.current) {
      clearTimeout(fallbackRef.current);
      fallbackRef.current = null;
    }
    const clip = queueRef.current.shift();
    if (!clip) {
      playingRef.current = false;
      currentPathRef.current = null;
      return;
    }
    playingRef.current = true;
    // A fresh file per playback: sendClip deletes the files it forwards
    const path = await WatchBridge.writeClip(clip.base64, clip.ext);
    if (!path) {
      appLog('Memo', 'cannot write the memo for playback');
      playNext();
      return;
    }
    currentPathRef.current = path;
    const engine = getEngine();
    if (engine && live.current.connected) {
      // Loopback: heard on this phone only, not sent to the channel
      const ret = engine.startAudioMixing(path, true, 1);
      appLog('Memo', `play ${path} (${clip.durationMs} ms) ret=${ret}`);
      if (ret === 0) {
        // Never get stuck if the mixing-finished callback does not come
        fallbackRef.current = setTimeout(playNext, Math.max(clip.durationMs, 1000) + 2000);
        return;
      }
    }
    playWithSound(path, playNext);
  }, [getEngine]);

  useEffect(() => {
    const engine = getEngine();
    if (!engine || !connected) return;
    const onMixing = (state: AudioMixingStateType) => {
      if (!playingRef.current) return;
      if (state === AudioMixingStateType.AudioMixingStateStopped) {
        playNext();
      } else if (state === AudioMixingStateType.AudioMixingStateFailed) {
        // Agora could not open the file: same file, plain player
        if (fallbackRef.current) clearTimeout(fallbackRef.current);
        fallbackRef.current = null;
        const path = currentPathRef.current;
        if (path) playWithSound(path, playNext);
        else playNext();
      }
    };
    engine.addListener('onAudioMixingStateChanged', onMixing);
    return () => engine.removeListener('onAudioMixingStateChanged', onMixing);
  }, [connected, getEngine, playNext]);

  const play = useCallback((clip: HistoryClip) => {
    queueRef.current.push(clip);
    if (!playingRef.current) playNext();
  }, [playNext]);

  // ---- Receiving ------------------------------------------------------------
  const deliver = useCallback(async (fromUid: number, clip: HistoryClip, isPrivate: boolean) => {
    const from = nameOf(fromUid);
    logMessage(from, 'voice', isPrivate ? `${memoSummary(clip.durationMs)} · for you` : memoSummary(clip.durationMs), fromUid, clip);
    Vibration.vibrate(200);
    if (live.current.voiceWatch) {
      const path = await WatchBridge.writeClip(clip.base64, clip.ext);
      if (path) {
        WatchBridge.sendClip(path, {
          v: PROTOCOL_VERSION, kind: 'clip', uid: fromUid, from, durationMs: clip.durationMs, private: isPrivate,
        });
      }
    }
    // Decision 3: in watch mode the phone sits in a pouch, the watch plays it
    if (!live.current.watchMode) play(clip);
  }, [logMessage, nameOf, play]);

  const assemblerRef = useRef(new ClipAssembler());

  useEffect(() => {
    return subscribeStream((fromUid, raw) => {
      if (raw.type !== 'vc') return;
      const chunk = parseVoiceChunk(raw);
      if (!chunk || !isClipForMe(chunk.to, live.current.localUid)) return;
      const clip = assemblerRef.current.add(fromUid, chunk, Date.now());
      if (!clip) return;
      deliver(fromUid, {base64: clip.base64, ext: clip.ext, durationMs: clip.durationMs}, chunk.to !== GROUP_UID);
    });
  }, [subscribeStream, deliver]);

  // ---- Demo: the virtual rider sends the memo back --------------------------
  const echoDemo = useCallback((clip: HistoryClip, to: number) => {
    const rider = demoRider(to) ?? DEMO_RIDERS[0];
    const meta = {uid: rider.uid, from: rider.name};
    setTimeout(() => {
      if (!live.current.demo) return;
      WatchBridge.sendEvent({v: PROTOCOL_VERSION, kind: 'event', type: 'speaking', ...meta, active: true});
      deliver(rider.uid, clip, to !== GROUP_UID);
      setTimeout(() => {
        WatchBridge.sendEvent({v: PROTOCOL_VERSION, kind: 'event', type: 'speaking', ...meta, active: false});
      }, Math.max(clip.durationMs, 1000));
    }, DEMO_ECHO_DELAY_MS);
  }, [deliver]);

  // ---- Sending ----------------------------------------------------------------
  /** Sends a memo (or echoes it in demo mode). False when it could not go. */
  const transmit = useCallback((clip: HistoryClip, to: number): boolean => {
    const who = to === GROUP_UID ? 'To group' : `To ${nameOf(to)}`;
    // Demo: memos to a virtual rider, or any memo without a real channel
    if (live.current.demo && (isDemoUid(to) || !live.current.connected)) {
      logMessage(who, 'voice', memoSummary(clip.durationMs), null, clip);
      echoDemo(clip, to);
      return true;
    }
    if (clip.base64.length > MAX_CLIP_CHARS) {
      logMessage('You', 'voice', 'Voice memo too long, not sent');
      return false;
    }
    if (!live.current.connected) {
      logMessage('You', 'voice', 'Voice memo not sent: not connected');
      return false;
    }
    const chunks = splitClip(clip.base64, newClipId(Date.now()), to, clip.durationMs, clip.ext);
    chunks.forEach((chunk, i) => {
      setTimeout(() => sendStreamJson(chunk), i * CHUNK_INTERVAL_MS);
    });
    appLog('Memo', `sending ${chunks.length} slices to ${to === GROUP_UID ? 'the group' : to}`);
    logMessage(who, 'voice', memoSummary(clip.durationMs), null, clip);
    return true;
  }, [echoDemo, logMessage, nameOf, sendStreamJson]);

  // Memos recorded on the watch: `to` absent, null or 0 = the group
  useEffect(() => {
    const sub = WatchBridge.onClip(async ({platform, path, durationMs, to}) => {
      appLog('Memo', `watch clip from ${platform}: ${durationMs} ms${typeof to === 'number' ? ` to ${to}` : ''}`);
      const base64 = await WatchBridge.readClipBase64(path);
      if (!base64) {
        logMessage('You', 'voice', 'Voice memo from the watch could not be read');
        return;
      }
      const ext = path.split('.').pop()?.toLowerCase() || 'm4a';
      transmit({base64, ext, durationMs}, memoRecipient(to));
    });
    return () => sub?.remove();
  }, [logMessage, transmit]);

  // ---- Recording on this phone --------------------------------------------
  const [recording, setRecording] = useState(false);
  const [secondsLeft, setSecondsLeft] = useState(MEMO_MAX_MS / 1000);
  const recRef = useRef<{path: string; startedAt: number} | null>(null);
  const clipDirRef = useRef<string | null>(null);
  // Recipient of the memo being recorded (owner decision 8)
  const [target, setTarget] = useState<number>(GROUP_UID);
  const targetRef = useRef<number>(GROUP_UID);
  const targetNameRef = useRef('the group');

  const selectTarget = useCallback((uid: number) => {
    if (!recRef.current) return;
    const next = toggleMemoTarget(targetRef.current, uid);
    targetRef.current = next;
    targetNameRef.current = next === GROUP_UID ? 'the group' : nameOf(next);
    setTarget(next);
    Vibration.vibrate(20);
  }, [nameOf]);

  useEffect(() => {
    WatchBridge.getClipDir().then(dir => {
      clipDirRef.current = dir;
    });
  }, []);

  const stopRecorder = useCallback((): {path: string; durationMs: number} | null => {
    const rec = recRef.current;
    recRef.current = null;
    setRecording(false);
    if (!rec) return null;
    getEngine()?.stopAudioRecording();
    setMemoCapture(false);
    return {path: rec.path, durationMs: memoDurationMs(rec.startedAt, Date.now())};
  }, [getEngine, setMemoCapture]);

  const sendMemo = useCallback(() => {
    const done = stopRecorder();
    if (!done) return;
    // Never redirected: a memo for a rider who left is not sent at all
    const to = resolveMemoTarget(targetRef.current, new Set(live.current.names.keys()));
    if (to === null) {
      logMessage('You', 'voice', `Voice memo not sent: ${targetNameRef.current} left the channel`);
      return;
    }
    if (done.durationMs < MEMO_MIN_MS) {
      logMessage('You', 'voice', 'Voice memo too short, not sent');
      return;
    }
    Vibration.vibrate(50);
    setTimeout(async () => {
      const base64 = await WatchBridge.readClipBase64(done.path);
      if (!base64) {
        appLog('Memo', `no recording at ${done.path}`);
        logMessage('You', 'voice', 'Voice memo failed: nothing was recorded');
        return;
      }
      transmit({base64, ext: 'aac', durationMs: done.durationMs}, to);
    }, FILE_SETTLE_MS);
  }, [logMessage, stopRecorder, transmit]);

  const startMemo = useCallback(() => {
    const engine = getEngine();
    const dir = clipDirRef.current;
    if (recRef.current || !engine || !live.current.connected) return;
    if (!dir) {
      logMessage('You', 'voice', 'Voice memo failed: no folder to record into');
      return;
    }
    // Agora has one file recorder: take it from the watch's remote-speech clip
    engine.stopAudioRecording();
    setMemoCapture(true);
    const path = `${dir}/memo-${Date.now()}.aac`;
    const ret = engine.startAudioRecording({
      filePath: path,
      encode: true,
      sampleRate: 16000,
      fileRecordingType: AudioFileRecordingType.AudioFileRecordingMic,
      quality: AudioRecordingQualityType.AudioRecordingQualityLow,
      recordingChannel: 1,
    });
    if (ret !== 0) {
      setMemoCapture(false);
      appLog('Memo', `startAudioRecording(mic) failed ret=${ret}`);
      logMessage('You', 'voice', 'Voice memo failed: microphone not available');
      Vibration.vibrate([0, 100, 100, 100]);
      return;
    }
    recRef.current = {path, startedAt: Date.now()};
    targetRef.current = GROUP_UID;
    targetNameRef.current = 'the group';
    setTarget(GROUP_UID);
    setSecondsLeft(MEMO_MAX_MS / 1000);
    setRecording(true);
    Vibration.vibrate(50);
  }, [getEngine, logMessage, setMemoCapture]);

  // Countdown; at 30 s the memo goes to the selected recipient by itself
  useEffect(() => {
    if (!recording) return;
    const timer = setInterval(() => {
      const rec = recRef.current;
      if (!rec) return;
      const left = memoSecondsLeft(rec.startedAt, Date.now());
      setSecondsLeft(left);
      if (left === 0) sendMemo();
    }, 250);
    return () => clearInterval(timer);
  }, [recording, sendMemo]);

  // Leaving the channel ends a recording without sending it. A short
  // 'reconnecting' keeps it; sending while still reconnecting is refused by
  // transmit ("not connected").
  const outOfChannel = !connected && connectionState !== 'reconnecting';
  useEffect(() => {
    if (!outOfChannel || !recRef.current) return;
    stopRecorder();
    logMessage('You', 'voice', 'Voice memo not sent: connection lost');
  }, [outOfChannel, stopRecorder, logMessage]);

  const targetLabel = memoTargetLabel(target, target === GROUP_UID ? undefined : nameOf(target));
  const value = useMemo(
    () => ({recording, secondsLeft, canRecord: connected, startMemo, sendMemo, target, targetLabel, selectTarget, replay: play}),
    [recording, secondsLeft, connected, startMemo, sendMemo, target, targetLabel, selectTarget, play],
  );

  return <MemoContext.Provider value={value}>{children}</MemoContext.Provider>;
}

export function useMemos(): MemoContextValue {
  const ctx = useContext(MemoContext);
  if (!ctx) throw new Error('useMemos must be used within a MemoProvider');
  return ctx;
}
