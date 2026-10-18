import React from 'react';
import {StyleSheet, Text, TouchableOpacity, View} from 'react-native';
import {condensed, plain, signal} from '../../theme';

interface BannerProps {
  text: string;
  /** Amber for warnings, red while a memo records. */
  tone?: 'amber' | 'red';
  action?: {label: string; onPress: () => void};
}

/** Full-width pill under the top overlay (inactivity, call, location, memo). */
export function Banner({text, tone = 'amber', action}: BannerProps) {
  const bg = tone === 'red' ? signal.red : signal.amber;
  const ink = tone === 'red' ? signal.text : signal.onAccent;
  return (
    <View style={[styles.pill, {backgroundColor: bg}]} accessibilityRole="alert">
      <Text style={[styles.text, {color: ink}]}>{text}</Text>
      {action && (
        <TouchableOpacity style={[styles.action, {backgroundColor: ink}]} onPress={action.onPress} hitSlop={8} accessibilityRole="button">
          <Text style={[styles.actionText, {color: bg}]}>{action.label}</Text>
        </TouchableOpacity>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    borderRadius: 9999,
    paddingVertical: 10,
    paddingLeft: 18,
    paddingRight: 10,
  },
  text: {
    flex: 1,
    ...plain(14, 700),
  },
  action: {
    borderRadius: 9999,
    paddingVertical: 6,
    paddingHorizontal: 14,
  },
  actionText: {
    ...condensed(15, 800, 1),
  },
});
