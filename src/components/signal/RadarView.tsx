import React, {memo, useMemo} from 'react';
import {StyleSheet, Text, View} from 'react-native';
import {RiderView} from '../../ride/protocol';
import {Point, initials, layoutRadar, point, ringDistance, shortDistance} from '../../radar/radar';
import {condensed, signal} from '../../theme';
import {Arrow} from './Arrow';

/** Badge diameter on the phone (the watch uses 34). */
export const BADGE = 44;
/** SOS badges are this much bigger. */
const SOS_GROWTH = 6;
/** Halo around a speaking badge (box-shadow 0 0 0 8px in the handoff). */
const HALO = 8;

interface RadarViewProps {
  riders: RiderView[];
  /** True bearing at the top of the screen (0 = north up). */
  heading: number;
  /** My course over ground, degrees true, or null when not moving. */
  myCourse: number | null;
  width: number;
  height: number;
}

/** Every rider on one radar, me in the centre (watch OverviewPage). */
export const RadarView = memo(function RadarView({riders, heading, myCourse, width, height}: RadarViewProps) {
  const layout = useMemo(() => layoutRadar(riders, width, height, heading, BADGE), [riders, width, height, heading]);
  const byUid = useMemo(() => new Map(riders.map(r => [r.uid, r])), [riders]);
  const {centre, radius} = layout;
  return (
    <View style={{width, height}} pointerEvents="none">
      <Ring centre={centre} radius={radius} label={ringDistance(layout.farthest)} />
      {layout.innerRadius !== null && (
        <Ring centre={centre} radius={layout.innerRadius} label={ringDistance(layout.inner)} />
      )}
      <Text style={[styles.north, {left: layout.north.x - 10, top: layout.north.y - 10}]}>N</Text>
      <View style={[styles.me, {left: centre.x - 10, top: centre.y - 11}]}>
        <Arrow angle={(myCourse ?? heading) - heading} color={signal.text} backColor={signal.bg} />
      </View>
      {layout.spots.map(s => {
        const rider = byUid.get(s.uid);
        return rider ? <Badge key={s.uid} rider={rider} x={s.x} y={s.y} /> : null;
      })}
    </View>
  );
});

function Ring({centre, radius, label}: {centre: Point; radius: number; label: string}) {
  // Label at the bottom right of the ring, where N rarely is.
  const at = point(centre, radius, 135, 1);
  return (
    <>
      <View
        style={[
          styles.ring,
          {left: centre.x - radius, top: centre.y - radius, width: radius * 2, height: radius * 2, borderRadius: radius},
        ]}
      />
      <Text style={[styles.ringLabel, {left: at.x - 30, top: at.y - 8}]}>{label}</Text>
    </>
  );
}

interface BadgeProps {
  rider: RiderView;
  x: number;
  y: number;
}

/** Riders are rebuilt every tick, so compare only what a badge draws. */
function sameBadge(a: BadgeProps, b: BadgeProps): boolean {
  const r = a.rider;
  const s = b.rider;
  return (
    a.x === b.x &&
    a.y === b.y &&
    r.uid === s.uid &&
    r.name === s.name &&
    r.sos === s.sos &&
    r.speaking === s.speaking &&
    r.stale === s.stale &&
    shortDistance(r.dist) === shortDistance(s.dist)
  );
}

/** Takes x and y (not a Point) so the memo holds across layouts that keep a badge in place. */
const Badge = memo(function Badge({rider, x, y}: BadgeProps) {
  const d = rider.sos ? BADGE + SOS_GROWTH : BADGE;
  const fill = rider.sos ? signal.red : rider.speaking ? signal.yellow : signal.teal;
  const halo = rider.speaking && !rider.sos;
  return (
    <View style={[styles.badgeBox, {left: x - d / 2 - HALO, top: y - d / 2 - HALO, opacity: rider.stale ? 0.4 : 1}]}>
      <View
        style={[
          styles.halo,
          {width: d + HALO * 2, height: d + HALO * 2, borderRadius: d / 2 + HALO},
          halo && styles.haloOn,
        ]}>
        <View style={[styles.badge, {width: d, height: d, borderRadius: d / 2, backgroundColor: fill}]}>
          <Text
            style={[styles.initials, {color: rider.sos ? signal.text : signal.onAccent}]}
            numberOfLines={1}
            adjustsFontSizeToFit>
            {initials(rider.name)}
          </Text>
        </View>
      </View>
      {/* Decision 6: distance under the badge, as on the watch. */}
      <Text style={styles.badgeDistance}>{shortDistance(rider.dist)}</Text>
    </View>
  );
}, sameBadge);

const styles = StyleSheet.create({
  ring: {
    position: 'absolute',
    borderWidth: 2,
    borderColor: signal.ring,
  },
  ringLabel: {
    position: 'absolute',
    width: 60,
    textAlign: 'center',
    color: signal.textDim,
    backgroundColor: signal.bg,
    ...condensed(12, 600),
  },
  north: {
    position: 'absolute',
    width: 20,
    textAlign: 'center',
    color: signal.red,
    ...condensed(15, 800),
  },
  me: {
    position: 'absolute',
    width: 20,
    height: 22,
  },
  badgeBox: {
    position: 'absolute',
    alignItems: 'center',
  },
  halo: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  haloOn: {
    backgroundColor: signal.yellowHalo,
  },
  badge: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  initials: {
    ...condensed(17, 800),
  },
  badgeDistance: {
    marginTop: -6,
    color: signal.text,
    ...condensed(12, 700),
  },
});
