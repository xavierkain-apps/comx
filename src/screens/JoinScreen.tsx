import React, {useCallback, useEffect, useState} from 'react';
import {
  Alert,
  Keyboard,
  KeyboardAvoidingView,
  Modal,
  PermissionsAndroid,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  TouchableWithoutFeedback,
  View,
  useWindowDimensions,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {useSafeAreaInsets} from 'react-native-safe-area-context';
import {useUser} from '../contexts/UserContext';
import {useAgoraContext} from '../contexts/AgoraContext';
import {useRide} from '../contexts/RideContext';
import {generateChannelName, isValidChannelName, splitChannelCode} from '../utils/channelGenerator';
import {appLog} from '../utils/logger';
import {condensed, plain, signal} from '../theme';

const FAVORITES_KEY = '@soarx_favorite_channels';
const DEFAULT_CHANNEL = 'TARIFA-01';
/** Ring diameters of the hero at full size (handoff: 330 / 230 / 130, inner one teal). */
const RINGS = [330, 230, 130];
const HERO_HEIGHT = 400;
/** Favourite pills on the screen; the rest are in EDIT. */
const VISIBLE_FAVORITES = 3;

interface JoinScreenProps {
  onJoined: () => void;
  onSettings: () => void;
}

async function requestMicPermission(): Promise<boolean> {
  if (Platform.OS !== 'android') return true;
  const granted = await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.RECORD_AUDIO, {
    title: 'Microphone Permission',
    message: 'ComX needs microphone access to talk with your group.',
    buttonPositive: 'Allow',
  });
  if (granted !== PermissionsAndroid.RESULTS.GRANTED) return false;
  // Android 13+ suppresses the foreground-service notification without this.
  // Not being able to show it is not a reason to block the ride.
  if (Number(Platform.Version) >= 33) {
    try {
      await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS, {
        title: 'Notifications',
        message: 'Lets ComX show the group status while you ride.',
        buttonPositive: 'Allow',
      });
    } catch {}
  }
  return true;
}

