import React, {ReactNode, useCallback, useEffect, useRef, useState} from 'react';
import {Animated, PanResponder, ScrollView, StyleSheet, View} from 'react-native';
import {Detents, HANDLE_HEIGHT, clampSheet, nextDetent, settleDetent} from '../../radar/sheet';
import {signal} from '../../theme';

interface BottomSheetProps {
  detents: Detents;
  /** Padding under the footer (home indicator). */
  bottomPad: number;
  /** Rider rows; they scroll only at the large detent. */
  children: ReactNode;
  /** Always visible at the bottom (the control row). */
  footer: ReactNode;
}

/**
 * The live screen's sheet. Its height animates between three detents
 * (src/radar/sheet.ts); the footer is never pushed off screen. Drag the
 * grabber to move it, tap the grabber to cycle detents.
 */
export function BottomSheet({detents, bottomPad, children, footer}: BottomSheetProps) {
  const height = useRef(new Animated.Value(detents.medium)).current;
  const current = useRef(detents.medium);
  const start = useRef(detents.medium);
  const detentsRef = useRef(detents);
  detentsRef.current = detents;
  const [expanded, setExpanded] = useState(false);

  const settle = useCallback(
    (target: number) => {
      current.current = target;
      setExpanded(target === detentsRef.current.large);
      Animated.spring(height, {toValue: target, useNativeDriver: false, bounciness: 0, speed: 18}).start();
    },
    [height],
  );

  // Screen size changed (rotation, split view): stay on the same detent kind
  useEffect(() => {
    settle(detents.medium);
  }, [detents, settle]);

  const pan = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: (_e, g) => Math.abs(g.dy) > 4,
      onPanResponderGrant: () => {
        start.current = current.current;
      },
      onPanResponderMove: (_e, g) => {
        height.setValue(clampSheet(start.current - g.dy, detentsRef.current));
      },
      onPanResponderRelease: (_e, g) => {
        if (Math.abs(g.dy) < 4) {
          settle(nextDetent(current.current, detentsRef.current));
          return;
        }
        settle(settleDetent(clampSheet(start.current - g.dy, detentsRef.current), g.vy, detentsRef.current));
      },
    }),
  ).current;

  return (
    <Animated.View style={[styles.sheet, {height, paddingBottom: bottomPad}]}>
      <View {...pan.panHandlers} style={styles.handle} accessibilityLabel="Riders sheet, drag or tap to resize">
        <View style={styles.grabber} />
      </View>
      <ScrollView style={styles.list} scrollEnabled={expanded} showsVerticalScrollIndicator={false}>
        {children}
      </ScrollView>
      <View style={styles.footer}>{footer}</View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  sheet: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: signal.surface,
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    paddingTop: 10,
    paddingHorizontal: 18,
    overflow: 'hidden',
  },
  handle: {
    height: HANDLE_HEIGHT,
    alignItems: 'center',
  },
  grabber: {
    width: 40,
    height: 5,
    borderRadius: 3,
    backgroundColor: signal.outline,
  },
  list: {
    flex: 1,
  },
  footer: {
    paddingTop: 8,
  },
});
