// Ride features on top of the voice channel: where every rider is, quick
// messages and SOS. Everything travels over the Agora data stream, so there is
// no server.

import React, {createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, ReactNode} from 'react';
import {NativeModules, Vibration} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {useAgoraContext} from './AgoraContext';
import {useUser} from './UserContext';
import {relayEnabled, relaySync} from '../services/relayClient';
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
import {addToHistory} from '../ride/history';
import {
  RELAY_SYNC_MS,
  RelayEvent,
  RelayOutgoingText,
  RelayRider,
  SeenIds,
  SosState,
  applySosChange,
  channelKey,
  hasSoloRider,
  mergeRelayRiders,
  pickPosition,
} from '../ride/relay';

const POSITION_BROADCAST_MS = 3000;
const DEMO_KEY = '@comx_demo';
const DEMO_TICK_MS = 2000;
/** Quick messages waiting for the relay; the oldest go first when it is unreachable. */
const RELAY_OUTBOX_MAX = 20;
/** An active SOS is repeated this often on Agora, so late joiners see it. */
const SOS_REPEAT_MS = 15_000;

/** A voice memo's audio, kept in memory so it can be played again. */
export interface HistoryClip {
  base64: string;
  ext: string;
  durationMs: number;
}

export interface RideMessage {
  key: string;
  uid: number | null; // null = me
  from: string;
  id: string;
  text: string;
  t: number;
  /** Present on voice memos (replayable from the MSG sheet). */
  clip?: HistoryClip;
}

export type RideEvent =
  | {type: 'text'; uid: number; from: string; id: string; text: string}
  | {type: 'sos'; uid: number; from: string; active: boolean};

/** A voice clip announced by the relay (download it with relayDownloadClip). */
export type RelayClipEvent = Extract<RelayEvent, {type: 'clip'}>;

type RideEventListener = (e: RideEvent) => void;
type RelayClipListener = (e: RelayClipEvent) => void;

interface RideContextValue {
  myPosition: Position | null;
  riders: RiderView[];
  /** History for the MSG sheet, newest first, kept for the app's run. */
  messages: RideMessage[];
  mySos: boolean;
  locationDenied: boolean;
  sendQuickMessage: (id: string, text?: string) => void;
  setSos: (active: boolean) => void;
  subscribeRideEvents: (listener: RideEventListener) => () => void;
  /** Add a line to the history (no network); `clip` makes it a replayable memo. */
  logMessage: (from: string, id: string, text: string, uid?: number | null, clip?: HistoryClip) => void;
  /** Demo mode: virtual riders, works without a channel (src/ride/demo.ts). */
  demo: boolean;
  setDemo: (on: boolean) => void;
  /** The virtual rider currently raising an SOS, or null. */
  demoSosUid: number | null;
  setDemoSos: (active: boolean) => void;
  /** Clip announcements from the relay, for MemoContext. */
  subscribeRelayClips: (listener: RelayClipListener) => () => void;
  /** A rider is only reachable through the relay. */
  soloRiderPresent: boolean;
}

const RideContext = createContext<RideContextValue | null>(null);

