import React, {useState, useEffect, useCallback} from 'react';
import {View, Text, TextInput, TouchableOpacity, FlatList, StyleSheet, Alert, Platform, PermissionsAndroid, StatusBar, Keyboard, TouchableWithoutFeedback} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {useUser} from '../contexts/UserContext';
import {generateChannelName, isValidChannelName} from '../utils/channelGenerator';
import {useAgoraContext} from '../contexts/AgoraContext';
import {colors as defaultColors, fonts, spacing, radius} from '../theme';
import {useTheme} from '../contexts/ThemeContext';
import {APP_VERSION} from '../version';
import {appLog} from '../utils/logger';
import {useRide} from '../contexts/RideContext';

const FAVORITES_KEY = '@soarx_favorite_channels';
const DEFAULT_CHANNEL = 'TARIFA-01';

interface HomeScreenProps {
  onJoined: () => void;
  onSettings: () => void;
}

export function HomeScreen({onJoined, onSettings}: HomeScreenProps) {
  const {pilotName, setPilotName} = useUser();
  const {joinChannel} = useAgoraContext();
  const {colors, mode, toggleTheme} = useTheme();
  const {demo} = useRide();
  const [channel, setChannel] = useState(DEFAULT_CHANNEL);
  const [isJoining, setIsJoining] = useState(false);
  const [favorites, setFavorites] = useState<string[]>([]);

  const canJoin = pilotName.trim().length > 0 && isValidChannelName(channel);

  useEffect(() => {
    AsyncStorage.getItem(FAVORITES_KEY).then(saved => {
      if (saved) {
        setFavorites(JSON.parse(saved));
      }
    });
  }, []);

  const saveFavorites = useCallback((newFavs: string[]) => {
    setFavorites(newFavs);
    AsyncStorage.setItem(FAVORITES_KEY, JSON.stringify(newFavs));
  }, []);

  const toggleFavorite = useCallback(() => {
    const name = channel.trim().toUpperCase();
    if (!name) return;
    if (favorites.includes(name)) {
      saveFavorites(favorites.filter(f => f !== name));
    } else {
      saveFavorites([name, ...favorites]);
    }
  }, [channel, favorites, saveFavorites]);

  const isFavorite = favorites.includes(channel.trim().toUpperCase());

  const handleGenerateChannel = () => { setChannel(generateChannelName()); };

  const requestMicPermission = async (): Promise<boolean> => {
    if (Platform.OS !== 'android') return true;

    const granted = await PermissionsAndroid.request(
      PermissionsAndroid.PERMISSIONS.RECORD_AUDIO,
      { title: 'Microphone Permission', message: 'ComX needs microphone access to talk with your group.', buttonPositive: 'Allow' },
    );
    if (granted !== PermissionsAndroid.RESULTS.GRANTED) return false;

    // Android 13+ suppresses the foreground-service notification without this.
    // Not being able to show it is not a reason to block the flight.
    if (Number(Platform.Version) >= 33) {
      try {
        await PermissionsAndroid.request(
          PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS,
          { title: 'Notifications', message: 'Lets ComX show the group status while you ride.', buttonPositive: 'Allow' },
        );
      } catch {}
    }
    return true;
  };

  const handleJoin = async () => {
    if (!canJoin || isJoining) return;
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
      Alert.alert(
        'Connection Failed',
        'Could not join the channel. Check your network coverage and try again.',
      );
    } finally {
      setIsJoining(false);
    }
  };

  return (
    <TouchableWithoutFeedback onPress={Keyboard.dismiss} accessible={false}>
    <View style={[styles.container, {backgroundColor: colors.bg}]}>
      <StatusBar barStyle={colors.statusBar} backgroundColor={colors.bg} />

      <TouchableOpacity
        style={[styles.themeToggle, {backgroundColor: colors.bgCard, borderColor: defaultColors.cardBorder}]}
        onPress={toggleTheme}
        activeOpacity={0.7}>
        <Text style={styles.themeToggleIcon}>{mode === 'dark' ? '\u2600\uFE0F' : '\uD83C\uDF19'}</Text>
      </TouchableOpacity>

      <View style={styles.titleBlock}>
        <Text style={[styles.title, {color: colors.text}]}>
          SOAR
          <Text style={[styles.titleX, {color: colors.primary, textShadowColor: defaultColors.primaryGlow}]}>X</Text>
        </Text>
        <Text style={[styles.subtitle, {color: colors.primary}]}>VOICE</Text>
      </View>

      {demo && (
        <TouchableOpacity onPress={onSettings} activeOpacity={0.7}>
          <Text style={[styles.demoBanner, {color: colors.primary, borderColor: colors.primary}]}>
            Demo riders on: open ComX on your watch. Turn off in Settings.
          </Text>
        </TouchableOpacity>
      )}

      <View style={[styles.card, {backgroundColor: colors.bgCard, borderColor: defaultColors.cardBorder}]}>
        <View style={styles.fieldBlock}>
          <Text style={[styles.label, {color: colors.textSecondary}]}>PILOT NAME</Text>
          <TextInput
            style={[styles.input, {backgroundColor: colors.bgInput, borderColor: colors.cardBorder, color: colors.text}]}
            value={pilotName}
            onChangeText={setPilotName}
            placeholder="Your name"
            placeholderTextColor={colors.textDim}
            autoCapitalize="words"
            returnKeyType="next"
          />
        </View>

        <View style={styles.fieldBlock}>
          <Text style={[styles.label, {color: colors.textSecondary}]}>CHANNEL</Text>
          <View style={styles.channelRow}>
            <TextInput
              style={[styles.input, styles.channelInput, {backgroundColor: colors.bgInput, borderColor: colors.cardBorder, color: colors.text}]}
              value={channel}
              onChangeText={text => setChannel(text.toUpperCase())}
              placeholder="TARIFA-01"
              placeholderTextColor={colors.textDim}
              autoCapitalize="characters"
              maxLength={30}
              returnKeyType="done"
            />
            <TouchableOpacity
              style={[styles.iconButton, {backgroundColor: colors.primaryLight, borderColor: colors.primaryBorder}]}
              onPress={toggleFavorite}
              activeOpacity={0.7}>
              <Text style={[styles.iconButtonText, {color: colors.primary}, isFavorite && styles.iconButtonTextActive]}>
                {isFavorite ? '\u2605' : '\u2606'}
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.iconButton, {backgroundColor: colors.primaryLight, borderColor: colors.primaryBorder}]}
              onPress={handleGenerateChannel}
              activeOpacity={0.7}>
              <Text style={[styles.iconButtonText, {color: colors.primary}]}>{'\uD83C\uDFB2'}</Text>
            </TouchableOpacity>
          </View>
          <Text style={[styles.hint, {color: colors.textMuted}]}>Share this code with your group</Text>
        </View>
      </View>

      {favorites.length > 0 && (
        <View style={styles.favoritesBlock}>
          <Text style={[styles.favoritesLabel, {color: colors.textSecondary}]}>FAVORITES</Text>
          <FlatList
            data={favorites}
            horizontal
            keyExtractor={item => item}
            showsHorizontalScrollIndicator={false}
            renderItem={({item}) => (
              <TouchableOpacity
                style={[
                  styles.favChip,
                  {backgroundColor: colors.primaryLight, borderColor: colors.primaryBorder},
                  item === channel && {backgroundColor: colors.primary, borderColor: colors.primary},
                ]}
                onPress={() => setChannel(item)}
                activeOpacity={0.7}>
                <Text style={[
                  styles.favChipText,
                  {color: colors.primary},
                  item === channel && {color: colors.white},
                ]}>{item}</Text>
              </TouchableOpacity>
            )}
          />
        </View>
      )}

      <View style={styles.spacer} />

      <TouchableOpacity
        style={[styles.joinButton, !canJoin && styles.joinButtonDisabled]}
        onPress={handleJoin}
        disabled={!canJoin || isJoining}
        activeOpacity={0.8}>
        <Text style={styles.joinText}>{isJoining ? 'Connecting...' : 'Join group'}</Text>
      </TouchableOpacity>

      <TouchableOpacity style={styles.bleButton} onPress={onSettings} activeOpacity={0.7}>
        <Text style={[styles.bleButtonText, {color: colors.textSecondary}]}>Settings</Text>
      </TouchableOpacity>

      <Text style={[styles.version, {color: colors.textDim}]}>v{APP_VERSION}</Text>
    </View>
    </TouchableWithoutFeedback>
  );
}

