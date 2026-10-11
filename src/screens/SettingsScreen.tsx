import React, {useState, useEffect, useCallback} from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  StyleSheet,
  TextInput,
  Platform,
  NativeModules,
  NativeEventEmitter,
  ActivityIndicator,
  Share,
  Switch,
  Alert,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import Sound from 'react-native-sound';
import {fonts, spacing, radius} from '../theme';
import {getLogs, clearLogs} from '../utils/logger';
import {useTheme} from '../contexts/ThemeContext';
import {soundFile} from '../utils/sounds';
import {APP_VERSION} from '../version';
import type {MuteFeedbackMode} from '../hooks/useMute';
import {useWatch, WatchModeSetting} from '../contexts/WatchContext';
import {WatchBridge} from '../services/WatchBridge';

const WATCH_MODES: {value: WatchModeSetting; label: string}[] = [
  {value: 'auto', label: 'Auto'},
  {value: 'on', label: 'On'},
  {value: 'off', label: 'Off'},
];

const PLATFORM_NAMES = {watchos: 'Apple Watch', wearos: 'Wear OS', garmin: 'Garmin'} as const;

const {BLEButtonManager} = NativeModules;
const FEEDBACK_KEY = '@soarx_mute_feedback';

interface SavedButton {
  uuid: string;
  name: string;
  connected: boolean;
}

interface BLEDevice {
  name: string;
  uuid: string;
  rssi: number;
  isNamed?: boolean;
  isITag?: boolean;
}

// Why the radio cannot scan, in words a pilot can act on.
const BLE_REASONS: Record<string, string> = {
  unauthorized:
    'Bluetooth permission was refused. Enable it in iOS Settings > ComX > Bluetooth, then scan again.',
  'bluetooth-off': 'Bluetooth is turned off. Switch it on in Control Centre, then scan again.',
  unsupported: 'This device does not support Bluetooth Low Energy.',
  resetting: 'Bluetooth is restarting — try again in a moment.',
  unknown: 'Waiting for Bluetooth to start up…',
};

interface SettingsScreenProps {
  onDone: () => void;
}

