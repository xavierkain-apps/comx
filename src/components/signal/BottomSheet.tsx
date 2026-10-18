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

type DetentKind = keyof Detents;
const KINDS: DetentKind[] = ['collapsed', 'medium', 'large'];

/** The detent kind a resting height belongs to (nearest stop). */
function kindOf(height: number, d: Detents): DetentKind {
  return KINDS.reduce((best, k) => (Math.abs(d[k] - height) < Math.abs(d[best] - height) ? k : best), 'collapsed');
}

/**
 * The live screen's sheet. Its height animates between three detents
 * (src/radar/sheet.ts); the footer is never pushed off screen. Drag the
 * grabber to move it, tap the grabber to cycle detents.
 *
 * Callers must memoize `detents` (useMemo on screen height and bottom pad):
 * a new object re-settles the sheet on its current detent kind.
 */
export function BottomSheet({detents, bottomPad, children, footer}: BottomSheetProps) {
  const height = useRef(new Animated.Value(detents.medium)).current;
  const current = useRef(detents.medium);
  const kind = useRef<DetentKind>('medium');
  const start = useRef(detents.medium);
  const detentsRef = useRef(detents);
  detentsRef.current = detents;
  const mounted = useRef(false);
  const [shownKind, setShownKind] = useState<DetentKind>('medium');
  const expanded = shownKind === 'large';

  const settle = useCallback(
    (target: number) => {
      const d = detentsRef.current;
      current.current = target;
      kind.current = kindOf(target, d);
      setShownKind(kind.current);
      Animated.spring(height, {toValue: target, useNativeDriver: false, bounciness: 0, speed: 18}).start();
    },
    [height],
  );

  // Screen size changed (rotation, split view): stay on the same detent kind.
  // Skipped on mount, where the sheet already rests at medium.
  useEffect(() => {
    if (!mounted.current) {
      mounted.current = true;
      return;
    }
    settle(detents[kind.current]);
  }, [detents, settle]);

  const pan = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: (_e, g) => Math.abs(g.dy) > 4,
      // Keep the drag once it started (a ScrollView must not steal it).
      onPanResponderTerminationRequest: () => false,
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
      // The system took the touch (call, alert): rest where the drag was heading.
      onPanResponderTerminate: (_e, g) => {
        if (Math.abs(g.dy) < 4) {
          settle(current.current);
          return;
        }
        settle(settleDetent(clampSheet(start.current - g.dy, detentsRef.current), g.vy, detentsRef.current));
      },
    }),
  ).current;

  const step = (by: 1 | -1) => {
    const i = KINDS.indexOf(kind.current) + by;
    if (i >= 0 && i < KINDS.length) settle(detentsRef.current[KINDS[i]]);
  };

  return (
    <Animated.View style={[styles.sheet, {height, paddingBottom: bottomPad}]}>
      <View
        {...pan.panHandlers}
        style={styles.handle}
        hitSlop={HANDLE_SLOP}
        accessible
        accessibilityRole="adjustable"
        accessibilityLabel="Riders sheet, drag or tap to resize"
        accessibilityValue={{text: shownKind}}
        accessibilityActions={[{name: 'increment'}, {name: 'decrement'}]}
        onAccessibilityAction={e => step(e.nativeEvent.actionName === 'increment' ? 1 : -1)}>
        <View style={styles.grabber} />
      </View>
      <ScrollView style={styles.list} scrollEnabled={expanded} showsVerticalScrollIndicator={false}>
        {children}
      </ScrollView>
      <View style={styles.footer}>{footer}</View>
    </Animated.View>
  );
}

/** HANDLE_HEIGHT (25) + 20 = a 45 pt touch target; the top slop stays inside the sheet's 10 pt padding. */
const HANDLE_SLOP = {top: 10, bottom: 10, left: 0, right: 0};

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
