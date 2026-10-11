// Ride features on top of the voice channel: where every rider is, quick
// messages and SOS. Everything travels over the Agora data stream, so there is
// no server.

import React, {createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, ReactNode} from 'react';
import {NativeModules, Vibration} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {useAgoraContext} from './AgoraContext';
import {requestLocationPermission, watchPosition} from '../services/location';
import {
  Position,
  RiderView,
  buildRiderViews,
  parseStreamMessage,
  quickMessageText,
} from '../ride/protocol';
import {appLog} from '../utils/logger';

const POSITION_BROADCAST_MS = 3000;
const MAX_MESSAGES = 20;

export interface RideMessage {
  key: string;
  uid: number | null; // null = me
  from: string;
  id: string;
  text: string;
  t: number;
}

export type RideEvent =
  | {type: 'text'; uid: number; from: string; id: string; text: string}
  | {type: 'sos'; uid: number; from: string; active: boolean};

type RideEventListener = (e: RideEvent) => void;

interface RideContextValue {
  myPosition: Position | null;
  riders: RiderView[];
  messages: RideMessage[];
  mySos: boolean;
  locationDenied: boolean;
  sendQuickMessage: (id: string, text?: string) => void;
  setSos: (active: boolean) => void;
  subscribeRideEvents: (listener: RideEventListener) => () => void;
  /** Show a line in the message feed (no network). */
  logMessage: (from: string, id: string, text: string, uid?: number | null) => void;
}

const RideContext = createContext<RideContextValue | null>(null);