export function JoinScreen({onJoined, onSettings}: JoinScreenProps) {
  const {pilotName, setPilotName} = useUser();
  const {joinChannel} = useAgoraContext();
  const {demo} = useRide();
  const insets = useSafeAreaInsets();
  const {width, height} = useWindowDimensions();
  const [channel, setChannel] = useState(DEFAULT_CHANNEL);
  const [editingChannel, setEditingChannel] = useState(false);
  const [editingName, setEditingName] = useState(false);
  const [isJoining, setIsJoining] = useState(false);
  const [favorites, setFavorites] = useState<string[]>([]);
  const [managing, setManaging] = useState(false);

  const validChannel = isValidChannelName(channel);
  const canJoin = pilotName.trim().length > 0 && validChannel;
  // Smaller phones: the rings shrink with the screen, the type does not
  const scale = Math.min(1, (width - 40) / RINGS[0], (height * 0.45) / HERO_HEIGHT);
  const {head, tail} = splitChannelCode(channel);

  useEffect(() => {
    AsyncStorage.getItem(FAVORITES_KEY).then(saved => {
      if (saved) setFavorites(JSON.parse(saved));
    });
  }, []);

  const saveFavorites = useCallback((next: string[]) => {
    setFavorites(next);
    AsyncStorage.setItem(FAVORITES_KEY, JSON.stringify(next));
  }, []);

  const isFavorite = favorites.includes(channel.trim().toUpperCase());

  const toggleFavorite = useCallback(() => {
    const name = channel.trim().toUpperCase();
    if (!name) return;
    if (favorites.includes(name)) saveFavorites(favorites.filter(f => f !== name));
    else saveFavorites([name, ...favorites]);
  }, [channel, favorites, saveFavorites]);

  const stopEditing = () => {
    Keyboard.dismiss();
    setEditingChannel(false);
    setEditingName(false);
  };

  const handleJoin = async () => {
    if (!canJoin || isJoining) return;
    stopEditing();
    const hasPermission = await requestMicPermission();
    if (!hasPermission) {
      Alert.alert('Permission Required', 'ComX needs microphone access to work. Please enable it in Settings.');
      return;
    }
    setIsJoining(true);
    try {
      await joinChannel({channelName: channel, pilotName});
      onJoined();
    } catch (error) {
      appLog('Join', `failed: ${error instanceof Error ? error.message : String(error)}`);
      Alert.alert('Connection Failed', 'Could not join the channel. Check your network coverage and try again.');
    } finally {
      setIsJoining(false);
    }
  };

  return (
    <TouchableWithoutFeedback onPress={stopEditing} accessible={false}>
      <KeyboardAvoidingView
        style={[styles.container, {paddingTop: insets.top}]}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View style={styles.topBar}>
          <Text style={styles.logo}>COMX</Text>
          <TouchableOpacity onPress={onSettings} hitSlop={12}>
            <Text style={styles.settings}>Settings</Text>
          </TouchableOpacity>
        </View>

        {demo && (
          <TouchableOpacity onPress={onSettings} activeOpacity={0.7}>
            <Text style={styles.demo}>Demo riders on: open ComX on your watch. Turn off in Settings.</Text>
          </TouchableOpacity>
        )}

        <View style={[styles.hero, {height: HERO_HEIGHT * scale}]}>
          {RINGS.map((d, i) => (
            <View
              key={d}
              style={[
                styles.ring,
                {
                  width: d * scale,
                  height: d * scale,
                  borderRadius: (d * scale) / 2,
                  borderColor: i === RINGS.length - 1 ? signal.teal : signal.ring,
                },
              ]}
            />
          ))}
          <View style={styles.heroCentre}>
            <Text style={styles.overline}>CHANNEL</Text>
            {editingChannel ? (
              <TextInput
                style={styles.channelInput}
                value={channel}
                onChangeText={t => setChannel(t.toUpperCase().replace(/\s/g, ''))}
                autoCapitalize="characters"
                autoCorrect={false}
                autoFocus
                maxLength={30}
                returnKeyType="done"
                onSubmitEditing={() => setEditingChannel(false)}
                onBlur={() => setEditingChannel(false)}
                selectionColor={signal.teal}
              />
            ) : (
              <TouchableOpacity onPress={() => setEditingChannel(true)} accessibilityLabel={`Channel ${channel}, tap to edit`}>
                <Text style={styles.channel} numberOfLines={1} adjustsFontSizeToFit>
                  {head || ' '}
                </Text>
                {tail !== '' && <Text style={[styles.channel, styles.channelTail]}>{tail}</Text>}
              </TouchableOpacity>
            )}
            {!validChannel && <Text style={styles.invalid}>Letters, digits and "-" only, 30 at most</Text>}
          </View>
        </View>

        <View style={styles.favorites}>
          {favorites.slice(0, VISIBLE_FAVORITES).map(f => (
            <TouchableOpacity key={f} style={styles.pill} onPress={() => setChannel(f)}>
              <Text style={[styles.pillText, f === channel && styles.pillActive]}>{f}</Text>
            </TouchableOpacity>
          ))}
          <TouchableOpacity style={styles.ghostPill} onPress={() => setManaging(true)} accessibilityLabel="Edit favourite channels">
            <Text style={styles.ghostText}>EDIT</Text>
          </TouchableOpacity>
        </View>

        <View style={styles.spacer} />

        {editingName ? (
          <TextInput
            style={styles.nameInput}
            value={pilotName}
            onChangeText={setPilotName}
            placeholder="Your name"
            placeholderTextColor={signal.textDim}
            autoCapitalize="words"
            autoFocus
            returnKeyType="done"
            onSubmitEditing={() => setEditingName(false)}
            onBlur={() => setEditingName(false)}
            selectionColor={signal.teal}
          />
        ) : (
          <TouchableOpacity onPress={() => setEditingName(true)} accessibilityLabel="Your name, tap to edit">
            <Text style={styles.ridingAs}>
              Riding as <Text style={styles.name}>{pilotName.trim() || 'tap to set your name'}</Text>
            </Text>
          </TouchableOpacity>
        )}

        <TouchableOpacity
          style={[styles.join, {marginBottom: Math.max(36, insets.bottom + 12)}, !canJoin && styles.joinDisabled]}
          onPress={handleJoin}
          disabled={!canJoin || isJoining}
          activeOpacity={0.8}>
          <Text style={styles.joinText}>{isJoining ? 'CONNECTING…' : 'JOIN'}</Text>
        </TouchableOpacity>

        <Modal visible={managing} transparent animationType="slide" onRequestClose={() => setManaging(false)}>
          <View style={styles.modalRoot}>
            <TouchableOpacity style={StyleSheet.absoluteFill} activeOpacity={1} onPress={() => setManaging(false)} />
            <View style={[styles.manage, {paddingBottom: insets.bottom + 20}]}>
              <Text style={styles.manageTitle}>FAVOURITES</Text>
              <TouchableOpacity style={styles.manageRow} onPress={toggleFavorite} disabled={!validChannel}>
                <Text style={[styles.manageAction, !validChannel && styles.manageDisabled]}>
                  {isFavorite ? `REMOVE ${channel}` : `SAVE ${channel}`}
                </Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.manageRow} onPress={() => setChannel(generateChannelName())}>
                <Text style={styles.manageAction}>RANDOM CHANNEL</Text>
              </TouchableOpacity>
              <ScrollView style={styles.manageList}>
                {favorites.map(f => (
                  <View key={f} style={styles.manageRow}>
                    <TouchableOpacity
                      style={styles.manageName}
                      onPress={() => {
                        setChannel(f);
                        setManaging(false);
                      }}>
                      <Text style={styles.manageNameText}>{f}</Text>
                    </TouchableOpacity>
                    <TouchableOpacity onPress={() => saveFavorites(favorites.filter(x => x !== f))} hitSlop={10}>
                      <Text style={styles.remove}>REMOVE</Text>
                    </TouchableOpacity>
                  </View>
                ))}
              </ScrollView>
              <TouchableOpacity style={styles.done} onPress={() => setManaging(false)}>
                <Text style={styles.doneText}>DONE</Text>
              </TouchableOpacity>
            </View>
          </View>
        </Modal>
      </KeyboardAvoidingView>
    </TouchableWithoutFeedback>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: signal.bg,
  },
  topBar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 24,
    paddingTop: 16,
  },
  logo: {
    color: signal.text,
    ...condensed(16, 700, 3),
  },
  settings: {
    color: signal.textMuted,
    ...plain(14, 600),
  },
  demo: {
    color: signal.teal,
    textAlign: 'center',
    paddingHorizontal: 24,
    marginTop: 8,
    ...plain(13, 600),
  },
  hero: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  ring: {
    position: 'absolute',
    borderWidth: 2,
  },
  heroCentre: {
    alignItems: 'center',
    maxWidth: 220,
  },
  overline: {
    color: signal.teal,
    ...condensed(12, 600, 3),
  },
  channel: {
    color: signal.text,
    textAlign: 'center',
    lineHeight: 42,
    ...condensed(40, 800),
  },
  channelTail: {
    color: signal.teal,
  },
  channelInput: {
    color: signal.text,
    textAlign: 'center',
    minWidth: 200,
    borderBottomWidth: 2,
    borderBottomColor: signal.teal,
    paddingVertical: 4,
    ...condensed(34, 800),
  },
  invalid: {
    color: signal.red,
    marginTop: 6,
    textAlign: 'center',
    ...plain(12, 600),
  },
  favorites: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    gap: 10,
    paddingHorizontal: 24,
  },
  pill: {
    backgroundColor: signal.surfaceAlt,
    borderRadius: 18,
    paddingVertical: 8,
    paddingHorizontal: 14,
  },
  pillText: {
    color: signal.text,
    ...condensed(15, 700, 1),
  },
  pillActive: {
    color: signal.teal,
  },
  ghostPill: {
    borderWidth: 1.5,
    borderColor: signal.outline,
    borderRadius: 18,
    paddingVertical: 7,
    paddingHorizontal: 14,
  },
  ghostText: {
    color: signal.textMuted,
    ...condensed(15, 700, 1),
  },
  spacer: {
    flex: 1,
  },
  ridingAs: {
    color: signal.textMuted,
    textAlign: 'center',
    paddingBottom: 12,
    ...plain(14, 600),
  },
  name: {
    color: signal.text,
  },
  nameInput: {
    color: signal.text,
    textAlign: 'center',
    marginHorizontal: 60,
    marginBottom: 12,
    paddingVertical: 6,
    borderBottomWidth: 2,
    borderBottomColor: signal.teal,
    ...plain(16, 600),
  },
  join: {
    marginHorizontal: 20,
    height: 72,
    borderRadius: 36,
    backgroundColor: signal.teal,
    alignItems: 'center',
    justifyContent: 'center',
  },
  joinDisabled: {
    opacity: 0.35,
  },
  joinText: {
    color: signal.onAccent,
    ...condensed(26, 800, 2),
  },
  modalRoot: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(0, 0, 0, 0.45)',
  },
  manage: {
    maxHeight: '80%',
    backgroundColor: signal.surface,
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    paddingTop: 18,
    paddingHorizontal: 20,
  },
  manageTitle: {
    color: signal.textMuted,
    marginBottom: 6,
    ...condensed(12, 700, 2),
  },
  manageRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: signal.surfaceAlt,
  },
  manageAction: {
    color: signal.teal,
    ...condensed(18, 800, 1),
  },
  manageDisabled: {
    opacity: 0.35,
  },
  manageList: {
    flexGrow: 0,
  },
  manageName: {
    flex: 1,
  },
  manageNameText: {
    color: signal.text,
    ...condensed(18, 800, 1),
  },
  remove: {
    color: signal.red,
    ...condensed(14, 700, 1),
  },
  done: {
    alignSelf: 'center',
    paddingVertical: 16,
    paddingHorizontal: 30,
  },
  doneText: {
    color: signal.text,
    ...condensed(16, 800, 2),
  },
});
