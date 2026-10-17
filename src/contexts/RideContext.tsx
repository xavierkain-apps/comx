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
import {
  DEMO_CHATTER_IDS,
  DEMO_CHATTER_MAX_MS,
  DEMO_CHATTER_MIN_MS,
  DEMO_RIDERS,
  demoPosition,
  demoRider,
} from '../ride/demo';
import {LatLon} from '../utils/geo';

const POSITION_BROADCAST_MS = 3000;
const MAX_MESSAGES = 20;
const DEMO_KEY = '@comx_demo';
const DEMO_TICK_MS = 2000;

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
  /** Demo mode: virtual riders, works without a channel (src/ride/demo.ts). */
  demo: boolean;
  setDemo: (on: boolean) => void;
  /** The virtual rider currently raising an SOS, or null. */
  demoSosUid: number | null;
  setDemoSos: (active: boolean) => void;
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
  const [demo, setDemoState] = useState(false);
  const demoRef = useRef(false);
  demoRef.current = demo;
  const [demoAnchor, setDemoAnchor] = useState<LatLon | null>(null);
  const [demoSosUid, setDemoSosUid] = useState<number | null>(null);
  // Riders exist while in a channel, or in demo mode without one
  const active = connected || demo;

  namesRef.current = Object.fromEntries(remotePilots.map(p => [p.uid, p.name]));
  const nameOf = (uid: number) => namesRef.current[uid] || demoRider(uid)?.name || 'A rider';

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

  // A quick message or SOS from another rider (real or virtual)
  const receiveText = (uid: number, id: string, text: string) => {
    const from = nameOf(uid);
    pushMessage({uid, from, id, text, t: Date.now()});
    Vibration.vibrate(200);
    speak(`${from}: ${text}`);
    emit({type: 'text', uid, from, id, text});
  };
  const receiveTextRef = useRef(receiveText);
  receiveTextRef.current = receiveText;

  const receiveSos = (uid: number, active: boolean) => {
    // An active SOS is repeated every 15 s: only alert on a change
    if (!!sosStateRef.current[uid] === active) return;
    const from = nameOf(uid);
    sosStateRef.current[uid] = active;
    setSosUids(prev => ({...prev, [uid]: active}));
    if (active) {
      Vibration.vibrate([0, 800, 300, 800, 300, 800]);
      speak(`S O S from ${from}`);
    } else {
      speak(`${from} cancelled the S O S`);
    }
    pushMessage({uid, from, id: 'sos', text: active ? 'SOS!' : 'SOS cancelled', t: Date.now()});
    emit({type: 'sos', uid, from, active});
  };
  const receiveSosRef = useRef(receiveSos);
  receiveSosRef.current = receiveSos;

  // GPS while in a channel (or in demo mode)
  useEffect(() => {
    if (!active) return;
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
  }, [active]);

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
        case 'text':
          receiveTextRef.current(uid, msg.id, msg.text);
          break;
        case 'sos': {
          if (msg.lat !== null && msg.lon !== null) {
            const {lat, lon} = msg;
            setPositions(prev => ({...prev, [uid]: {...(prev[uid] ?? {cog: null, sog: null, acc: 0}), lat, lon, t: Date.now()}}));
          }
          receiveSosRef.current(uid, msg.active);
          break;
        }
      }
    });
  }, [subscribeStream]);

  // Forget riders who left, and everything when we leave
  useEffect(() => {
    if (!connected) {
      if (demoRef.current) return;
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
    if (!sendStreamJson({type: 'text', id, text: body}) && !demoRef.current) {
      appLog('Ride', `quick message not sent (not connected): ${id}`);
      return;
    }
    pushMessage({uid: null, from: 'You', id, text: body, t: Date.now()});
    if (demoRef.current) {
      // The nearest virtual rider answers
      const reply = id === 'where' ? 'Right behind you' : id === 'help' || id === 'gear' ? 'On my way' : 'All good';
      setTimeout(() => {
        if (demoRef.current) receiveTextRef.current(DEMO_RIDERS[0].uid, 'custom', reply);
      }, 3000);
    }
  }, [sendStreamJson, pushMessage]);

  const setSos = useCallback((active: boolean) => {
    const p = myPositionRef.current;
    sendStreamJson({type: 'sos', active, lat: p?.lat ?? null, lon: p?.lon ?? null});
    // Send twice: SOS must not depend on a single data-stream packet
    setTimeout(() => sendStreamJson({type: 'sos', active, lat: p?.lat ?? null, lon: p?.lon ?? null}), 1500);
    mySosRef.current = active;
    setMySos(active);
    pushMessage({uid: null, from: 'You', id: 'sos', text: active ? 'SOS sent' : 'SOS cancelled', t: Date.now()});
    if (demoRef.current && active) {
      setTimeout(() => {
        if (demoRef.current) receiveTextRef.current(DEMO_RIDERS[1].uid, 'custom', 'Saw your SOS, coming');
      }, 4000);
    }
  }, [sendStreamJson, pushMessage]);

  // ---- Demo mode ------------------------------------------------------------
  useEffect(() => {
    AsyncStorage.getItem(DEMO_KEY).then(v => setDemoState(v === 'true'));
  }, []);

  const setDemo = useCallback((on: boolean) => {
    setDemoState(on);
    AsyncStorage.setItem(DEMO_KEY, String(on));
    appLog('Ride', `demo mode ${on ? 'on' : 'off'}`);
  }, []);

  // Virtual riders circle around where we were when the demo started
  useEffect(() => {
    if (demo && !demoAnchor && myPosition) setDemoAnchor({lat: myPosition.lat, lon: myPosition.lon});
  }, [demo, demoAnchor, myPosition]);

  // Leaving demo mode forgets everything it produced
  useEffect(() => {
    if (demo) return;
    setDemoAnchor(null);
    setDemoSosUid(null);
    for (const r of DEMO_RIDERS) delete sosStateRef.current[r.uid];
    setSosUids(prev => Object.fromEntries(Object.entries(prev).filter(([k]) => !demoRider(Number(k)))));
    if (!connected) {
      setMessages([]);
      setMySos(false);
      mySosRef.current = false;
    }
    // Only on demo changes
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [demo]);

  // Move the virtual riders even when there is no channel to tick `now`
  useEffect(() => {
    if (!demo) return;
    const timer = setInterval(() => setNow(Date.now()), DEMO_TICK_MS);
    return () => clearInterval(timer);
  }, [demo]);

  // Spontaneous quick messages from the virtual riders
  useEffect(() => {
    if (!demo) return;
    let timer: ReturnType<typeof setTimeout>;
    const schedule = () => {
      const delay = DEMO_CHATTER_MIN_MS + Math.random() * (DEMO_CHATTER_MAX_MS - DEMO_CHATTER_MIN_MS);
      timer = setTimeout(() => {
        const rider = DEMO_RIDERS[Math.floor(Math.random() * DEMO_RIDERS.length)];
        const id = DEMO_CHATTER_IDS[Math.floor(Math.random() * DEMO_CHATTER_IDS.length)];
        receiveTextRef.current(rider.uid, id, quickMessageText(id));
        schedule();
      }, delay);
    };
    schedule();
    return () => clearTimeout(timer);
  }, [demo]);

  const setDemoSos = useCallback((on: boolean) => {
    const uid = DEMO_RIDERS[1].uid;
    setDemoSosUid(on ? uid : null);
    receiveSosRef.current(uid, on);
  }, []);

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
        [
          ...remotePilots.map(p => ({
            uid: p.uid,
            name: p.name,
            speaking: p.status === 'speaking',
            position: positions[p.uid],
            sos: !!sosUids[p.uid],
          })),
          ...(demo
            ? DEMO_RIDERS.map(r => ({
                uid: r.uid,
                name: r.name,
                speaking: false,
                position: demoAnchor ? demoPosition(r, demoAnchor, now) : undefined,
                sos: !!sosUids[r.uid],
              }))
            : []),
        ],
        now,
      ),
    [myPosition, remotePilots, positions, sosUids, now, demo, demoAnchor],
  );

  const value = useMemo(
    () => ({
      myPosition, riders, messages, mySos, locationDenied, sendQuickMessage, setSos, subscribeRideEvents, logMessage,
      demo, setDemo, demoSosUid, setDemoSos,
    }),
    [
      myPosition, riders, messages, mySos, locationDenied, sendQuickMessage, setSos, subscribeRideEvents, logMessage,
      demo, setDemo, demoSosUid, setDemoSos,
    ],
  );

  return <RideContext.Provider value={value}>{children}</RideContext.Provider>;
}

export function useRide(): RideContextValue {
  const ctx = useContext(RideContext);
  if (!ctx) throw new Error('useRide must be used within a RideProvider');
  return ctx;
}
