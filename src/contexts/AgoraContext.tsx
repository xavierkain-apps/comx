import React, {createContext, useContext, useState, useCallback, useRef, useEffect, ReactNode} from 'react';
import createAgoraRtcEngine, {
  IRtcEngine,
  ChannelProfileType,
  ClientRoleType,
  AudioProfileType,
  AudioScenarioType,
  AudioSessionOperationRestriction,
} from 'react-native-agora';
import {AGORA_APP_ID} from '@env';
import {AppState, AppStateStatus, Platform, NativeModules, NativeEventEmitter} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {Pilot, ConnectionState, ChannelConfig} from '../types';
import {startForegroundService, stopForegroundService, updateForegroundMuteStatus} from '../services/AndroidForegroundService';
import {appLog} from '../utils/logger';
import {utf8Encode, utf8Decode} from '../utils/encoding';

export type InactivityWarning = null | 'solo' | 'silence';

// Inactivity guard
const SOLO_TIMEOUT = 5 * 60 * 1000;      // 5 min alone → warning
const SOLO_GRACE = 2 * 60 * 1000;        // 2 min grace after solo warning
const SILENCE_TIMEOUT = 60 * 60 * 1000;  // 1h no audio → warning
const SILENCE_GRACE = 5 * 60 * 1000;     // 5 min grace after silence warning
const CHECK_INTERVAL = 1000;             // check every 1s for accurate countdown
const JOIN_TIMEOUT = 20000;              // give up on a join after 20s

interface AgoraContextValue {
  connectionState: ConnectionState;
  remotePilots: Pilot[];
  isMuted: boolean;
  isSpeakerOn: boolean;
  joinChannel: (config: ChannelConfig) => Promise<void>;
  leaveChannel: () => Promise<void>;
  toggleMute: () => void;
  toggleSpeaker: () => void;
  channelName: string;
  inactivityWarning: InactivityWarning;
  warningSecondsLeft: number;
  dismissWarning: () => void;
  autoDisconnected: boolean;
  isConnected: () => boolean;
  isPausedForVideo: boolean;
  pauseForVideo: () => void;
  resumeFromVideo: () => void;
  isHeadphonesConnected: boolean;
  isInterrupted: boolean;
  playEffect: (soundId: number, filePath: string) => void;
  /** Send a JSON message to everyone in the channel over the data stream. */
  sendStreamJson: (msg: object) => boolean;
  /** Receive every data-stream message except names. Returns an unsubscribe. */
  subscribeStream: (listener: StreamListener) => () => void;
  /** The live engine, or null before the first join. */
  getEngine: () => IRtcEngine | null;
  /**
   * Override the phone microphone for watch use:
   * - 'silenced': mic captured at volume 0 but the stream stays published, so
   *   audio mixed in (watch voice clips) still reaches the channel. The phone
   *   sits in a waterproof pouch.
   * - 'open': mic published even if the user muted (talk via phone from a Garmin).
   * - 'normal': the mute button decides.
   */
  setMicOverride: (mode: MicOverride) => void;
  micOverride: MicOverride;
}

export type MicOverride = 'normal' | 'silenced' | 'open';

export type StreamListener = (remoteUid: number, msg: Record<string, unknown>) => void;

const AgoraContext = createContext<AgoraContextValue | null>(null);

