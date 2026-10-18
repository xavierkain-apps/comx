import React, {useEffect, useRef} from 'react';
import {Animated, Easing, StyleSheet, View} from 'react-native';
import {nextRotation} from '../../radar/radar';

interface ArrowProps {
  /** Degrees clockwise from the top of the screen. */
  angle: number;
  color: string;
  /** The colour behind the arrow: it paints the notch of the shape. */
  backColor: string;
  width?: number;
  height?: number;
}

/**
 * The ComX arrow, polygon(50% 0, 100% 100%, 50% 75%, 0 100%), without SVG: a
 * border-drawn triangle with a flat triangle in the background colour cut out
 * of its base. Turns the short way in 300 ms, easing out.
 */
export function Arrow({angle, color, backColor, width = 20, height = 22}: ArrowProps) {
  const rotation = useRef(new Animated.Value(angle)).current;
  const shown = useRef(angle);

  useEffect(() => {
    const target = nextRotation(shown.current, angle);
    shown.current = target;
    Animated.timing(rotation, {
      toValue: target,
      duration: 300,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
  }, [angle, rotation]);

  const rotate = rotation.interpolate({
    inputRange: [-360, 360],
    outputRange: ['-360deg', '360deg'],
    extrapolate: 'extend',
  });
  const half = width / 2;

  return (
    <Animated.View style={{width, height, transform: [{rotate}]}}>
      <View
        style={[styles.triangle, {borderLeftWidth: half, borderRightWidth: half, borderBottomWidth: height, borderBottomColor: color}]}
      />
      <View
        style={[
          styles.triangle,
          styles.notch,
          {borderLeftWidth: half, borderRightWidth: half, borderBottomWidth: height * 0.25, borderBottomColor: backColor},
        ]}
      />
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  triangle: {
    width: 0,
    height: 0,
    borderLeftColor: 'transparent',
    borderRightColor: 'transparent',
  },
  notch: {
    position: 'absolute',
    left: 0,
    bottom: 0,
  },
});