export function RideProvider({children}: {children: ReactNode}) {
  const {connectionState, remotePilots, sendStreamJson, subscribeStream, channelName, localUid} = useAgoraContext();
  const {pilotName} = useUser();
  const pilotNameRef = useRef(pilotName);
  pilotNameRef.current = pilotName;
  const connected = connectionState === 'connected';
  const connectedRef = useRef(connected);
  connectedRef.current = connected;
  // One stay in a channel. An Agora reconnect keeps it: only leaving, or a new
  // channel or uid, starts a new one (and forgets SOS states, cursor, outbox).
  const inChannel = connected || connectionState === 'reconnecting';
  const session = inChannel && localUid !== null ? `${channelName}|${localUid}` : null;

  const [myPosition, setMyPosition] = useState<Position | null>(null);
  const myPositionRef = useRef<Position | null>(null);
  const [positions, setPositions] = useState<Record<number, Position>>({});
  // The SOS state known for every other rider, from every path (one source of truth)
  const [sosStates, setSosStates] = useState<Record<number, SosState>>({});
  const sosStatesRef = useRef<Record<number, SosState>>({});
  const [mySos, setMySos] = useState(false);
  const mySosRef = useRef(false);
  /** Time of our last SOS change (ours, our watch's, or adopted from the relay). */
  const mySosAtRef = useRef(0);
  const [messages, setMessages] = useState<RideMessage[]>([]);
  const [locationDenied, setLocationDenied] = useState(false);
  const [now, setNow] = useState(Date.now());
  // Leaving ends our SOS; it is stamped so the next sync cancels it on the relay too
  const forgetMySos = () => {
    if (mySosRef.current) mySosAtRef.current = Date.now();
    mySosRef.current = false;
    setMySos(false);
  };
  const listenersRef = useRef<Set<RideEventListener>>(new Set());
  const namesRef = useRef<Record<number, string>>({});
  const [demo, setDemoState] = useState(false);
  const demoRef = useRef(false);
  demoRef.current = demo;
  const [demoAnchor, setDemoAnchor] = useState<LatLon | null>(null);
  const [demoSosUid, setDemoSosUid] = useState<number | null>(null);
  // Riders exist while in a channel, or in demo mode without one
  const active = connected || demo;
  // Relay (watch solo mode), see docs/superpowers/specs/2026-11-01-comx-watch-solo-design.md
  const [relayRiders, setRelayRiders] = useState<RelayRider[]>([]);
  // The relay's clock at the last sync: `seenAt` is in that clock
  const [relayNow, setRelayNow] = useState(0);
  const remotePilotsRef = useRef(remotePilots);
  remotePilotsRef.current = remotePilots;
  const relayCursorRef = useRef(0);
  const relayOutboxRef = useRef<RelayOutgoingText[]>([]);
  const seenTextsRef = useRef(new SeenIds());
  const relayClipListenersRef = useRef<Set<RelayClipListener>>(new Set());
  // Set below, once it exists: the relay loop adopts our SOS state from the relay
  const applyMySosRef = useRef<(active: boolean, at: number) => void>(() => {});

  namesRef.current = Object.fromEntries(remotePilots.map(p => [p.uid, p.name]));
  for (const r of relayRiders) namesRef.current[r.uid] ??= r.name;
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
    const key = `${m.t}-${m.uid}-${m.id}-${Math.random().toString(36).slice(2, 6)}`;
    setMessages(prev => addToHistory(prev, {...m, key}));
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

  // Every SOS path lands here: the newest change wins, alerts only on a change
  const receiveSos = (uid: number, active: boolean, at: number) => {
    const {next, changed} = applySosChange(sosStatesRef.current, uid, active, at);
    if (next === sosStatesRef.current) return;
    sosStatesRef.current = next;
    setSosStates(next);
    if (!changed) return;
    const from = nameOf(uid);
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

  const handleRelayEvent = (e: RelayEvent) => {
    // A relay-only rider may not be in namesRef until the next render
    namesRef.current[e.uid] ??= e.from;
    if (e.type === 'text') {
      if (seenTextsRef.current.firstTime(e.id)) receiveTextRef.current(e.uid, e.msg, e.text);
    } else if (e.type === 'sos') {
      // Without a time it can only fill a rider never seen (rows come first)
      receiveSosRef.current(e.uid, e.active, e.at ?? 0);
    } else {
      relayClipListenersRef.current.forEach(l => {
        try {
          l(e);
        } catch (err) {
          console.warn('[Ride] relay clip listener error', err);
        }
      });
    }
  };
  const handleRelayEventRef = useRef(handleRelayEvent);
  handleRelayEventRef.current = handleRelayEvent;

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
          // The same quick message may also come through the relay
          if (!msg.mid || seenTextsRef.current.firstTime(msg.mid)) receiveTextRef.current(uid, msg.id, msg.text);
          break;
        case 'sos': {
          if (msg.lat !== null && msg.lon !== null) {
            const {lat, lon} = msg;
            setPositions(prev => ({...prev, [uid]: {...(prev[uid] ?? {cog: null, sog: null, acc: 0}), lat, lon, t: Date.now()}}));
          }
          receiveSosRef.current(uid, msg.active, msg.at);
          break;
        }
      }
    });
  }, [subscribeStream]);

  // A new stay in a channel starts from nothing; a reconnect is not one.
  // Positions and SOS are forgotten when we leave (the history stays for the app's run).
  useEffect(() => {
    if (session === null) return;
    return () => {
      relayCursorRef.current = 0;
      relayOutboxRef.current = [];
      if (demoRef.current) return;
      setPositions({});
      sosStatesRef.current = {};
      setSosStates({});
      forgetMySos();
    };
    // Only on session changes
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session]);

  // Relay: the way riders without a phone reach the group. It lives as long as
  // the session and only pauses while Agora reconnects.
  useEffect(() => {
    if (!relayEnabled || session === null || demo || localUid === null) return;
    const key = channelKey(channelName);
    const uid = localUid;
    let busy = false;
    let cancelled = false;
    const timer = setInterval(async () => {
      if (busy || !connectedRef.current) return;
      busy = true;
      const res = await relaySync(key, {
        uid,
        name: pilotNameRef.current,
        source: 'phone',
        pos: myPositionRef.current,
        sos: mySosRef.current,
        sosAt: mySosAtRef.current,
        cursor: relayCursorRef.current,
        events: relayOutboxRef.current,
      });
      busy = false;
      if (!res || cancelled) return;
      relayCursorRef.current = res.cursor;
      relayOutboxRef.current = relayOutboxRef.current.filter(e => !res.acked.includes(e.id));
      setRelayRiders(res.riders);
      setRelayNow(res.now);
      // Rows before events, so a replayed old `sos` event cannot win
      for (const r of Object.values(mergeRelayRiders(res.riders))) {
        if (r.uid === uid) {
          // A newer change from our watch: take it with its time. A change we
          // made while the request was in flight is newer and stays.
          if (r.sosAt > mySosAtRef.current) applyMySosRef.current(r.sos, r.sosAt);
          continue;
        }
        namesRef.current[r.uid] ??= r.name;
        receiveSosRef.current(r.uid, r.sos, r.sosAt);
      }
      res.events.forEach(e => handleRelayEventRef.current(e));
    }, RELAY_SYNC_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
      setRelayRiders([]);
      setRelayNow(0);
    };
    // channelName and localUid are part of session
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session, demo]);

  // Forget riders who left (not while reconnecting: the list may be stale)
  useEffect(() => {
    if (!connected) return;
    const present = new Set(remotePilots.map(p => p.uid));
    setPositions(prev => {
      const keys = Object.keys(prev).map(Number);
      if (keys.every(k => present.has(k))) return prev;
      return Object.fromEntries(Object.entries(prev).filter(([k]) => present.has(Number(k))));
    });
  }, [connected, remotePilots]);

  const sendQuickMessage = useCallback((id: string, text?: string) => {
    const body = text ?? quickMessageText(id);
    // One id on both paths, so a phone that gets it twice shows it once
    const mid = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    if (!sendStreamJson({type: 'text', id, text: body, mid}) && !demoRef.current) {
      appLog('Ride', `quick message not sent (not connected): ${id}`);
      return;
    }
    // Demo mode never syncs, so nothing is queued for the relay
    if (relayEnabled && !demoRef.current) {
      const outbox = relayOutboxRef.current;
      outbox.push({id: mid, type: 'text', msg: id, text: body});
      if (outbox.length > RELAY_OUTBOX_MAX) {
        const dropped = outbox.shift();
        appLog('Relay', `outbox full, dropped quick message ${dropped?.msg}`);
      }
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

  // Our SOS state, from the user or adopted from the relay with the time it carries
  const applyMySos = useCallback((active: boolean, at: number) => {
    const changed = mySosRef.current !== active;
    mySosAtRef.current = at;
    mySosRef.current = active;
    setMySos(active);
    if (!changed) return;
    const p = myPositionRef.current;
    const msg = {type: 'sos', active, at, lat: p?.lat ?? null, lon: p?.lon ?? null};
    sendStreamJson(msg);
    // Send twice: SOS must not depend on a single data-stream packet
    setTimeout(() => sendStreamJson(msg), 1500);
    pushMessage({uid: null, from: 'You', id: 'sos', text: active ? 'SOS sent' : 'SOS cancelled', t: Date.now()});
  }, [sendStreamJson, pushMessage]);
  applyMySosRef.current = applyMySos;

  const setSos = useCallback((active: boolean) => {
    applyMySos(active, Date.now());
    if (demoRef.current && active) {
      setTimeout(() => {
        if (demoRef.current) receiveTextRef.current(DEMO_RIDERS[1].uid, 'custom', 'Saw your SOS, coming');
      }, 4000);
    }
  }, [applyMySos]);

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
    const kept = Object.fromEntries(Object.entries(sosStatesRef.current).filter(([k]) => !demoRider(Number(k))));
    sosStatesRef.current = kept;
    setSosStates(kept);
    if (session === null) forgetMySos();
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
    receiveSosRef.current(uid, on, Date.now());
  }, []);

  // While our SOS is on, repeat it so late joiners see it too
  useEffect(() => {
    if (!mySos || !connected) return;
    const timer = setInterval(() => {
      const p = myPositionRef.current;
      // The time of the change, not of the repeat
      sendStreamJson({type: 'sos', active: true, at: mySosAtRef.current, lat: p?.lat ?? null, lon: p?.lon ?? null});
    }, SOS_REPEAT_MS);
    return () => clearInterval(timer);
  }, [mySos, connected, sendStreamJson]);

  const subscribeRideEvents = useCallback((listener: RideEventListener) => {
    listenersRef.current.add(listener);
    return () => {
      listenersRef.current.delete(listener);
    };
  }, []);

  const logMessage = useCallback(
    (from: string, id: string, text: string, uid: number | null = null, clip?: HistoryClip) => {
      pushMessage({uid, from, id, text, t: Date.now(), clip});
    },
    [pushMessage],
  );

  const subscribeRelayClips = useCallback((listener: RelayClipListener) => {
    relayClipListenersRef.current.add(listener);
    return () => {
      relayClipListenersRef.current.delete(listener);
    };
  }, []);
  // Our own watch gets nothing we send through the relay (same uid), so it does not count
  const soloRiderPresent = useMemo(
    () => hasSoloRider(relayRiders.filter(r => r.uid !== localUid), relayNow),
    [relayRiders, localUid, relayNow],
  );

  const relayMerged = useMemo(() => mergeRelayRiders(relayRiders), [relayRiders]);
  // A fresh fix from our own watch wins, as it does for the rest of the group
  const me = useMemo(
    () => pickPosition(myPosition ?? undefined, localUid === null ? undefined : relayMerged[localUid]?.watch, now) ?? null,
    [myPosition, localUid, relayMerged, now],
  );

  const riders = useMemo(() => {
    const onAgora = new Set(remotePilots.map(p => p.uid));
    return buildRiderViews(
      me,
      [
        ...remotePilots.map(p => {
          const relay = relayMerged[p.uid];
          return {
            uid: p.uid,
            name: p.name,
            speaking: p.status === 'speaking',
            position: pickPosition(positions[p.uid] ?? relay?.phone, relay?.watch, now),
            sos: !!sosStates[p.uid]?.active,
          };
        }),
        ...Object.values(relayMerged)
          .filter(r => !onAgora.has(r.uid) && r.uid !== localUid)
          .map(r => ({
            uid: r.uid,
            name: r.name,
            speaking: false,
            position: pickPosition(r.phone, r.watch, now),
            sos: !!sosStates[r.uid]?.active,
          })),
        ...(demo
          ? DEMO_RIDERS.map(r => ({
              uid: r.uid,
              name: r.name,
              speaking: false,
              position: demoAnchor ? demoPosition(r, demoAnchor, now) : undefined,
              sos: !!sosStates[r.uid]?.active,
            }))
          : []),
      ],
      now,
    );
  }, [me, remotePilots, relayMerged, localUid, positions, sosStates, now, demo, demoAnchor]);

  const value = useMemo(
    () => ({
      myPosition, riders, messages, mySos, locationDenied, sendQuickMessage, setSos, subscribeRideEvents, logMessage,
      demo, setDemo, demoSosUid, setDemoSos, subscribeRelayClips, soloRiderPresent,
    }),
    [
      myPosition, riders, messages, mySos, locationDenied, sendQuickMessage, setSos, subscribeRideEvents, logMessage,
      demo, setDemo, demoSosUid, setDemoSos, subscribeRelayClips, soloRiderPresent,
    ],
  );

  return <RideContext.Provider value={value}>{children}</RideContext.Provider>;
}

export function useRide(): RideContextValue {
  const ctx = useContext(RideContext);
  if (!ctx) throw new Error('useRide must be used within a RideProvider');
  return ctx;
}