export function RideProvider({children}: {children: ReactNode}) {
  const {connectionState, remotePilots, sendStreamJson, subscribeStream} = useAgoraContext();
  const connected = connectionState === 'connected';

  const [myPosition, setMyPosition] = useState<Position | null>(null);
  const myPositionRef = useRef<Position | null>(null);
  const [positions, setPositions] = useState<Record<number, Position>>({});
  const [sosUids, setSosUids] = useState<Record<number, boolean>>({});
  const [mySos, setMySos] = useState(false);
  const mySosRef = useRef(false);
  const [messages, setMessages] = useState<RideMessage[]>([]);
  const [locationDenied, setLocationDenied] = useState(false);
  const [now, setNow] = useState(Date.now());
  const listenersRef = useRef<Set<RideEventListener>>(new Set());
  const namesRef = useRef<Record<number, string>>({});
  const sosStateRef = useRef<Record<number, boolean>>({});

  namesRef.current = Object.fromEntries(remotePilots.map(p => [p.uid, p.name]));
  const nameOf = (uid: number) => namesRef.current[uid] || 'A rider';

  const emit = useCallback((e: RideEvent) => {
    listenersRef.current.forEach(l => {
      try {
        l(e);
      } catch (err) {
        console.warn('[Ride] listener error', err);
      }
    });
  }, []);

  const pushMessage = useCallback((m: Omit<RideMessage, 'key'>) => {
    setMessages(prev => [{...m, key: `${m.t}-${m.uid}-${m.id}`}, ...prev].slice(0, MAX_MESSAGES));
  }, []);

  const speak = useCallback(async (text: string) => {
    const val = await AsyncStorage.getItem('@soarx_tts_enabled');
    if (val === 'false') return;
    NativeModules.TTSManager?.speak(text);
  }, []);

  // GPS while in a channel
  useEffect(() => {
    if (!connected) return;
    let stop: (() => void) | null = null;
    let cancelled = false;
    requestLocationPermission().then(granted => {
      if (cancelled) return;
      setLocationDenied(!granted);
      if (!granted) return;
      stop = watchPosition(p => {
        myPositionRef.current = p;
        setMyPosition(p);
      });
    });
    return () => {
      cancelled = true;
      stop?.();
    };
  }, [connected]);

  // Broadcast our position
  useEffect(() => {
    if (!connected) return;
    const timer = setInterval(() => {
      const p = myPositionRef.current;
      if (p) sendStreamJson({type: 'pos', ...p});
      setNow(Date.now());
    }, POSITION_BROADCAST_MS);
    return () => clearInterval(timer);
  }, [connected, sendStreamJson]);

  // Messages from other phones
  useEffect(() => {
    return subscribeStream((uid, raw) => {
      const msg = parseStreamMessage(raw);
      if (!msg) return;
      switch (msg.type) {
        case 'pos': {
          const p: Position = {lat: msg.lat, lon: msg.lon, cog: msg.cog, sog: msg.sog, acc: msg.acc, t: msg.t};
          setPositions(prev => ({...prev, [uid]: p}));
          break;
        }
        case 'text': {
          const from = nameOf(uid);
          pushMessage({uid, from, id: msg.id, text: msg.text, t: Date.now()});
          Vibration.vibrate(200);
          speak(`${from}: ${msg.text}`);
          emit({type: 'text', uid, from, id: msg.id, text: msg.text});
          break;
        }
        case 'sos': {
          const from = nameOf(uid);
          if (msg.lat !== null && msg.lon !== null) {
            const {lat, lon} = msg;
            setPositions(prev => ({...prev, [uid]: {...(prev[uid] ?? {cog: null, sog: null, acc: 0}), lat, lon, t: Date.now()}}));
          }
          // An active SOS is repeated every 15 s: only alert on a change
          if (!!sosStateRef.current[uid] === msg.active) break;
          sosStateRef.current[uid] = msg.active;
          setSosUids(prev => ({...prev, [uid]: msg.active}));
          if (msg.active) {
            Vibration.vibrate([0, 800, 300, 800, 300, 800]);
            speak(`S O S from ${from}`);
          } else {
            speak(`${from} cancelled the S O S`);
          }
          pushMessage({uid, from, id: 'sos', text: msg.active ? 'SOS!' : 'SOS cancelled', t: Date.now()});
          emit({type: 'sos', uid, from, active: msg.active});
          break;
        }
      }
    });
    // nameOf reads a ref, so it never goes stale
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [subscribeStream, pushMessage, speak, emit]);

  // Forget riders who left, and everything when we leave
  useEffect(() => {
    if (!connected) {
      setPositions({});
      setSosUids({});
      sosStateRef.current = {};
      setMessages([]);
      setMySos(false);
      mySosRef.current = false;
      return;
    }
    const present = new Set(remotePilots.map(p => p.uid));
    setPositions(prev => {
      const keys = Object.keys(prev).map(Number);
      if (keys.every(k => present.has(k))) return prev;
      return Object.fromEntries(Object.entries(prev).filter(([k]) => present.has(Number(k))));
    });
  }, [connected, remotePilots]);

  const sendQuickMessage = useCallback((id: string, text?: string) => {
    const body = text ?? quickMessageText(id);
    if (!sendStreamJson({type: 'text', id, text: body})) {
      appLog('Ride', `quick message not sent (not connected): ${id}`);
      return;
    }
    pushMessage({uid: null, from: 'You', id, text: body, t: Date.now()});
  }, [sendStreamJson, pushMessage]);

  const setSos = useCallback((active: boolean) => {
    const p = myPositionRef.current;
    sendStreamJson({type: 'sos', active, lat: p?.lat ?? null, lon: p?.lon ?? null});
    // Send twice: SOS must not depend on a single data-stream packet
    setTimeout(() => sendStreamJson({type: 'sos', active, lat: p?.lat ?? null, lon: p?.lon ?? null}), 1500);
    mySosRef.current = active;
    setMySos(active);
    pushMessage({uid: null, from: 'You', id: 'sos', text: active ? 'SOS sent' : 'SOS cancelled', t: Date.now()});
  }, [sendStreamJson, pushMessage]);

  // While our SOS is on, repeat it so late joiners see it too
  useEffect(() => {
    if (!mySos || !connected) return;
    const timer = setInterval(() => {
      const p = myPositionRef.current;
      sendStreamJson({type: 'sos', active: true, lat: p?.lat ?? null, lon: p?.lon ?? null});
    }, 15000);
    return () => clearInterval(timer);
  }, [mySos, connected, sendStreamJson]);

  const subscribeRideEvents = useCallback((listener: RideEventListener) => {
    listenersRef.current.add(listener);
    return () => {
      listenersRef.current.delete(listener);
    };
  }, []);

  const logMessage = useCallback((from: string, id: string, text: string, uid: number | null = null) => {
    pushMessage({uid, from, id, text, t: Date.now()});
  }, [pushMessage]);

  const riders = useMemo(
    () =>
      buildRiderViews(
        myPosition,
        remotePilots.map(p => ({
          uid: p.uid,
          name: p.name,
          speaking: p.status === 'speaking',
          position: positions[p.uid],
          sos: !!sosUids[p.uid],
        })),
        now,
      ),
    [myPosition, remotePilots, positions, sosUids, now],
  );

  const value = useMemo(
    () => ({myPosition, riders, messages, mySos, locationDenied, sendQuickMessage, setSos, subscribeRideEvents, logMessage}),
    [myPosition, riders, messages, mySos, locationDenied, sendQuickMessage, setSos, subscribeRideEvents, logMessage],
  );

  return <RideContext.Provider value={value}>{children}</RideContext.Provider>;
}

export function useRide(): RideContextValue {
  const ctx = useContext(RideContext);
  if (!ctx) throw new Error('useRide must be used within a RideProvider');
  return ctx;
}
