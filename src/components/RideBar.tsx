import React, {useEffect, useState} from 'react';
import {View, Text, TouchableOpacity, ScrollView, StyleSheet, Vibration} from 'react-native';
import {useTheme} from '../contexts/ThemeContext';
import {useRide} from '../contexts/RideContext';
import {QUICK_MESSAGES} from '../ride/protocol';
import {spacing, radius, fonts} from '../theme';

/** Messages stay on screen this long. */
const FEED_TTL_MS = 60_000;

/** Quick messages, SOS and the latest messages of the channel. */
export function RideBar() {
  const {colors} = useTheme();
  const {messages, mySos, sendQuickMessage, setSos, locationDenied} = useRide();
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 5000);
    return () => clearInterval(timer);
  }, []);

  const recent = messages.filter(m => now - m.t < FEED_TTL_MS).slice(0, 3);

  return (
    <View style={styles.container}>
      {locationDenied && (
        <Text style={[styles.notice, {color: colors.amber}]}>
          Location is off — others can't see where you are.
        </Text>
      )}

      {recent.map(m => (
        <View
          key={m.key}
          style={[
            styles.message,
            {backgroundColor: m.id === 'sos' && m.uid !== null ? colors.redLight : colors.bgCard, borderColor: colors.cardBorder},
          ]}>
          <Text style={[styles.messageFrom, {color: colors.textSecondary}]}>{m.from}</Text>
          <Text style={[styles.messageText, {color: colors.text}]} numberOfLines={1}>
            {m.text}
          </Text>
        </View>
      ))}

      <View style={styles.row}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
          {QUICK_MESSAGES.map(q => (
            <TouchableOpacity
              key={q.id}
              style={[styles.chip, {backgroundColor: colors.bgCard, borderColor: colors.primaryBorder}]}
              onPress={() => sendQuickMessage(q.id)}
              activeOpacity={0.7}>
              <Text style={[styles.chipText, {color: colors.text}]}>{q.text}</Text>
            </TouchableOpacity>
          ))}
        </ScrollView>

        <TouchableOpacity
          style={[styles.sos, {backgroundColor: mySos ? colors.red : colors.redLight, borderColor: colors.red}]}
          onPress={() => mySos && setSos(false)}
          onLongPress={() => {
            if (mySos) return;
            Vibration.vibrate(400);
            setSos(true);
          }}
          delayLongPress={1000}
          activeOpacity={0.7}>
          <Text style={[styles.sosText, {color: mySos ? '#fff' : colors.red}]}>{mySos ? 'Cancel SOS' : 'SOS'}</Text>
          {!mySos && <Text style={[styles.sosHint, {color: colors.red}]}>hold 1 s</Text>}
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    paddingHorizontal: spacing.lg,
    marginBottom: spacing.md,
  },
  notice: {
    fontSize: fonts.label,
    fontWeight: '600',
    textAlign: 'center',
    marginBottom: spacing.sm,
  },
  message: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderRadius: radius.md,
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.md,
    marginBottom: spacing.xs,
  },
  messageFrom: {
    fontSize: fonts.label,
    fontWeight: '700',
    marginRight: spacing.sm,
  },
  messageText: {
    flex: 1,
    fontSize: fonts.sm,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: spacing.xs,
  },
  chips: {
    gap: spacing.sm,
    paddingRight: spacing.sm,
  },
  chip: {
    borderWidth: 1,
    borderRadius: radius.full,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
  },
  chipText: {
    fontSize: fonts.sm,
    fontWeight: '600',
  },
  sos: {
    borderWidth: 2,
    borderRadius: radius.lg,
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.md,
    alignItems: 'center',
    marginLeft: spacing.sm,
  },
  sosText: {
    fontSize: fonts.body,
    fontWeight: '800',
  },
  sosHint: {
    fontSize: 10,
    fontWeight: '600',
  },
});