const styles = StyleSheet.create({
  demoBanner: {
    borderWidth: 1,
    borderRadius: radius.md,
    padding: spacing.sm,
    marginBottom: spacing.md,
    textAlign: 'center',
    fontSize: 13,
  },
  container: {
    flex: 1,
    backgroundColor: defaultColors.bg,
    paddingHorizontal: spacing.xxl,
    paddingTop: spacing.xxxl + 20,
    paddingBottom: spacing.xxl,
  },

  // --- Theme toggle ---
  themeToggle: {
    position: 'absolute',
    top: spacing.xxxl + 10,
    right: spacing.xxl,
    width: 40,
    height: 40,
    borderRadius: radius.full,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 10,
  },
  themeToggleIcon: {
    fontSize: 18,
  },

  // --- Title / Logo ---
  titleBlock: {
    alignItems: 'center',
    marginBottom: 40,
  },
  title: {
    fontSize: 44,
    fontWeight: '800',
    letterSpacing: 4,
    color: defaultColors.text,
  },
  titleX: {
    color: defaultColors.primary,
    textShadowColor: defaultColors.primaryGlow,
    textShadowOffset: {width: 0, height: 0},
    textShadowRadius: 18,
  },
  subtitle: {
    fontSize: 14,
    color: defaultColors.primary,
    marginTop: 2,
    letterSpacing: 8,
    fontWeight: '600',
  },

  // --- Card wrapper ---
  card: {
    backgroundColor: defaultColors.bgCard,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.06)',
    padding: spacing.xl,
    marginBottom: spacing.lg,
  },

  // --- Fields ---
  fieldBlock: {
    marginBottom: spacing.lg,
  },
  label: {
    fontSize: fonts.label,
    color: defaultColors.textSecondary,
    letterSpacing: 1.5,
    fontWeight: '600',
    marginBottom: spacing.sm,
  },
  input: {
    backgroundColor: defaultColors.bgInput,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.06)',
    borderRadius: radius.md,
    padding: spacing.lg,
    fontSize: fonts.input,
    color: defaultColors.text,
    fontWeight: '500',
  },
  channelRow: {
    flexDirection: 'row',
    gap: 10,
  },
  channelInput: {
    flex: 1,
  },
  iconButton: {
    backgroundColor: defaultColors.primaryLight,
    borderWidth: 1,
    borderColor: defaultColors.primaryBorder,
    borderRadius: radius.md,
    padding: spacing.lg,
    alignItems: 'center',
    justifyContent: 'center',
    minWidth: 52,
  },
  iconButtonText: {
    fontSize: 20,
    color: defaultColors.primary,
  },
  iconButtonTextActive: {
    color: defaultColors.primary,
    textShadowColor: defaultColors.primaryGlow,
    textShadowOffset: {width: 0, height: 0},
    textShadowRadius: 8,
  },
  hint: {
    fontSize: fonts.small,
    color: defaultColors.textMuted,
    marginTop: spacing.sm,
  },

  // --- Favorites ---
  favoritesBlock: {
    marginBottom: spacing.md,
  },
  favoritesLabel: {
    fontSize: fonts.label,
    color: defaultColors.textSecondary,
    letterSpacing: 1.5,
    fontWeight: '600',
    marginBottom: spacing.sm,
  },
  favChip: {
    backgroundColor: defaultColors.primaryLight,
    borderWidth: 1,
    borderColor: defaultColors.primaryBorder,
    borderRadius: radius.full,
    paddingHorizontal: 16,
    paddingVertical: 8,
    marginRight: 8,
  },
  favChipActive: {
    backgroundColor: defaultColors.primary,
    borderColor: defaultColors.primary,
  },
  favChipText: {
    fontSize: fonts.sm,
    fontWeight: '600',
    color: defaultColors.primary,
  },
  favChipTextActive: {
    color: defaultColors.white,
  },

  // --- Bottom area ---
  spacer: {
    flex: 1,
  },
  joinButton: {
    backgroundColor: defaultColors.primary,
    borderRadius: radius.lg,
    padding: spacing.xl,
    alignItems: 'center',
    shadowColor: defaultColors.primary,
    shadowOffset: {width: 0, height: 6},
    shadowOpacity: 0.45,
    shadowRadius: 16,
    elevation: 8,
  },
  joinButtonDisabled: {
    opacity: 0.35,
    shadowOpacity: 0,
    elevation: 0,
  },
  joinText: {
    fontSize: fonts.button,
    fontWeight: '700',
    color: defaultColors.white,
    letterSpacing: 0.5,
  },
  bleButton: {
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.md,
    alignSelf: 'center',
    marginTop: spacing.md,
  },
  bleButtonText: {
    color: defaultColors.textSecondary,
    fontSize: 14,
    fontWeight: '500',
    textDecorationLine: 'underline',
  },
  version: {
    textAlign: 'center',
    marginTop: spacing.lg,
    fontSize: fonts.xs,
    color: defaultColors.textDim,
  },
});
