import React from 'react';
import {StyleSheet, Text, TouchableOpacity, View} from 'react-native';
import {RiderView} from '../../ride/protocol';
import {formatDistance} from '../../utils/geo';
import {condensed, plain, signal} from '../../theme';
import {Arrow} from './Arrow';

interface RiderRowProps {
  rider: RiderView;
  /** True bearing at the top of the screen. */
  heading: number;
  /** While a memo records, a tap picks this rider as its recipient. */
  onPress?: () => void;
  /** This rider is the recipient of the memo being recorded. */
  selected?: boolean;
}

/**
 * A sheet row: arrow, name, distance. Red in SOS, teal when picked as the
 * memo recipient, yellow while speaking.
 */
export function RiderRow({rider, heading, onPress, selected = false}: RiderRowProps) {
  const located = rider.dist !== null && rider.brg !== null;
  const fill = rider.sos ? signal.red : selected ? signal.teal : rider.speaking ? signal.yellow : null;
  const ink = fill === null || rider.sos ? signal.text : signal.onAccent;
  const arrowColor = rider.sos ? signal.text : fill !== null ? signal.onAccent : signal.teal;
  return (
    <TouchableOpacity
      disabled={!onPress}
      onPress={onPress}
      activeOpacity={0.6}
      accessibilityRole={onPress ? 'button' : undefined}
      accessibilityState={{selected}}
      accessibilityLabel={`${rider.name}, ${located ? formatDistance(rider.dist) : 'no GPS'}${rider.sos ? ', SOS' : ''}${onPress ? (selected ? ', memo recipient, tap again for the group' : ', tap to send the memo to this rider') : ''}`}
      style={[
        styles.row,
        fill !== null && {backgroundColor: fill},
        onPress !== undefined && styles.target,
        !located && !selected && styles.noGps,
        located && rider.stale && !selected && styles.stale,
      ]}>
      {located ? (
        <Arrow angle={(rider.brg as number) - heading} color={arrowColor} backColor={fill ?? signal.surface} />
      ) : (
        <View style={[styles.hollow, {borderColor: fill === null ? signal.textMuted : ink}]} />
      )}
      <Text style={[styles.name, {color: ink}]} numberOfLines={1}>
        {rider.name}
      </Text>
      {rider.sos && (
        <View style={styles.sosChip}>
          <Text style={styles.sosText}>SOS</Text>
        </View>
      )}
      {located ? (
        <Text style={[styles.distance, {color: ink}]}>{formatDistance(rider.dist)}</Text>
      ) : (
        <Text style={[styles.noGpsText, {color: ink}]}>No GPS</Text>
      )}
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  row: {
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 14,
    borderWidth: 1.5,
    borderColor: 'transparent',
  },
  target: {
    borderColor: signal.teal,
  },
  noGps: {
    opacity: 0.45,
  },
  stale: {
    opacity: 0.6,
  },
  hollow: {
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 2,
  },
  name: {
    flex: 1,
    ...condensed(20, 800),
  },
  sosChip: {
    backgroundColor: signal.text,
    borderRadius: 10,
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  sosText: {
    color: signal.red,
    ...condensed(14, 800, 1),
  },
  distance: {
    ...condensed(22, 800),
  },
  noGpsText: {
    ...plain(15, 700),
  },
});
