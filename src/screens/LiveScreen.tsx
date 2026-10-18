import React, {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import {Platform, StyleSheet, Text, TouchableOpacity, Vibration, View, useWindowDimensions} from 'react-native';
import Sound from 'react-native-sound';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import {useAgoraContext} from '../contexts/AgoraContext';
import {useRide} from '../contexts/RideContext';
import {useWatch} from '../contexts/WatchContext';
import {useMemos} from '../contexts/MemoContext';
import {useMute} from '../hooks/useMute';
import {useBluetoothHID} from '../hooks/useBluetoothHID';
import {soundFile} from '../utils/sounds';
import {ArrowMode, arrowHeading} from '../radar/radar';
import {sheetDetents} from '../radar/sheet';
import {RadarView} from '../components/signal/RadarView';
import {RiderRow} from '../components/signal/RiderRow';
import {BottomSheet} from '../components/signal/BottomSheet';
import {ControlRow, TalkState} from '../components/signal/ControlRow';
import {Banner} from '../components/signal/Banner';
import {MsgSheet} from '../components/signal/MsgSheet';
import {condensed, plain, signal} from '../theme';

interface LiveScreenProps {
  onLeft: () => void;
}

function formatCountdown(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

export function LiveScreen({onLeft}: LiveScreenProps) {
  const {width, height} = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const {
    channelName, leaveChannel, connectionState, inactivityWarning, warningSecondsLeft, dismissWarning,
    autoDisconnected, isInterrupted, olderRiders, dismissOlderRider,
  } = useAgoraContext();
  const {isMuted, toggle} = useMute();
  useBluetoothHID(toggle);
  const {riders, myPosition, mySos, setSos, locationDenied} = useRide();
  const watch = useWatch();
  const memo = useMemos();
  const [arrowMode, setArrowMode] = useState<ArrowMode>('north');
  const [msgOpen, setMsgOpen] = useState(false);
  const audioPlayedRef = useRef(false);

  const heading = arrowHeading(arrowMode, myPosition?.cog);
  const bottomPad = Math.max(insets.bottom, 16);
  const detents = useMemo(() => sheetDetents(height, bottomPad), [height, bottomPad]);
  // The radar fills what the sheet leaves at rest, a little under its rounded top
  const radarHeight = height - detents.medium + 28;

  // Audio warning for the silence timeout (unchanged from VoiceScreen)
  useEffect(() => {
    if (inactivityWarning === 'silence' && !audioPlayedRef.current) {
      audioPlayedRef.current = true;
      try {
        Vibration.vibrate(Platform.OS === 'ios' ? 500 : 1000);
      } catch {}
      const warning = new Sound(soundFile('inactivity_warning'), Sound.MAIN_BUNDLE, err => {
        if (!err) warning.play(() => warning.release());
      });
    } else if (inactivityWarning === 'solo') {
      try {
        Vibration.vibrate(Platform.OS === 'ios' ? 500 : 1000);
      } catch {}
    }
    if (!inactivityWarning) {
      audioPlayedRef.current = false;
    }
  }, [inactivityWarning]);

  // Back to Join when auto-disconnected
  useEffect(() => {
    if (autoDisconnected) onLeft();
  }, [autoDisconnected, onLeft]);

  const leave = useCallback(async () => {
    await leaveChannel();
    onLeft();
  }, [leaveChannel, onLeft]);

  const talk: TalkState = watch.watchMode
    ? 'watch'
    : watch.pttMode
      ? watch.phonePtt ? 'garminTalking' : 'garmin'
      : isMuted ? 'muted' : 'live';

  // Decision 7: everyone in the channel, me included
  const count = riders.length + 1;
  const status =
    connectionState === 'reconnecting'
      ? {text: 'RECONNECTING…', color: signal.amber}
      : connectionState === 'failed'
        ? {text: 'CONNECTION LOST', color: signal.red}
        : {text: `● ${count} ${count === 1 ? 'RIDER' : 'RIDERS'}`, color: signal.teal};

  return (
    <View style={styles.container}>
      <View style={styles.radar}>
        <RadarView riders={riders} heading={heading} myCourse={myPosition?.cog ?? null} width={width} height={radarHeight} />
      </View>

      <View style={[styles.topLeft, {top: insets.top + 12}]}>
        <Text style={styles.channel} numberOfLines={1}>
          {channelName}
        </Text>
        <Text style={[styles.status, {color: status.color}]}>{status.text}</Text>
      </View>
      <TouchableOpacity
        style={[styles.topRight, {top: insets.top + 14}]}
        onPress={() => setArrowMode(m => (m === 'north' ? 'course' : 'north'))}
        hitSlop={12}
        accessibilityLabel={arrowMode === 'north' ? 'North up, tap for course up' : 'Course up, tap for north up'}>
        <Text style={styles.arrowMode}>{arrowMode === 'north' ? 'N ↑' : 'COG ↑'}</Text>
      </TouchableOpacity>

      <View style={[styles.banners, {top: insets.top + 64}]} pointerEvents="box-none">
        {memo.recording && (
          <Banner tone="red" text={`${memo.targetLabel} · ${memo.secondsLeft} s. Tap a rider to pick them, MEMO sends.`} />
        )}
        {inactivityWarning && (
          <Banner
            text={
              inactivityWarning === 'solo'
                ? `You're alone. Disconnecting in ${formatCountdown(warningSecondsLeft)}`
                : `No activity. Disconnecting in ${formatCountdown(warningSecondsLeft)}`
            }
            action={{label: 'STAY', onPress: dismissWarning}}
          />
        )}
        {isInterrupted && <Banner text="Call in progress: your mic is paused, you're still in the channel" />}
        {locationDenied && <Banner text="Location is off: others can't see where you are." />}
        {olderRiders.map(r => (
          <Banner key={r.uid} text={`${r.name} uses an older ComX`} action={{label: 'OK', onPress: () => dismissOlderRider(r.uid)}} />
        ))}
      </View>

      <BottomSheet
        detents={detents}
        bottomPad={bottomPad}
        footer={
          <ControlRow
            mySos={mySos}
            onSos={setSos}
            talk={talk}
            onTalk={toggle}
            memoRecording={memo.recording}
            memoSecondsLeft={memo.secondsLeft}
            memoEnabled={memo.canRecord}
            onMemo={memo.recording ? memo.sendMemo : memo.startMemo}
            onMsg={() => setMsgOpen(true)}
          />
        }>
        {riders.length === 0 ? (
          <Text style={styles.empty}>No other rider yet. Share the channel code {channelName}.</Text>
        ) : (
          riders.map(r => (
            <RiderRow
              key={r.uid}
              rider={r}
              heading={heading}
              selected={memo.recording && memo.target === r.uid}
              onPress={memo.recording ? () => memo.selectTarget(r.uid) : undefined}
            />
          ))
        )}
      </BottomSheet>

      <MsgSheet visible={msgOpen} onClose={() => setMsgOpen(false)} onLeave={leave} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: signal.bg,
  },
  radar: {
    position: 'absolute',
    top: 0,
    left: 0,
  },
  topLeft: {
    position: 'absolute',
    left: 20,
    right: 90,
  },
  channel: {
    color: signal.text,
    lineHeight: 26,
    ...condensed(24, 800),
  },
  status: {
    ...condensed(13, 600, 2),
  },
  topRight: {
    position: 'absolute',
    right: 20,
  },
  arrowMode: {
    color: signal.red,
    ...condensed(13, 700, 2),
  },
  banners: {
    position: 'absolute',
    left: 16,
    right: 16,
    gap: 8,
  },
  empty: {
    color: signal.textMuted,
    textAlign: 'center',
    paddingVertical: 20,
    ...plain(14, 600),
  },
});