export function SettingsScreen({onDone}: SettingsScreenProps) {
  const {colors} = useTheme();
  const watch = useWatch();

  // --- Debug ---
  const [logText, setLogText] = useState('');

  // --- Voice Announcements ---
  const [ttsEnabled, setTtsEnabled] = useState(true);

  useEffect(() => {
    AsyncStorage.getItem('@soarx_tts_enabled').then(val => {
      if (val !== null) setTtsEnabled(val !== 'false');
    });
  }, []);

  // --- Mute Feedback ---
  const [feedbackMode, setFeedbackMode] = useState<MuteFeedbackMode>('voice');

  useEffect(() => {
    AsyncStorage.getItem(FEEDBACK_KEY).then(val => {
      if (val === 'voice' || val === 'beeps') setFeedbackMode(val);
    });
  }, []);

  const changeFeedbackMode = useCallback((mode: MuteFeedbackMode) => {
    setFeedbackMode(mode);
    AsyncStorage.setItem(FEEDBACK_KEY, mode);
    // Preview sound
    const soundName = soundFile(mode === 'voice' ? 'voice_unmute' : 'beep_double');
    const preview = new Sound(soundName, Sound.MAIN_BUNDLE, (err) => {
      if (!err) preview.play(() => preview.release());
    });
  }, []);

  // --- BLE ---
  const [scanning, setScanning] = useState(false);
  const [devices, setDevices] = useState<BLEDevice[]>([]);
  const [, setConnectedDevice] = useState<string | null>(null);
  const [, setConnectedName] = useState<string | null>(null);
  const [savedDevices, setSavedDevices] = useState<SavedButton[]>([]);
  const [showScan, setShowScan] = useState(false);
  const [bleProblem, setBleProblem] = useState<string | null>(null);

  const refreshSaved = useCallback(() => {
    if (!BLEButtonManager?.getSavedDevices) return;
    BLEButtonManager.getSavedDevices().then(setSavedDevices).catch(() => {});
  }, []);

  useEffect(refreshSaved, [refreshSaved]);

  useEffect(() => {
    if (!BLEButtonManager) return;
    const emitter = new NativeEventEmitter(BLEButtonManager);

    const stateSub = emitter.addListener(
      'onBLEState',
      (s: {ready: boolean; reason: string}) => {
        setBleProblem(s.ready ? null : BLE_REASONS[s.reason] ?? `Bluetooth unavailable (${s.reason})`);
      },
    );

    const foundSub = emitter.addListener('onDeviceFound', (device: BLEDevice) => {
      setDevices(prev => {
        if (prev.some(d => d.uuid === device.uuid)) return prev;
        return [...prev, device];
      });
    });

    const connSub = emitter.addListener('onDeviceConnected', (data: {uuid: string; name: string}) => {
      setConnectedDevice(data.uuid);
      setConnectedName(data.name);
      setScanning(false);
      setShowScan(false);
      refreshSaved();
      if (BLEButtonManager.stopScan) BLEButtonManager.stopScan();
    });

    const discSub = emitter.addListener('onDeviceDisconnected', () => {
      setConnectedDevice(null);
      setConnectedName(null);
      refreshSaved();
    });

    return () => {
      stateSub.remove();
      foundSub.remove();
      connSub.remove();
      discSub.remove();
    };
  }, [refreshSaved]);

  const startScan = useCallback(() => {
    if (!BLEButtonManager) return;
    setDevices([]);
    setBleProblem(null);
    setScanning(true);
    BLEButtonManager.startScan();
    setTimeout(() => {
      setScanning(false);
      if (BLEButtonManager.stopScan) BLEButtonManager.stopScan();
    }, 10000);
  }, []);

  const connectDevice = useCallback((uuid: string) => {
    if (!BLEButtonManager) return;
    BLEButtonManager.connectToDevice(uuid);
  }, []);

  const [renamingUUID, setRenamingUUID] = useState<string | null>(null);
  const [renameText, setRenameText] = useState('');

  const commitRename = useCallback(() => {
    if (!BLEButtonManager?.renameDevice || !renamingUUID) return;
    BLEButtonManager.renameDevice(renamingUUID, renameText);
    setRenamingUUID(null);
    setRenameText('');
    setTimeout(refreshSaved, 150);
  }, [renamingUUID, renameText, refreshSaved]);

  const forgetDevice = useCallback((uuid: string) => {
    if (!BLEButtonManager) return;
    BLEButtonManager.forgetDevice(uuid);
    setTimeout(refreshSaved, 200);
  }, [refreshSaved]);

  return (
    <View style={[styles.container, {backgroundColor: colors.bg}]}>
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}>

        <View style={styles.headerRow}>
          <TouchableOpacity onPress={onDone} activeOpacity={0.7} style={styles.closeButton}>
            <Text style={[styles.closeButtonText, {color: colors.textSecondary}]}>✕</Text>
          </TouchableOpacity>
          <Text style={[styles.title, {color: colors.text}]}>Settings</Text>
          <View style={styles.closeButton} />
        </View>

        {/* --- Mute Feedback Section --- */}
        <Text style={[styles.sectionTitle, {color: colors.textSecondary}]}>MUTE FEEDBACK</Text>
        <View style={[styles.card, {backgroundColor: colors.bgCard, borderColor: colors.cardBorder}]}>
          <Text style={[styles.cardDescription, {color: colors.textSecondary}]}>
            Audio feedback when you mute/unmute (plays in your earpiece)
          </Text>
          <View style={styles.segmentedControl}>
            <TouchableOpacity
              style={[
                styles.segmentButton,
                {borderColor: colors.cardBorder},
                feedbackMode === 'voice' && {backgroundColor: colors.primary, borderColor: colors.primary},
              ]}
              onPress={() => changeFeedbackMode('voice')}
              activeOpacity={0.7}>
              <Text style={[
                styles.segmentText,
                {color: colors.textSecondary},
                feedbackMode === 'voice' && {color: '#FFFFFF'},
              ]}>Voice</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[
                styles.segmentButton,
                {borderColor: colors.cardBorder},
                feedbackMode === 'beeps' && {backgroundColor: colors.primary, borderColor: colors.primary},
              ]}
              onPress={() => changeFeedbackMode('beeps')}
              activeOpacity={0.7}>
              <Text style={[
                styles.segmentText,
                {color: colors.textSecondary},
                feedbackMode === 'beeps' && {color: '#FFFFFF'},
              ]}>Beeps</Text>
            </TouchableOpacity>
          </View>
        </View>

        {/* --- Voice Announcements Section --- */}
        <Text style={[styles.sectionTitle, {color: colors.textSecondary}]}>VOICE ANNOUNCEMENTS</Text>
        <View style={[styles.card, {backgroundColor: colors.bgCard, borderColor: colors.cardBorder}]}>
          <View style={styles.toggleRow}>
            <View style={{flex: 1}}>
              <Text style={[styles.toggleLabel, {color: colors.text}]}>Rider joined / left</Text>
              <Text style={[styles.toggleHint, {color: colors.textMuted}]}>Announce when riders connect or disconnect</Text>
            </View>
            <Switch
              value={ttsEnabled}
              onValueChange={(val) => {
                setTtsEnabled(val);
                AsyncStorage.setItem('@soarx_tts_enabled', String(val));
              }}
              trackColor={{false: colors.cardBorder, true: colors.primary}}
              thumbColor="#FFFFFF"
            />
          </View>
        </View>

        {/* --- Watch Section --- */}
        <Text style={[styles.sectionTitle, {color: colors.textSecondary}]}>WATCH</Text>
        <View style={[styles.card, {backgroundColor: colors.bgCard, borderColor: colors.cardBorder}]}>
          <Text style={[styles.cardDescription, {color: colors.textSecondary}]}>
            Watch mode: talk and listen on your watch while the phone stays in a waterproof pouch. The phone
            mic is turned off. Auto switches it on when a watch with ComX is reachable and no headphones are
            connected.
          </Text>
          <View style={styles.segmentedControl}>
            {WATCH_MODES.map(mode => (
              <TouchableOpacity
                key={mode.value}
                style={[
                  styles.segmentButton,
                  {borderColor: colors.cardBorder},
                  watch.setting === mode.value && {backgroundColor: colors.primary, borderColor: colors.primary},
                ]}
                onPress={() => watch.setSetting(mode.value)}
                activeOpacity={0.7}>
                <Text style={[
                  styles.segmentText,
                  {color: colors.textSecondary},
                  watch.setting === mode.value && {color: '#FFFFFF'},
                ]}>{mode.label}</Text>
              </TouchableOpacity>
            ))}
          </View>
          <Text style={[styles.toggleHint, {color: colors.textMuted, marginTop: spacing.md}]}>
            {!watch.available
              ? 'Watch support is not available in this build.'
              : watch.watches.length === 0
                ? 'No watch found. Install ComX on your watch.'
                : watch.watches
                    .map(w => `${PLATFORM_NAMES[w.platform] ?? w.platform} ${w.name}: ${
                      !w.installed ? 'app not installed' : w.reachable ? 'connected' : 'not reachable'}`)
                    .join('\n')}
          </Text>
          {WatchBridge.canSelectGarmin && (
            <TouchableOpacity
              style={[styles.segmentButton, {borderColor: colors.primary, marginTop: spacing.md}]}
              onPress={() =>
                WatchBridge.selectGarminDevices().catch((e: Error) =>
                  Alert.alert('Garmin', e?.message || 'Could not open Garmin Connect.'),
                )
              }
              activeOpacity={0.7}>
              <Text style={[styles.segmentText, {color: colors.primary}]}>Connect a Garmin watch</Text>
            </TouchableOpacity>
          )}
        </View>

        {/* --- Bluetooth Button Section --- */}
        <Text style={[styles.sectionTitle, {color: colors.textSecondary}]}>BLUETOOTH BUTTON</Text>
        <View style={[styles.card, {backgroundColor: colors.bgCard, borderColor: colors.cardBorder}]}>
          <Text style={[styles.cardDescription, {color: colors.textSecondary}]}>
            Connect a BLE button to toggle mute while riding — works with screen locked
          </Text>

          {savedDevices.length > 0 && !showScan ? (
            <View>
              <Text style={[styles.connectedLabel, {color: colors.textMuted, marginBottom: spacing.sm}]}>
                {savedDevices.length === 1
                  ? 'Paired button'
                  : `${savedDevices.length} paired buttons — whichever is on connects automatically`}
              </Text>

              {savedDevices.map(btn => (
                <View
                  key={btn.uuid}
                  style={[
                    styles.connectedBox,
                    {
                      backgroundColor: btn.connected ? colors.greenLight : colors.bg,
                      borderColor: btn.connected ? colors.green + '66' : colors.cardBorder,
                    },
                  ]}>
                  {renamingUUID === btn.uuid ? (
                    <>
                      <TextInput
                        style={[styles.input, {backgroundColor: colors.bgInput, borderColor: colors.cardBorder, color: colors.text}]}
                        value={renameText}
                        onChangeText={setRenameText}
                        placeholder="e.g. Training wing"
                        placeholderTextColor={colors.textDim}
                        autoFocus
                        returnKeyType="done"
                        onSubmitEditing={commitRename}
                        maxLength={30}
                      />
                      <Text style={[styles.connectedUUID, {color: colors.textMuted}]}>
                        Leave empty to go back to the device name
                      </Text>
                      <View style={styles.connectedButtons}>
                        <TouchableOpacity
                          style={[styles.changeButton, {backgroundColor: colors.primary}]}
                          onPress={commitRename}
                          activeOpacity={0.7}>
                          <Text style={[styles.changeButtonText, {color: '#FFFFFF'}]}>Save</Text>
                        </TouchableOpacity>
                        <TouchableOpacity
                          style={[styles.changeButton, {backgroundColor: colors.cardBorder}]}
                          onPress={() => setRenamingUUID(null)}
                          activeOpacity={0.7}>
                          <Text style={[styles.changeButtonText, {color: colors.textSecondary}]}>Cancel</Text>
                        </TouchableOpacity>
                      </View>
                    </>
                  ) : (
                    <>
                      <Text style={[styles.connectedName, {color: btn.connected ? colors.green : colors.text}]}>
                        {btn.name || 'Saved button'}
                      </Text>
                      <Text style={[styles.connectedUUID, {color: colors.textMuted}]}>
                        {btn.connected ? 'Connected — in use now' : 'Not in range'}
                      </Text>
                      <View style={styles.connectedButtons}>
                        <TouchableOpacity
                          style={[styles.changeButton, {backgroundColor: colors.cardBorder}]}
                          onPress={() => {
                            setRenamingUUID(btn.uuid);
                            setRenameText(btn.name === 'Saved button' ? '' : btn.name);
                          }}
                          activeOpacity={0.7}>
                          <Text style={[styles.changeButtonText, {color: colors.primary}]}>Rename</Text>
                        </TouchableOpacity>
                        <TouchableOpacity
                          style={[styles.forgetButton, {backgroundColor: colors.redLight}]}
                          onPress={() => forgetDevice(btn.uuid)}
                          activeOpacity={0.7}>
                          <Text style={[styles.forgetButtonText, {color: colors.red}]}>Forget</Text>
                        </TouchableOpacity>
                      </View>
                    </>
                  )}
                </View>
              ))}

              <TouchableOpacity
                style={[styles.scanButton, {backgroundColor: colors.primary, marginTop: spacing.sm}]}
                onPress={() => setShowScan(true)}
                activeOpacity={0.7}>
                <Text style={[styles.scanButtonText, {color: colors.bg}]}>Add another button</Text>
              </TouchableOpacity>
            </View>
          ) : (
            <View>
              <TouchableOpacity
                style={[styles.scanButton, {backgroundColor: colors.primary}, scanning && styles.scanButtonActive]}
                onPress={startScan}
                disabled={scanning}
                activeOpacity={0.7}>
                {scanning ? (
                  <View style={styles.scanningRow}>
                    <ActivityIndicator color={colors.bg} size="small" />
                    <Text style={[styles.scanButtonText, {color: colors.bg}]}>  Scanning...</Text>
                  </View>
                ) : (
                  <Text style={[styles.scanButtonText, {color: colors.bg}]}>Scan for BLE Buttons</Text>
                )}
              </TouchableOpacity>

              {bleProblem && (
                <View style={[styles.tipBox, {borderColor: colors.amber, marginTop: spacing.md}]}>
                  <Text style={[styles.tipTitle, {color: colors.amber}]}>Bluetooth unavailable</Text>
                  <Text style={[styles.tipText, {color: colors.textSecondary}]}>{bleProblem}</Text>
                </View>
              )}

              {devices.length > 0 && (
                <View style={styles.deviceList}>
                  {[...devices]
                    .sort((a, b) => Number(b.isITag) - Number(a.isITag) || b.rssi - a.rssi)
                    .map(device => (
                    <TouchableOpacity
                      key={device.uuid}
                      style={[styles.deviceRow, {backgroundColor: colors.bg, borderColor: colors.cardBorder, borderWidth: 1}]}
                      onPress={() => connectDevice(device.uuid)}
                      activeOpacity={0.7}>
                      <View style={styles.deviceInfo}>
                        <Text style={[styles.deviceName, {color: device.isITag ? colors.primary : colors.text}]}>
                          {device.isITag ? '\u2605 ' : ''}{device.name}
                        </Text>
                        <Text style={[styles.deviceUUID, {color: colors.textMuted}]}>
                          {device.isITag ? 'iTag button — tap to connect' : device.uuid.substring(0, 8) + '...'}
                        </Text>
                      </View>
                      <Text style={[styles.deviceRSSI, {color: colors.textMuted}]}>{device.rssi} dBm</Text>
                    </TouchableOpacity>
                  ))}
                </View>
              )}

              {scanning && devices.length === 0 && !bleProblem && (
                <Text style={[styles.scanHint, {color: colors.textMuted}]}>
                  Press the button on your iTag now so it starts advertising...
                </Text>
              )}

              {!scanning && devices.length === 0 && !bleProblem && (
                <Text style={[styles.scanHint, {color: colors.textMuted}]}>
                  Nothing found. Press the iTag button while scanning, and make sure
                  it is not already paired in iOS Settings &gt; Bluetooth.
                </Text>
              )}

              {showScan && (
                <TouchableOpacity
                  style={styles.cancelButton}
                  onPress={() => setShowScan(false)}
                  activeOpacity={0.7}>
                  <Text style={[styles.cancelButtonText, {color: colors.textMuted}]}>Cancel</Text>
                </TouchableOpacity>
              )}
            </View>
          )}

          <View style={[styles.tipBox, {borderColor: colors.cardBorder}]}>
            <Text style={[styles.tipTitle, {color: colors.text}]}>How to pair an iTag</Text>
            <Text style={[styles.tipText, {color: colors.textSecondary}]}>
              1. Do NOT pair it in iOS Settings &gt; Bluetooth — it connects through this app.{'\n'}
              2. Tap Scan above.{'\n'}
              3. Press the button on the iTag so it starts advertising.{'\n'}
              4. Tap it in the list when it appears (marked with a star).
            </Text>
            <Text style={[styles.tipText, {color: colors.textMuted, marginTop: spacing.sm}]}>
              iTag trackers (~7 EUR) are the recommended button. ESP32 boards and any
              BLE device exposing an FFE0/FFE1 service also work.
            </Text>
          </View>
        </View>

        {/* --- About Section --- */}
        <Text style={[styles.sectionTitle, {color: colors.textSecondary}]}>ABOUT</Text>
        <View style={[styles.card, {backgroundColor: colors.bgCard, borderColor: colors.cardBorder}]}>
          <View style={styles.aboutRow}>
            <Text style={[styles.aboutLabel, {color: colors.textSecondary}]}>Version</Text>
            <Text style={[styles.aboutValue, {color: colors.text}]}>{APP_VERSION}</Text>
          </View>
        </View>

        {/* --- Debug Logs Section --- */}
        <Text style={[styles.sectionTitle, {color: colors.textSecondary}]}>DEBUG LOGS</Text>
        <View style={[styles.card, {backgroundColor: colors.bgCard, borderColor: colors.cardBorder}]}>
          <TouchableOpacity
            style={[styles.scanButton, {backgroundColor: colors.primary}]}
            onPress={() => setLogText(getLogs().join('\n') || 'No logs yet')}
            activeOpacity={0.7}>
            <Text style={[styles.scanButtonText, {color: colors.bg}]}>Refresh Logs</Text>
          </TouchableOpacity>
          <View style={{flexDirection: 'row', gap: 8, marginTop: 8}}>
            <TouchableOpacity
              style={[styles.changeButton, {backgroundColor: colors.cardBorder, flex: 1}]}
              onPress={() => {
                const text = getLogs().join('\n');
                Share.share({message: text});
              }}
              activeOpacity={0.7}>
              <Text style={[styles.changeButtonText, {color: colors.primary, textAlign: 'center'}]}>Share Logs</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.changeButton, {backgroundColor: colors.cardBorder, flex: 1}]}
              onPress={() => { clearLogs(); setLogText('Logs cleared'); }}
              activeOpacity={0.7}>
              <Text style={[styles.changeButtonText, {color: colors.primary, textAlign: 'center'}]}>Clear</Text>
            </TouchableOpacity>
          </View>
          {logText ? (
            <ScrollView style={{maxHeight: 300, marginTop: 12}} nestedScrollEnabled>
              <Text style={{color: colors.text, fontSize: 10, fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace'}}>{logText}</Text>
            </ScrollView>
          ) : null}
        </View>

        <TouchableOpacity
          style={[styles.backButton, {backgroundColor: 'rgba(239, 68, 68, 0.10)', borderColor: 'rgba(239, 68, 68, 0.25)'}]}
          onPress={onDone}
          activeOpacity={0.7}>
          <Text style={[styles.backButtonText, {color: '#EF4444'}]}>Back</Text>
        </TouchableOpacity>

      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  scroll: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: spacing.lg,
    paddingTop: 60,
    paddingBottom: spacing.xl,
  },
  title: {
    fontSize: fonts.title,
    fontWeight: '700',
    textAlign: 'center',
  },
  sectionTitle: {
    fontSize: fonts.label,
    fontWeight: '600',
    letterSpacing: 1.5,
    marginBottom: spacing.sm,
    marginTop: spacing.md,
  },
  card: {
    borderRadius: radius.lg,
    borderWidth: 1,
    padding: spacing.lg,
    marginBottom: spacing.md,
  },
  cardDescription: {
    fontSize: 13,
    lineHeight: 20,
    marginBottom: spacing.md,
  },

  // Segmented control
  segmentedControl: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  segmentButton: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: radius.md,
    borderWidth: 1,
    alignItems: 'center',
  },
  segmentText: {
    fontWeight: '600',
    fontSize: 15,
  },

  // BLE
  connectedBox: {
    borderRadius: 12,
    padding: spacing.md,
    marginBottom: spacing.md,
    borderWidth: 1,
  },
  connectedLabel: {
    fontSize: 12,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  connectedName: {
    fontWeight: '700',
    fontSize: 18,
    marginTop: 4,
  },
  connectedUUID: {
    fontSize: 12,
    marginTop: 2,
  },
  input: {
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 15,
    fontWeight: '500',
  },
  connectedButtons: {
    flexDirection: 'row',
    marginTop: spacing.sm,
    gap: spacing.sm,
  },
  changeButton: {
    borderRadius: 8,
    paddingVertical: 8,
    paddingHorizontal: 16,
  },
  changeButtonText: {
    fontSize: 13,
    fontWeight: '600',
  },
  forgetButton: {
    borderRadius: 8,
    paddingVertical: 8,
    paddingHorizontal: 16,
  },
  forgetButtonText: {
    fontSize: 13,
    fontWeight: '600',
  },
  scanButton: {
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
  },
  scanButtonActive: {
    opacity: 0.7,
  },
  scanButtonText: {
    fontWeight: '700',
    fontSize: 15,
  },
  scanningRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  deviceList: {
    marginTop: spacing.sm,
  },
  deviceRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    borderRadius: 10,
    padding: spacing.md,
    marginBottom: spacing.xs,
  },
  deviceInfo: {
    flex: 1,
  },
  deviceName: {
    fontWeight: '600',
    fontSize: 15,
  },
  deviceUUID: {
    fontSize: 11,
    marginTop: 2,
  },
  deviceRSSI: {
    fontSize: 12,
  },
  scanHint: {
    fontSize: 13,
    textAlign: 'center',
    marginTop: spacing.md,
    fontStyle: 'italic',
  },
  cancelButton: {
    alignItems: 'center',
    marginTop: spacing.sm,
    padding: spacing.sm,
  },
  cancelButtonText: {
    fontSize: 14,
  },
  tipBox: {
    borderRadius: 12,
    borderWidth: 1,
    padding: spacing.md,
    marginTop: spacing.md,
  },
  tipTitle: {
    fontWeight: '700',
    fontSize: 15,
    marginBottom: spacing.xs,
  },
  tipText: {
    fontSize: 13,
    lineHeight: 22,
  },

  // About
  toggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  toggleLabel: {
    fontSize: 15,
    fontWeight: '600',
  },
  toggleHint: {
    fontSize: 12,
    marginTop: 2,
  },
  aboutRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  aboutLabel: {
    fontSize: 15,
  },
  aboutValue: {
    fontSize: 15,
    fontWeight: '600',
  },

  // Header
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing.xl,
  },
  closeButton: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  closeButtonText: {
    fontSize: 22,
    fontWeight: '300',
  },

  // Back button
  backButton: {
    paddingVertical: 14,
    alignItems: 'center',
    marginTop: spacing.xl,
    marginBottom: spacing.md,
    marginHorizontal: spacing.lg,
    borderRadius: radius.md,
    borderWidth: 1,
  },
  backButtonText: {
    fontSize: 16,
    fontWeight: '600',
  },
});
