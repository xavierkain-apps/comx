import React, {useEffect, useRef} from 'react';
import {View, Text, TouchableOpacity, StyleSheet, Alert, Vibration, Platform} from 'react-native';
import Sound from 'react-native-sound';
import {useAgoraContext} from '../contexts/AgoraContext';
import {useUser} from '../contexts/UserContext';
import {useMute} from '../hooks/useMute';
import {useBluetoothHID} from '../hooks/useBluetoothHID';
import {MuteButton} from '../components/MuteButton';
import {PilotList} from '../components/PilotList';
import {ChannelBadge} from '../components/ChannelBadge';
import {RideBar} from '../components/RideBar';
import {useRide} from '../contexts/RideContext';
import {useWatch} from '../contexts/WatchContext';
import {useTheme} from '../contexts/ThemeContext';
import {soundFile} from '../utils/sounds';
import {colors as defaultColors, fonts, spacing, radius} from '../theme';

interface VoiceScreenProps {
  onLeft: () => void;
}

export function VoiceScreen({onLeft}: VoiceScreenProps) {
  const {colors} = useTheme();
  const {channelName, remotePilots, leaveChannel, connectionState, isSpeakerOn, toggleSpeaker, inactivityWarning, warningSecondsLeft, dismissWarning, autoDisconnected, isPausedForVideo, pauseForVideo, resumeFromVideo, isHeadphonesConnected, isInterrupted} = useAgoraContext();
  const {pilotName} = useUser();
  const {isMuted, toggle} = useMute();
  useBluetoothHID(toggle);
  const audioPlayedRef = useRef(false);
  const {riders} = useRide();
  const watch = useWatch();

  // Play audio warning for silence timeout
  useEffect(() => {
    if (inactivityWarning === 'silence' && !audioPlayedRef.current) {
      audioPlayedRef.current = true;
      try {
        Vibration.vibrate(Platform.OS === 'ios' ? 500 : 1000);
      } catch {}
      const warning = new Sound(soundFile('inactivity_warning'), Sound.MAIN_BUNDLE, (err) => {
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

  // Auto-navigate home when auto-disconnected
  useEffect(() => {
    if (autoDisconnected) {
      onLeft();
    }
  }, [autoDisconnected, onLeft]);

  const handleLeave = () => {
    Alert.alert('Leave Flight', 'Are you sure you want to leave this channel?', [
      {text: 'Cancel', style: 'cancel'},
      { text: 'Leave', style: 'destructive', onPress: async () => { await leaveChannel(); onLeft(); } },
    ]);
  };

  const formatCountdown = (seconds: number) => {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m}:${s.toString().padStart(2, '0')}`;
  };

  return (
    <View style={[styles.container, {backgroundColor: colors.bg}]}>
      <View style={styles.header}>
        <View style={styles.headerLeft}>
          <Text style={[styles.channelLabel, {color: colors.textMuted}]}>Channel</Text>
          <Text style={[styles.channelName, {color: colors.text}]}>{channelName}</Text>
        </View>
        <View style={styles.headerRight}>
          {connectionState === 'connected' && <ChannelBadge />}
          {connectionState === 'reconnecting' && <Text style={[styles.reconnecting, {color: colors.amber}]}>Reconnecting...</Text>}
          {connectionState === 'failed' && <Text style={[styles.reconnecting, {color: colors.red}]}>Connection lost</Text>}
        </View>
      </View>

      {inactivityWarning && (
        <View style={[styles.warningBanner, {backgroundColor: colors.amber + '20', borderColor: colors.amber}]}>
          <Text style={[styles.warningText, {color: colors.amber}]}>
            {inactivityWarning === 'solo'
              ? `You're alone. Disconnecting in ${formatCountdown(warningSecondsLeft)}`
              : `No activity. Disconnecting in ${formatCountdown(warningSecondsLeft)}`}
          </Text>
          <TouchableOpacity
            style={[styles.stayButton, {backgroundColor: colors.amber}]}
            onPress={dismissWarning}
            activeOpacity={0.7}>
            <Text style={styles.stayButtonText}>Stay Connected</Text>
          </TouchableOpacity>
        </View>
      )}

      {isInterrupted && (
        <View style={[styles.warningBanner, {backgroundColor: colors.amber + '20', borderColor: colors.amber}]}>
          <Text style={[styles.warningText, {color: colors.amber, marginBottom: 0}]}>
            Call in progress — your mic is paused, you're still in the channel
          </Text>
        </View>
      )}

      <View style={styles.pilotListWrapper}>
        <PilotList remotePilots={remotePilots} localPilotName={pilotName} isMuted={isMuted} riders={riders} />
      </View>

      <RideBar />

      <View style={styles.controls}>
        {watch.watchMode || watch.pttMode ? (
          <View style={[styles.watchPill, {backgroundColor: colors.primaryLight, borderColor: colors.primary}]}>
            <Text style={[styles.watchTitle, {color: colors.primary}]}>
              {watch.watchMode ? '⌚ Watch mode' : '⌚ Garmin — talk via phone'}
            </Text>
            <Text style={[styles.watchHint, {color: colors.textSecondary}]}>
              {watch.phonePtt
                ? 'Phone mic on — talking'
                : watch.watchMode
                  ? 'Talk and listen on your watch — phone mic off'
                  : 'Phone mic off until you press Talk on the watch'}
            </Text>
          </View>
        ) : (
          <MuteButton isMuted={isMuted} onPress={toggle} />
        )}

        {isHeadphonesConnected ? (
          <View style={[styles.speakerPill, {backgroundColor: colors.bgCard, borderColor: colors.green + '66'}]}>
            <Text style={styles.speakerIcon}>🎧</Text>
            <Text style={[styles.speakerText, {color: colors.green}]}>Earphone</Text>
          </View>
        ) : (
          <TouchableOpacity
            style={[styles.speakerPill, {backgroundColor: colors.bgCard, borderColor: colors.primaryBorder}, isSpeakerOn && styles.speakerPillActive]}
            onPress={toggleSpeaker}
            activeOpacity={0.7}>
            <Text style={styles.speakerIcon}>{isSpeakerOn ? '🔊' : '🔈'}</Text>
            <Text style={[styles.speakerText, {color: colors.textSecondary}, isSpeakerOn && {color: colors.primary}]}>
              Speaker
            </Text>
          </TouchableOpacity>
        )}

        {isPausedForVideo ? (
          <TouchableOpacity
            style={[styles.speakerPill, {backgroundColor: colors.bgCard, borderColor: colors.green + '66'}]}
            onPress={resumeFromVideo}
            activeOpacity={0.7}>
            <Text style={styles.speakerIcon}>🎙️</Text>
            <Text style={[styles.speakerText, {color: colors.green}]}>Resume</Text>
          </TouchableOpacity>
        ) : (
          <TouchableOpacity
            style={[styles.speakerPill, {backgroundColor: colors.bgCard, borderColor: colors.primaryBorder}]}
            onPress={pauseForVideo}
            activeOpacity={0.7}>
            <Text style={styles.speakerIcon}>🎥</Text>
            <Text style={[styles.speakerText, {color: colors.textSecondary}]}>Video</Text>
          </TouchableOpacity>
        )}
      </View>

      <TouchableOpacity style={styles.leaveButton} onPress={handleLeave} activeOpacity={0.6}>
        <Text style={styles.leaveText}>Leave Flight</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: defaultColors.bg,
    paddingTop: spacing.xxxl,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: spacing.xl,
    paddingBottom: spacing.lg,
  },
  headerLeft: {
    flex: 1,
  },
  headerRight: {
    marginLeft: spacing.md,
  },
  channelLabel: {
    fontSize: fonts.label,
    color: defaultColors.textMuted,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 1.5,
    marginBottom: spacing.xs,
  },
  channelName: {
    fontSize: fonts.title,
    fontWeight: '800',
    letterSpacing: 0.5,
    color: defaultColors.text,
  },
  reconnecting: {
    fontSize: fonts.label,
    fontWeight: '600',
    color: defaultColors.amber,
  },
  pilotListWrapper: {
    flex: 1,
  },
  controls: {
    alignItems: 'center',
    paddingBottom: spacing.lg,
  },
  speakerPill: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: defaultColors.bgCard,
    borderRadius: radius.full,
    borderWidth: 1,
    borderColor: defaultColors.primaryBorder,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.lg,
    marginTop: spacing.md,
  },
  speakerPillActive: {
    backgroundColor: defaultColors.primaryLight,
    borderColor: defaultColors.primary,
  },
  speakerIcon: {
    fontSize: 16,
    marginRight: spacing.sm,
  },
  speakerText: {
    fontSize: fonts.sm,
    fontWeight: '600',
    color: defaultColors.textSecondary,
  },
  speakerTextActive: {
    color: defaultColors.primary,
  },
  watchPill: {
    borderWidth: 1,
    borderRadius: radius.lg,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.xl,
    alignItems: 'center',
  },
  watchTitle: {
    fontSize: fonts.body,
    fontWeight: '800',
  },
  watchHint: {
    fontSize: fonts.sm,
    marginTop: spacing.xs,
    textAlign: 'center',
  },
  leaveButton: {
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.xl,
    marginBottom: spacing.xxl,
    alignSelf: 'center',
  },
  leaveText: {
    fontSize: fonts.body,
    fontWeight: '600',
    color: defaultColors.red,
  },
  warningBanner: {
    marginHorizontal: spacing.lg,
    marginBottom: spacing.md,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
    borderRadius: radius.lg,
    borderWidth: 1,
    alignItems: 'center',
  },
  warningText: {
    fontSize: fonts.sm,
    fontWeight: '700',
    textAlign: 'center',
    marginBottom: spacing.sm,
  },
  stayButton: {
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.xl,
    borderRadius: radius.full,
  },
  stayButtonText: {
    fontSize: fonts.sm,
    fontWeight: '700',
    color: '#000',
  },
});
