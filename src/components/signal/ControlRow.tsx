import React from 'react';
import {StyleSheet, Text, TouchableOpacity, Vibration, View} from 'react-native';
import {CONTROL_HEIGHT} from '../../radar/sheet';
import {condensed, signal} from '../../theme';

/** What the TALK slot shows. */
export type TalkState = 'muted' | 'live' | 'watch' | 'garmin' | 'garminTalking';

interface ControlRowProps {
  mySos: boolean;
  onSos: (active: boolean) => void;
  talk: TalkState;
  onTalk: () => void;
  /** A memo is recording: the stream stays muted, TALK can't go live. */
  talkDisabled: boolean;
  memoRecording: boolean;
  memoSecondsLeft: number;
  memoEnabled: boolean;
  onMemo: () => void;
  onMsg: () => void;
  /** A message from someone else arrived since the MSG sheet was last open. */
  msgUnread: boolean;
}

/** SOS · TALK · MEMO · MSG, pinned to the bottom of the sheet. */
export function ControlRow(p: ControlRowProps) {
  const memoDisabled = !p.memoEnabled && !p.memoRecording;
  return (
    <View style={styles.row}>
      <TouchableOpacity
        style={[styles.round, p.mySos ? styles.sosOn : styles.sosOff]}
        onPress={() => p.mySos && p.onSos(false)}
        onLongPress={() => {
          if (p.mySos) return;
          Vibration.vibrate(400);
          p.onSos(true);
        }}
        delayLongPress={1000}
        activeOpacity={0.7}
        accessibilityRole="button"
        accessibilityLabel={p.mySos ? 'Cancel my SOS' : 'SOS, hold one second'}>
        <Text style={[styles.sosText, p.mySos && styles.sosCancel]}>{p.mySos ? 'CANCEL' : 'SOS'}</Text>
      </TouchableOpacity>

      <TalkButton state={p.talk} onPress={p.onTalk} disabled={p.talkDisabled} />

      <TouchableOpacity
        style={[styles.round, p.memoRecording ? styles.memoOn : styles.secondary, memoDisabled && styles.disabled]}
        disabled={memoDisabled}
        onPress={p.onMemo}
        activeOpacity={0.7}
        accessibilityRole="button"
        accessibilityState={{disabled: memoDisabled}}
        accessibilityLabel={p.memoRecording ? `Send the memo, ${p.memoSecondsLeft} seconds left` : 'Record a voice memo'}>
        {p.memoRecording ? (
          <>
            <Text style={styles.memoSend}>SEND</Text>
            <Text style={styles.memoCount}>{p.memoSecondsLeft}</Text>
          </>
        ) : (
          <Text style={styles.secondaryText}>MEMO</Text>
        )}
      </TouchableOpacity>

      <TouchableOpacity
        style={[styles.round, styles.secondary]}
        onPress={p.onMsg}
        activeOpacity={0.7}
        accessibilityRole="button"
        accessibilityLabel={p.msgUnread ? 'Messages, new messages' : 'Messages'}>
        <Text style={styles.secondaryText}>MSG</Text>
        {p.msgUnread && <View style={styles.unread} />}
      </TouchableOpacity>
    </View>
  );
}

function TalkButton({state, onPress, disabled}: {state: TalkState; onPress: () => void; disabled: boolean}) {
  if (state === 'watch' || state === 'garmin' || state === 'garminTalking') {
    const title = state === 'watch' ? 'WATCH MODE' : 'GARMIN';
    const sub = state === 'watch' ? 'TALK ON YOUR WATCH' : state === 'garminTalking' ? 'PHONE MIC ON' : 'TALK VIA PHONE';
    return (
      <View style={[styles.talk, styles.talkWatch]} accessible accessibilityLabel={`${title}, ${sub}`}>
        <Text style={styles.watchTitle} numberOfLines={1} adjustsFontSizeToFit>
          {title}
        </Text>
        <Text style={styles.watchSub} numberOfLines={1} adjustsFontSizeToFit>
          {sub}
        </Text>
      </View>
    );
  }
  const live = state === 'live';
  return (
    <TouchableOpacity
      style={[styles.talk, {backgroundColor: live ? signal.yellow : signal.teal}, disabled && styles.disabled]}
      onPress={onPress}
      disabled={disabled}
      activeOpacity={0.75}
      accessibilityRole="button"
      accessibilityState={{disabled}}
      accessibilityLabel={disabled ? 'Muted while the memo records' : live ? 'Live, tap to mute' : 'Muted, tap to talk'}>
      <Text style={styles.talkText}>{live ? 'LIVE' : 'TALK'}</Text>
      <Text style={styles.talkSub} numberOfLines={1} adjustsFontSizeToFit>
        {disabled ? 'MEMO RECORDING' : live ? 'TAP TO MUTE' : 'TAP TO TALK'}
      </Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    gap: 8,
    height: CONTROL_HEIGHT,
  },
  round: {
    width: CONTROL_HEIGHT,
    height: CONTROL_HEIGHT,
    borderRadius: CONTROL_HEIGHT / 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sosOff: {
    borderWidth: 2,
    borderColor: signal.red,
  },
  sosOn: {
    backgroundColor: signal.red,
  },
  sosText: {
    color: signal.red,
    ...condensed(17, 800),
  },
  sosCancel: {
    color: signal.text,
    fontSize: 14,
  },
  talk: {
    flex: 1,
    height: CONTROL_HEIGHT,
    borderRadius: CONTROL_HEIGHT / 2,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 8,
  },
  talkText: {
    color: signal.onAccent,
    lineHeight: 26,
    ...condensed(24, 800, 1),
  },
  talkSub: {
    color: signal.onAccent,
    ...condensed(11, 700, 1),
  },
  talkWatch: {
    backgroundColor: signal.surfaceAlt,
  },
  watchTitle: {
    color: signal.teal,
    ...condensed(15, 800, 1),
  },
  watchSub: {
    color: signal.textMuted,
    ...condensed(11, 700, 1),
  },
  secondary: {
    backgroundColor: signal.surfaceAlt,
  },
  secondaryText: {
    color: signal.text,
    ...condensed(14, 700, 1),
  },
  memoOn: {
    backgroundColor: signal.red,
  },
  memoSend: {
    color: signal.text,
    lineHeight: 14,
    ...condensed(12, 800, 1),
  },
  memoCount: {
    color: signal.text,
    lineHeight: 22,
    ...condensed(22, 800),
  },
  disabled: {
    opacity: 0.35,
  },
  unread: {
    position: 'absolute',
    top: 8,
    right: 8,
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: signal.red,
    borderWidth: 2,
    borderColor: signal.surface,
  },
});