export function AgoraProvider({children}: {children: ReactNode}) {
  const engineRef = useRef<IRtcEngine | null>(null);
  const dataStreamIdRef = useRef<number | null>(null);
  const pilotNameRef = useRef('');
  const [connectionState, setConnectionState] = useState<ConnectionState>('disconnected');
  const [remotePilots, setRemotePilots] = useState<Pilot[]>([]);
  const [isMuted, setIsMuted] = useState(false);
  const [isSpeakerOn, setIsSpeakerOn] = useState(false);
  const [channelName, setChannelName] = useState('');
  const isMutedRef = useRef(false);
  const channelNameRef = useRef('');
  const connectionStateRef = useRef<ConnectionState>('disconnected');
  const leaveChannelRef = useRef<() => Promise<void>>(async () => {});
  const audioInterruptedRef = useRef(false);
  const announcedUidsRef = useRef<Set<number>>(new Set());
  const streamListenersRef = useRef<Set<StreamListener>>(new Set());
  const micOverrideRef = useRef<MicOverride>('normal');
  const [micOverride, setMicOverrideState] = useState<MicOverride>('normal');

  const lastActivityRef = useRef<number>(Date.now());
  const aloneStartRef = useRef<number | null>(null);
  const warningStartRef = useRef<number | null>(null);
  const inactivityTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const remotePilotsRef = useRef<Pilot[]>([]);
  const [inactivityWarning, setInactivityWarning] = useState<InactivityWarning>(null);
  const inactivityWarningRef = useRef<InactivityWarning>(null);
  const [warningSecondsLeft, setWarningSecondsLeft] = useState(0);
  const [autoDisconnected, setAutoDisconnected] = useState(false);
  const [isPausedForVideo, setIsPausedForVideo] = useState(false);
  const [isHeadphonesConnected, setIsHeadphonesConnected] = useState(false);
  // A phone call is not a video pause; the UI must not offer "Resume" for it.
  const [isInterrupted, setIsInterrupted] = useState(false);

  const resetActivity = useCallback(() => {
    lastActivityRef.current = Date.now();
    if (inactivityWarningRef.current) {
      warningStartRef.current = null;
      inactivityWarningRef.current = null;
      setInactivityWarning(null);
      setWarningSecondsLeft(0);
    }
  }, []);

  const dismissWarning = useCallback(() => {
    resetActivity();
    // Also reset alone timer so solo doesn't re-trigger immediately
    aloneStartRef.current = remotePilotsRef.current.length === 0 ? Date.now() : null;
  }, [resetActivity]);

  // A join is only "done" once Agora reports CONNECTED. joinChannel() used to be
  // fire-and-forget, so HomeScreen's try/catch could never fire and a failed join
  // left the user staring at an empty channel.
  const joinSettleRef = useRef<{
    resolve: () => void;
    reject: (e: Error) => void;
    timer: ReturnType<typeof setTimeout>;
  } | null>(null);

  const settleJoin = useCallback((error: Error | null) => {
    const pending = joinSettleRef.current;
    if (!pending) return;
    joinSettleRef.current = null;
    clearTimeout(pending.timer);
    if (error) {
      appLog('Agora', `join failed: ${error.message}`);
      pending.reject(error);
    } else {
      appLog('Agora', 'join confirmed connected');
      pending.resolve();
    }
  }, []);

  // TTS for pilot join/leave announcements
  const speak = useCallback(async (text: string) => {
    const val = await AsyncStorage.getItem('@soarx_tts_enabled');
    if (val === 'false') return;
    if (NativeModules.TTSManager) {
      NativeModules.TTSManager.speak(text);
    }
    appLog('TTS', text);
  }, []);

  // Send a JSON message to all users in the channel via the data stream
  const sendJson = useCallback((engine: IRtcEngine, msg: object): boolean => {
    try {
      if (dataStreamIdRef.current === null) {
        const streamId = engine.createDataStream({syncWithAudio: false, ordered: true});
        dataStreamIdRef.current = streamId;
      }
      const data = utf8Encode(JSON.stringify(msg));
      const ret = engine.sendStreamMessage(dataStreamIdRef.current!, data, data.length);
      return ret === 0;
    } catch (e) {
      console.warn('[Agora] sendStreamMessage error:', e);
      return false;
    }
  }, []);

  // Send pilot name to all users in the channel via data stream
  const broadcastName = useCallback((engine: IRtcEngine) => {
    if (sendJson(engine, {type: 'name', name: pilotNameRef.current})) {
      console.log('[Agora] Broadcast name:', pilotNameRef.current);
    }
  }, [sendJson]);

  // The stream must stay published while the phone mic is silenced, otherwise
  // the watch clips mixed into it would never leave the phone.
  const applyLocalStreamMute = useCallback((engine: IRtcEngine) => {
    engine.muteLocalAudioStream(micOverrideRef.current === 'normal' ? isMutedRef.current : false);
  }, []);

  const initEngine = useCallback(async () => {
    if (engineRef.current) {
      return engineRef.current;
    }
    const engine = createAgoraRtcEngine();
    engine.initialize({appId: AGORA_APP_ID});

    engine.setChannelProfile(ChannelProfileType.ChannelProfileCommunication);
    engine.setClientRole(ClientRoleType.ClientRoleBroadcaster);
    // AudioScenarioChatroom trades latency for smoothness with a generous jitter
    // buffer. Chorus is Agora's low-latency scenario — pilots interrupt each
    // other in flight, so responsiveness matters more than perfect smoothing.
    engine.setAudioProfile(
      AudioProfileType.AudioProfileSpeechStandard,
      AudioScenarioType.AudioScenarioChorus,
    );

    // Remote user joined — add with temporary name, then broadcast our name
    engine.addListener('onUserJoined', (connection, remoteUid) => {
      setRemotePilots(prev => {
        if (prev.find(p => p.uid === remoteUid)) return prev;
        const updated = [...prev, {uid: remoteUid, name: `Pilot`, status: 'listening' as const, audioVolume: 0}];
        remotePilotsRef.current = updated;
        return updated;
      });
      // Someone joined → reset activity & no longer alone
      aloneStartRef.current = null;
      resetActivity();
      // Re-broadcast our name so the new user learns it
      setTimeout(() => broadcastName(engine), 500);
    });

    engine.addListener('onUserOffline', (connection, remoteUid) => {
      // Announce departure with name before removing
      const pilot = remotePilotsRef.current.find(p => p.uid === remoteUid);
      const departed = pilot && pilot.name !== 'Pilot' ? pilot.name : 'A pilot';
      speak(`${departed} left`);
      appLog('TTS', `${departed} left (uid=${remoteUid})`);
      announcedUidsRef.current.delete(remoteUid);
      setRemotePilots(prev => {
        const updated = prev.filter(p => p.uid !== remoteUid);
        remotePilotsRef.current = updated;
        if (updated.length === 0) {
          aloneStartRef.current = Date.now();
        }
        return updated;
      });
    });

    // Receive data stream messages (pilot names)
    engine.addListener('onStreamMessage', (connection, remoteUid, streamId, data) => {
      try {
        const text = utf8Decode(data);
        const msg = JSON.parse(text);
        if (msg && msg.type !== 'name') {
          streamListenersRef.current.forEach(listener => {
            try {
              listener(remoteUid, msg);
            } catch (err) {
              console.warn('[Agora] stream listener error:', err);
            }
          });
          return;
        }
        console.log('[Agora] Received name from', remoteUid, ':', msg.name);
        if (msg.type === 'name' && msg.name) {
          // Announce pilot on first name reception
          if (!announcedUidsRef.current.has(remoteUid)) {
            announcedUidsRef.current.add(remoteUid);
            speak(`${msg.name} joined`);
          }
          setRemotePilots(prev => {
            const updated = prev.map(p => p.uid === remoteUid ? {...p, name: msg.name} : p);
            remotePilotsRef.current = updated;
            return updated;
          });
        }
      } catch (e) {
        console.warn('[Agora] onStreamMessage parse error:', e);
      }
    });

    engine.addListener('onAudioVolumeIndication', (connection, speakers, _totalVolume) => {
      // Detect any audio activity (someone speaking) → reset inactivity
      const hasActivity = speakers.some(s => (s.volume ?? 0) > 30);
      if (hasActivity) {
        lastActivityRef.current = Date.now();
        if (inactivityWarningRef.current === 'silence') {
          warningStartRef.current = null;
          inactivityWarningRef.current = null;
          setInactivityWarning(null);
          setWarningSecondsLeft(0);
        }
      }

      // Fires 4x/second for the whole flight. Only re-render when a pilot's
      // volume bucket or speaking status actually moved.
      setRemotePilots(prev => {
        let changed = false;
        const next = prev.map(pilot => {
          const speaker = speakers.find(s => s.uid === pilot.uid);
          if (!speaker) return pilot;
          const volume = speaker.volume ?? 0;
          const status = volume > 30 ? 'speaking' as const : 'listening' as const;
          // Quantise the volume so tiny fluctuations don't force a render
          const bucket = Math.round(volume / 16) * 16;
          if (pilot.status === status && pilot.audioVolume === bucket) return pilot;
          changed = true;
          return {...pilot, audioVolume: bucket, status};
        });
        if (!changed) return prev;
        remotePilotsRef.current = next;
        return next;
      });
    });

    engine.addListener('onConnectionStateChanged', (connection, state) => {
      const stateMap: Record<number, ConnectionState> = {
        1: 'disconnected',
        2: 'connecting',
        3: 'connected',
        4: 'reconnecting',
        5: 'failed',
      };
      const mapped = stateMap[state] ?? 'disconnected';
      connectionStateRef.current = mapped;
      setConnectionState(mapped);
      if (mapped === 'connected') settleJoin(null);
      if (mapped === 'failed') settleJoin(new Error('Connection failed'));
    });

    // Surface Agora errors instead of hanging on "Connecting..." forever
    engine.addListener('onError', (err: number, msg: string) => {
      appLog('Agora', `onError code=${err} msg=${msg}`);
      // 17 = join rejected, 110 = invalid token, 109 = token expired
      if (err === 17 || err === 109 || err === 110) {
        settleJoin(new Error(`Agora error ${err}`));
      }
    });

    // Audio interruption handling (e.g. Camera app takes mic for video recording)
    engine.addListener('onLocalAudioStateChanged', (_connection: any, state: number, reason: number) => {
      appLog('Agora', `onLocalAudioStateChanged state=${state} reason=${reason}`);
      if (reason === 8) {
        // Another app took the mic (Camera video, phone call, etc.)
        appLog('Agora', 'Audio interrupted — auto-pausing for video');
        audioInterruptedRef.current = true;
        setIsPausedForVideo(true);
        engine.disableAudio();
      } else if (reason === 0 && audioInterruptedRef.current) {
        appLog('Agora', 'Audio interruption ended — auto-resuming');
        audioInterruptedRef.current = false;
        engine.enableAudio();
        applyLocalStreamMute(engine);
        setIsPausedForVideo(false);
      }
    });

    // Detect headphones/AirPods connection via audio route changes
    // Agora AudioRoute enum: -1=Default, 0=Headset, 1=Earpiece,
    // 2=HeadsetNoMic, 3=Speakerphone, 4=Loudspeaker,
    // 5=BluetoothHFP, 6=USB, 7=HDMI, 10=BluetoothA2DP
    engine.addListener('onAudioRoutingChanged', (_routing: number) => {
      const headphoneRoutes = [0, 2, 5, 10]; // Headset, HeadsetNoMic, BluetoothHFP, BluetoothA2DP
      const isHP = headphoneRoutes.includes(_routing);
      setIsHeadphonesConnected(isHP);
      appLog('Agora', `Audio route changed: ${_routing} headphones=${isHP}`);
    });

    engine.enableAudioVolumeIndication(250, 3, true);
    engineRef.current = engine;
    return engine;
  }, [applyLocalStreamMute, broadcastName, resetActivity, settleJoin, speak]);

  const stopInactivityTimer = useCallback(() => {
    if (inactivityTimerRef.current) {
      clearInterval(inactivityTimerRef.current);
      inactivityTimerRef.current = null;
    }
    warningStartRef.current = null;
    inactivityWarningRef.current = null;
    setInactivityWarning(null);
    setWarningSecondsLeft(0);
  }, []);

  const startInactivityTimer = useCallback(() => {
    stopInactivityTimer();
    lastActivityRef.current = Date.now();
    aloneStartRef.current = Date.now(); // start alone until someone joins
    warningStartRef.current = null;
    inactivityWarningRef.current = null;
    setInactivityWarning(null);
    setWarningSecondsLeft(0);

    inactivityTimerRef.current = setInterval(() => {
      const now = Date.now();
      const pilotCount = remotePilotsRef.current.length;
      const currentWarning = inactivityWarningRef.current;

      // If warning is active, check grace period
      if (currentWarning && warningStartRef.current) {
        const grace = currentWarning === 'solo' ? SOLO_GRACE : SILENCE_GRACE;
        const elapsed = now - warningStartRef.current;
        const remaining = Math.max(0, Math.ceil((grace - elapsed) / 1000));
        setWarningSecondsLeft(remaining);
        if (elapsed >= grace) {
          // Grace expired → auto-disconnect
          appLog('Agora', `AUTO-DISCONNECT — reason=${currentWarning} ` +
            `(${currentWarning === 'solo' ? 'alone in channel' : 'no audio activity'})`);
          setAutoDisconnected(true);
          leaveChannelRef.current();
          return;
        }
        return;
      }

      // Check solo: alone for more than SOLO_TIMEOUT
      if (pilotCount === 0 && aloneStartRef.current) {
        if (now - aloneStartRef.current >= SOLO_TIMEOUT) {
          appLog('Agora', 'Solo timeout — alone in channel, warning shown');
          warningStartRef.current = now;
          inactivityWarningRef.current = 'solo';
          setInactivityWarning('solo');
          setWarningSecondsLeft(Math.ceil(SOLO_GRACE / 1000));
          return;
        }
      }

      // Check silence: no audio activity for SILENCE_TIMEOUT
      if (pilotCount > 0 && now - lastActivityRef.current >= SILENCE_TIMEOUT) {
        appLog('Agora', 'Silence timeout — no audio activity, warning shown');
        warningStartRef.current = now;
        inactivityWarningRef.current = 'silence';
        setInactivityWarning('silence');
        setWarningSecondsLeft(Math.ceil(SILENCE_GRACE / 1000));
      }
    }, CHECK_INTERVAL);
  }, [stopInactivityTimer]);

  const joinChannel = useCallback(async (config: ChannelConfig) => {
    setConnectionState('connecting');
    connectionStateRef.current = 'connecting';
    setAutoDisconnected(false);
    setIsSpeakerOn(false);
    setChannelName(config.channelName);
    channelNameRef.current = config.channelName;
    pilotNameRef.current = config.pilotName;
    setRemotePilots([]);
    remotePilotsRef.current = [];
    setIsMuted(false);
    isMutedRef.current = false;
    dataStreamIdRef.current = null;
    announcedUidsRef.current.clear();

    const engine = await initEngine();

    const connected = new Promise<void>((resolve, reject) => {
      const timer = setTimeout(
        () => settleJoin(new Error('Connection timed out')),
        JOIN_TIMEOUT,
      );
      joinSettleRef.current = {resolve, reject, timer};
    });

    try {
      engine.joinChannel('', config.channelName, 0, {});
      engine.muteLocalAudioStream(false);
      engine.adjustRecordingSignalVolume(micOverrideRef.current === 'silenced' ? 0 : 100);
    } catch (e) {
      settleJoin(e instanceof Error ? e : new Error('Join call failed'));
    }

    try {
      await connected;
    } catch (e) {
      // Roll back so the user lands back on Home in a clean state
      stopInactivityTimer();
      try {
        engine.leaveChannel();
      } catch {}
      setConnectionState('disconnected');
      connectionStateRef.current = 'disconnected';
      setChannelName('');
      channelNameRef.current = '';
      throw e;
    }

    startForegroundService(config.channelName);
    startInactivityTimer();

    // Broadcast our name multiple times after joining (reliability)
    setTimeout(() => broadcastName(engine), 1000);
    setTimeout(() => broadcastName(engine), 3000);
    setTimeout(() => broadcastName(engine), 6000);
  }, [initEngine, broadcastName, settleJoin, startInactivityTimer, stopInactivityTimer]);

  const leaveChannel = useCallback(async () => {
    appLog('Agora', 'leaveChannel() START');
    setConnectionState('disconnected');
    connectionStateRef.current = 'disconnected';
    appLog('Agora', 'connectionState set to disconnected');
    stopInactivityTimer();
    const engine = engineRef.current;
    if (engine) {
      if (micOverrideRef.current === 'silenced') {
        engine.adjustRecordingSignalVolume(100);
      }
      appLog('Agora', 'calling engine.leaveChannel()');
      engine.leaveChannel();
      appLog('Agora', 'engine.leaveChannel() done');
    }
    stopForegroundService();
    setRemotePilots([]);
    remotePilotsRef.current = [];
    setChannelName('');
    channelNameRef.current = '';
    setIsMuted(false);
    isMutedRef.current = false;
    dataStreamIdRef.current = null;
    announcedUidsRef.current.clear();
    audioInterruptedRef.current = false;
    setIsPausedForVideo(false);
    micOverrideRef.current = 'normal';
    setMicOverrideState('normal');
    appLog('Agora', 'leaveChannel() END');
  }, [stopInactivityTimer]);

  // Release the native engine when the provider unmounts
  useEffect(() => {
    return () => {
      const engine = engineRef.current;
      if (!engine) return;
      try {
        engine.leaveChannel();
        engine.release();
      } catch (e) {
        console.warn('[Agora] release error:', e);
      }
      engineRef.current = null;
    };
  }, []);

  // Keep ref in sync so the inactivity timer can call leaveChannel without circular deps
  leaveChannelRef.current = leaveChannel;

  // Listen for native audio session interruptions (Camera video, phone calls, etc.)
  useEffect(() => {
    if (Platform.OS !== 'ios' || !NativeModules.AudioSessionManager) return;

    const emitter = new NativeEventEmitter(NativeModules.AudioSessionManager);

    const interruptSub = emitter.addListener('onAudioInterrupted', (event) => {
      appLog('AudioSession', `INTERRUPTED reason=${event.reason}`);
      const engine = engineRef.current;
      if (engine && connectionStateRef.current === 'connected') {
        // Mute our mic but keep receiving remote audio. The channel is kept.
        engine.muteLocalAudioStream(true);
        setIsInterrupted(true);
        appLog('AudioSession', 'Mic muted for interruption — still in channel');
      }
    });

    const resumeSub = emitter.addListener('onAudioResumed', (event) => {
      appLog('AudioSession', `RESUMED reason=${event.reason}`);
      const engine = engineRef.current;
      if (engine && connectionStateRef.current === 'connected') {
        // Restore mute state to what it was before interruption
        engine.enableAudio();
        applyLocalStreamMute(engine);
        setIsInterrupted(false);
        appLog('AudioSession', `Mic restored to muted=${isMutedRef.current}`);
      }
    });

    appLog('AudioSession', 'Native interruption listeners registered');

    return () => {
      interruptSub.remove();
      resumeSub.remove();
    };
  }, [applyLocalStreamMute]);

  // AppState backup: reclaim mic when app returns to foreground after audio interruption
  useEffect(() => {
    const handleAppState = (nextState: AppStateStatus) => {
      if (nextState === 'active' && audioInterruptedRef.current && engineRef.current) {
        console.log('[Agora] AppState active — reclaiming mic after interruption');
        audioInterruptedRef.current = false;
        engineRef.current.enableAudio();
        applyLocalStreamMute(engineRef.current);
        setIsPausedForVideo(false);
      }
    };
    const sub = AppState.addEventListener('change', handleAppState);
    return () => sub.remove();
  }, [applyLocalStreamMute]);

  const toggleMute = useCallback(() => {
    appLog('Agora', `toggleMute() called — current=${isMutedRef.current} connState=${connectionStateRef.current}`);
    const engine = engineRef.current;
    if (engine) {
      const newMuted = !isMutedRef.current;
      isMutedRef.current = newMuted;
      applyLocalStreamMute(engine);
      setIsMuted(newMuted);
      updateForegroundMuteStatus(newMuted, channelNameRef.current);
      dismissWarning();
      appLog('Agora', `toggleMute() done — new=${newMuted}`);
    } else {
      appLog('Agora', 'toggleMute() — no engine');
    }
  }, [applyLocalStreamMute, dismissWarning]);

  const setMicOverride = useCallback((mode: MicOverride) => {
    if (micOverrideRef.current === mode) return;
    micOverrideRef.current = mode;
    setMicOverrideState(mode);
    const engine = engineRef.current;
    if (!engine) return;
    engine.adjustRecordingSignalVolume(mode === 'silenced' ? 0 : 100);
    applyLocalStreamMute(engine);
    appLog('Agora', `phone mic override: ${mode}`);
  }, [applyLocalStreamMute]);

  const sendStreamJson = useCallback((msg: object): boolean => {
    const engine = engineRef.current;
    if (!engine || connectionStateRef.current !== 'connected') return false;
    return sendJson(engine, msg);
  }, [sendJson]);

  const subscribeStream = useCallback((listener: StreamListener) => {
    streamListenersRef.current.add(listener);
    return () => {
      streamListenersRef.current.delete(listener);
    };
  }, []);

  const getEngine = useCallback(() => engineRef.current, []);

  const toggleSpeaker = useCallback(() => {
    appLog('Agora', `toggleSpeaker() called — current=${isSpeakerOn}`);
    const engine = engineRef.current;
    if (engine) {
      const newSpeaker = !isSpeakerOn;
      engine.setEnableSpeakerphone(newSpeaker);
      setIsSpeakerOn(newSpeaker);
      appLog('Agora', `toggleSpeaker() done — new=${newSpeaker}`);
    }
  }, [isSpeakerOn]);

  // Pause audio for video recording — releases mic so Camera can use it
  const pauseForVideo = useCallback(() => {
    const engine = engineRef.current;
    if (!engine) return;
    appLog('Agora', 'pauseForVideo — taking over audio session + disabling audio');
    setIsPausedForVideo(true);
    if (Platform.OS === 'ios') {
      // 1. Tell Agora to stop managing the audio session
      engine.setAudioSessionOperationRestriction(
        AudioSessionOperationRestriction.AudioSessionOperationRestrictionAll,
      );
      // 2. Disable Agora audio (releases internal audio units)
      engine.disableAudio();
      // 3. Deactivate the audio session so Camera can use mic
      setTimeout(() => {
        if (NativeModules.AudioSessionManager) {
          NativeModules.AudioSessionManager.deactivateAudioSession();
          appLog('Agora', 'pauseForVideo — audio session deactivated');
        }
      }, 200);
    } else {
      engine.disableAudio();
    }
  }, []);

  const resumeFromVideo = useCallback(() => {
    const engine = engineRef.current;
    if (!engine) return;
    appLog('Agora', 'resumeFromVideo — restoring audio');
    if (Platform.OS === 'ios') {
      // 1. Reactivate audio session via native module
      if (NativeModules.AudioSessionManager) {
        NativeModules.AudioSessionManager.configureAudioSession();
      }
      // 2. Give Agora back control of the audio session
      engine.setAudioSessionOperationRestriction(
        AudioSessionOperationRestriction.AudioSessionOperationRestrictionNone,
      );
      // 3. Re-enable audio
      engine.enableAudio();
      applyLocalStreamMute(engine);
    } else {
      engine.enableAudio();
      applyLocalStreamMute(engine);
    }
    setIsPausedForVideo(false);
    appLog('Agora', 'resumeFromVideo — done');
  }, [applyLocalStreamMute]);

  // Auto-resume when app returns to foreground after video pause
  useEffect(() => {
    const handleAppState = (nextState: AppStateStatus) => {
      if (nextState === 'active' && isPausedForVideo) {
        resumeFromVideo();
      }
    };
    const sub = AppState.addEventListener('change', handleAppState);
    return () => sub.remove();
  }, [isPausedForVideo, resumeFromVideo]);

  const playEffectSound = useCallback((soundId: number, fileName: string) => {
    const engine = engineRef.current;
    if (!engine) return;
    try {
      // On iOS, Agora accepts the filename directly if it's in the main bundle
      // On Android, use the resource name without extension from res/raw/
      const filePath = Platform.OS === 'android'
        ? `/assets/${fileName}`
        : fileName;
      engine.playEffect(soundId, filePath, 0, 1.0, 0, 100, false, 0);
    } catch (e) {
      console.warn('[Agora] playEffect error:', e);
    }
  }, []);

  return (
    <AgoraContext.Provider
      value={{
        connectionState,
        remotePilots,
        isMuted,
        isSpeakerOn,
        joinChannel,
        leaveChannel,
        toggleMute,
        toggleSpeaker,
        channelName,
        inactivityWarning,
        warningSecondsLeft,
        dismissWarning,
        autoDisconnected,
        isConnected: () => connectionStateRef.current === 'connected',
        isPausedForVideo,
        pauseForVideo,
        resumeFromVideo,
        isHeadphonesConnected,
        isInterrupted,
        playEffect: playEffectSound,
        sendStreamJson,
        subscribeStream,
        getEngine,
        setMicOverride,
        micOverride,
      }}>
      {children}
    </AgoraContext.Provider>
  );
}

export function useAgoraContext(): AgoraContextValue {
  const context = useContext(AgoraContext);
  if (!context) {
    throw new Error('useAgoraContext must be used within an AgoraProvider');
  }
  return context;
}
