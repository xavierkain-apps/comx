import React from 'react';
import {Alert, Modal, ScrollView, StyleSheet, Text, TouchableOpacity, Vibration, View} from 'react-native';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import {useAgoraContext} from '../../contexts/AgoraContext';
import {RideMessage, useRide} from '../../contexts/RideContext';
import {useMemos} from '../../contexts/MemoContext';
import {QUICK_MESSAGES} from '../../ride/protocol';
import {historyTitle, replayLabel} from '../../memo/memo';
import {condensed, plain, signal} from '../../theme';

interface MsgSheetProps {
  visible: boolean;
  onClose: () => void;
  /** Leaves the channel (after the confirmation here). */
  onLeave: () => void;
}

/** Quick messages, history with replay, speaker, video pause, leave. */
export function MsgSheet({visible, onClose, onLeave}: MsgSheetProps) {
  const insets = useSafeAreaInsets();
  const {isSpeakerOn, toggleSpeaker, isHeadphonesConnected, isPausedForVideo, pauseForVideo, resumeFromVideo} = useAgoraContext();
  const {messages, sendQuickMessage} = useRide();
  const {replay} = useMemos();
  const newestVoiceKey = messages.find(m => m.clip !== undefined)?.key;

  const confirmLeave = () => {
    Alert.alert('Leave group', 'Are you sure you want to leave this group?', [
      {text: 'Cancel', style: 'cancel'},
      {
        text: 'Leave',
        style: 'destructive',
        onPress: () => {
          onClose();
          onLeave();
        },
      },
    ]);
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.root}>
        <TouchableOpacity style={StyleSheet.absoluteFill} activeOpacity={1} onPress={onClose} accessibilityLabel="Close messages" />
        <View style={[styles.panel, {paddingBottom: Math.max(insets.bottom, 16)}]}>
          <View style={styles.grabber} />
          <Text style={styles.overline}>QUICK MESSAGES</Text>
          <View style={styles.quick}>
            {QUICK_MESSAGES.map(q => (
              <TouchableOpacity
                key={q.id}
                style={styles.quickPill}
                activeOpacity={0.7}
                accessibilityRole="button"
                onPress={() => {
                  Vibration.vibrate(30);
                  sendQuickMessage(q.id);
                  onClose();
                }}>
                <Text style={[styles.quickText, q.id === 'help' && styles.quickHelp]} numberOfLines={1} adjustsFontSizeToFit>
                  {q.text}
                </Text>
              </TouchableOpacity>
            ))}
          </View>

          <Text style={styles.overline}>HISTORY</Text>
          <ScrollView style={styles.history}>
            {messages.length === 0 && <Text style={styles.empty}>Nothing yet. Messages, SOS and voice memos show here.</Text>}
            {messages.map(m => {
              const clip = m.clip;
              return (
                <HistoryRow
                  key={m.key}
                  message={m}
                  highlighted={m.key === newestVoiceKey}
                  onReplay={clip ? () => replay(clip) : undefined}
                />
              );
            })}
          </ScrollView>

          <View style={styles.actions}>
            {isHeadphonesConnected ? (
              <View style={styles.action}>
                <Text style={[styles.actionText, styles.actionTeal]}>EARPHONE</Text>
              </View>
            ) : (
              <TouchableOpacity
                style={[styles.action, isSpeakerOn && styles.actionOn]}
                onPress={toggleSpeaker}
                accessibilityRole="switch"
                accessibilityState={{checked: isSpeakerOn}}>
                <Text style={[styles.actionText, isSpeakerOn && styles.actionTextOn]}>{isSpeakerOn ? 'SPEAKER ON' : 'SPEAKER OFF'}</Text>
              </TouchableOpacity>
            )}
            <TouchableOpacity
              style={styles.action}
              onPress={isPausedForVideo ? resumeFromVideo : pauseForVideo}
              accessibilityRole="button">
              <Text style={styles.actionText}>{isPausedForVideo ? 'RESUME AUDIO' : 'PAUSE FOR VIDEO'}</Text>
            </TouchableOpacity>
          </View>

          <TouchableOpacity style={styles.leave} onPress={confirmLeave} accessibilityRole="button">
            <Text style={styles.leaveText}>Leave group</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

function HistoryRow({message, highlighted, onReplay}: {message: RideMessage; highlighted: boolean; onReplay?: () => void}) {
  const voice = message.clip !== undefined;
  const sos = message.id === 'sos';
  const body = (
    <>
      <View style={[styles.marker, voice ? styles.markerVoice : sos ? styles.markerSos : styles.markerText]} />
      <View style={styles.rowText}>
        <Text style={styles.rowTitle} numberOfLines={1}>
          {historyTitle(message.from, message.t)}
        </Text>
        <Text style={[styles.rowBody, voice && styles.rowBodyVoice]} numberOfLines={2}>
          {message.text}
        </Text>
      </View>
      {voice && <Text style={styles.play}>PLAY</Text>}
    </>
  );
  if (!onReplay) return <View style={styles.row}>{body}</View>;
  return (
    <TouchableOpacity
      style={[styles.row, highlighted && styles.rowHighlight]}
      onPress={onReplay}
      accessibilityRole="button"
      accessibilityLabel={replayLabel(message.from, message.uid === null)}>
      {body}
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(0, 0, 0, 0.45)',
  },
  panel: {
    maxHeight: '90%',
    backgroundColor: signal.surface,
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    paddingTop: 10,
    paddingHorizontal: 18,
  },
  grabber: {
    alignSelf: 'center',
    width: 40,
    height: 5,
    borderRadius: 3,
    backgroundColor: signal.outline,
    marginBottom: 12,
  },
  overline: {
    color: signal.textMuted,
    marginTop: 6,
    marginBottom: 8,
    ...condensed(12, 700, 2),
  },
  quick: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  quickPill: {
    width: '48.5%',
    minHeight: 56,
    borderRadius: 28,
    backgroundColor: signal.surfaceAlt,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 12,
  },
  quickText: {
    color: signal.text,
    ...condensed(18, 800, 1),
  },
  quickHelp: {
    color: signal.amber,
  },
  history: {
    flexGrow: 0,
    maxHeight: 280,
  },
  empty: {
    color: signal.textMuted,
    paddingVertical: 12,
    ...plain(14, 600),
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    padding: 8,
    borderRadius: 12,
  },
  rowHighlight: {
    backgroundColor: signal.surfaceAlt,
  },
  marker: {
    width: 26,
    height: 26,
    borderRadius: 13,
  },
  markerVoice: {
    backgroundColor: signal.yellow,
  },
  markerSos: {
    backgroundColor: signal.red,
  },
  markerText: {
    borderWidth: 2,
    borderColor: signal.teal,
  },
  rowText: {
    flex: 1,
  },
  rowTitle: {
    color: signal.text,
    ...condensed(14, 700),
  },
  rowBody: {
    color: signal.text,
    ...plain(13, 600),
  },
  rowBodyVoice: {
    color: signal.textMuted,
  },
  play: {
    color: signal.yellow,
    ...condensed(13, 800, 1),
  },
  actions: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 14,
  },
  action: {
    flex: 1,
    height: 48,
    borderRadius: 24,
    borderWidth: 1.5,
    borderColor: signal.outline,
    alignItems: 'center',
    justifyContent: 'center',
  },
  actionOn: {
    backgroundColor: signal.teal,
    borderColor: signal.teal,
  },
  actionText: {
    color: signal.textMuted,
    ...condensed(14, 700, 1),
  },
  actionTextOn: {
    color: signal.onAccent,
  },
  actionTeal: {
    color: signal.teal,
  },
  leave: {
    alignSelf: 'center',
    paddingVertical: 14,
    paddingHorizontal: 24,
    marginTop: 4,
  },
  leaveText: {
    color: signal.red,
    ...plain(15, 700),
  },
});
