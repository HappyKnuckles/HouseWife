import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { useEffect, useRef, type ComponentProps, type ReactNode } from 'react';
import { Pressable, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import {
  runOnJS,
  useAnimatedReaction,
  useSharedValue,
  type SharedValue,
} from 'react-native-reanimated';
import Swipeable, {
  SwipeDirection,
  type SwipeableMethods,
} from 'react-native-gesture-handler/ReanimatedSwipeable';

import { spacing, typography } from '../lib/theme';
import { useAppTheme, useThemedStyles } from '../lib/theme-context';

type IconName = ComponentProps<typeof Ionicons>['name'];
type Tone = 'danger' | 'primary' | 'neutral';

export interface SwipeAction {
  key: string;
  icon: IconName;
  label: string;
  tone: Tone;
  accessibilityLabel?: string;
  onPress: () => void;
}

/**
 * Coordinates every SwipeRow in one list so opening one closes whatever else
 * was open. Without it, swiping three rows down a long list leaves three of
 * them hanging open — each row only knows about itself, so something has to
 * sit above them and remember which one that was.
 */
export function useSwipeRowGroup(): SwipeRowGroup {
  const rows = useRef(new Map<string, SwipeableMethods>()).current;
  const openId = useRef<string | null>(null);

  return useRef({
    register(id: string, methods: SwipeableMethods | null) {
      if (methods) rows.set(id, methods);
      else rows.delete(id);
    },
    onOpen(id: string) {
      if (openId.current && openId.current !== id) rows.get(openId.current)?.close();
      openId.current = id;
    },
  }).current;
}

export interface SwipeRowGroup {
  register(id: string, methods: SwipeableMethods | null): void;
  onOpen(id: string): void;
}

const ACTION_WIDTH = 76;

/**
 * How far past "fully open" counts as "swiped a lot" — 1 is exactly at the
 * actions' width, and `overshootFriction` below makes getting past that a
 * deliberate, unmistakable drag rather than a slightly-too-enthusiastic
 * reveal. Crossing it fires the first action on release, the same as
 * tapping it, without needing the extra tap.
 */
const FAR_SWIPE_PROGRESS = 1.4;

/**
 * Plain JS-thread wrapper for the crossing-threshold haptic tick.
 *
 * `useAnimatedReaction`'s callback is auto-workletized, and a worklet cannot
 * safely capture `Haptics` (a whole native-module namespace, not a plain
 * value) in its UI-thread closure — calling `Haptics.impactAsync` directly
 * inside the reaction crashes. Passing this function to `runOnJS` instead
 * only has to send it "call this, no args" across the bridge; the namespace
 * access happens back on the JS thread, where it's fine.
 */
function fireCommitHaptic() {
  void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
}

/**
 * A row with its destructive/secondary actions tucked behind a swipe instead
 * of sitting inline as icons. A to-do row already carries a checkbox, an
 * avatar, sometimes a quantity stepper — a permanently visible trash icon is
 * the first thing squeezed onto that, and it is squeezing the title next to
 * it. Swiping is the gesture iOS Mail/Reminders already taught, so it costs
 * nothing to learn and gives the title its space back.
 *
 * Renders no shadow or margin of its own — those belong on whatever wraps
 * this, because the library clips this component's own bounds to hide the
 * actions off-screen (`overflow: hidden`), which would clip a shadow drawn
 * inside it too. See the call sites for the wrapping pattern.
 */
export function SwipeRow({
  id,
  group,
  rightActions,
  leftActions,
  containerStyle,
  children,
}: {
  /** Only needed alongside `group`, to tell rows apart. */
  id?: string;
  group?: SwipeRowGroup;
  rightActions?: SwipeAction[];
  leftActions?: SwipeAction[];
  containerStyle?: StyleProp<ViewStyle>;
  children: ReactNode;
}) {
  const ref = useRef<SwipeableMethods>(null);
  // Set (worklet-side, via ActionGroup's reaction below) once a drag crosses
  // FAR_SWIPE_PROGRESS on that side; read back here once the drag settles
  // into the open state. Checked at settle time rather than mid-drag so this
  // never fights the pan gesture that is still tracking the finger.
  const farRight = useSharedValue(false);
  const farLeft = useSharedValue(false);

  useEffect(() => {
    if (!id || !group) return;
    group.register(id, ref.current);
    return () => group.register(id, null);
  }, [id, group]);

  function runAction(action: SwipeAction) {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    ref.current?.close();
    action.onPress();
  }

  function handleOpen(direction: SwipeDirection) {
    // Naming is by drag direction, not by which panel shows: dragging left
    // reveals the right-anchored actions.
    if (direction === SwipeDirection.LEFT && farRight.value && rightActions?.[0]) {
      farRight.value = false;
      runAction(rightActions[0]);
    } else if (direction === SwipeDirection.RIGHT && farLeft.value && leftActions?.[0]) {
      farLeft.value = false;
      runAction(leftActions[0]);
    }
  }

  return (
    <Swipeable
      ref={ref}
      friction={1.5}
      overshootFriction={3}
      containerStyle={containerStyle}
      onSwipeableWillOpen={() => id && group?.onOpen(id)}
      onSwipeableOpen={handleOpen}
      renderRightActions={
        rightActions?.length
          ? (progress) => <ActionGroup actions={rightActions} onPress={runAction} progress={progress} farRef={farRight} />
          : undefined
      }
      renderLeftActions={
        leftActions?.length
          ? (progress) => <ActionGroup actions={leftActions} onPress={runAction} progress={progress} farRef={farLeft} />
          : undefined
      }
    >
      {children}
    </Swipeable>
  );
}

function ActionGroup({
  actions,
  onPress,
  progress,
  farRef,
}: {
  actions: SwipeAction[];
  onPress: (action: SwipeAction) => void;
  progress: SharedValue<number>;
  farRef: SharedValue<boolean>;
}) {
  useAnimatedReaction(
    () => progress.value,
    (current, previous) => {
      if (current >= FAR_SWIPE_PROGRESS && (previous ?? 0) < FAR_SWIPE_PROGRESS) {
        farRef.value = true;
        runOnJS(fireCommitHaptic)();
      } else if (current < 1 && farRef.value) {
        // Dragged back below "fully open" before releasing — no longer a
        // committed far-swipe.
        farRef.value = false;
      }
    },
  );

  const { colors } = useAppTheme();
  const styles = useThemedStyles((c) => ({
    row: { flexDirection: 'row' as const },
    button: {
      width: ACTION_WIDTH,
      alignItems: 'center' as const,
      justifyContent: 'center' as const,
      gap: 4,
      paddingHorizontal: spacing.xs,
    },
    danger: { backgroundColor: c.danger },
    primary: { backgroundColor: c.primary },
    neutral: { backgroundColor: c.surfaceMuted },
    label: { ...typography.micro, color: c.textInverse, textAlign: 'center' as const },
    labelNeutral: { color: c.text },
  }));

  const iconColor: Record<Tone, string> = {
    danger: colors.textInverse,
    primary: colors.textInverse,
    neutral: colors.text,
  };

  return (
    <View style={styles.row}>
      {actions.map((action) => (
        <Pressable
          key={action.key}
          onPress={() => onPress(action)}
          style={[styles.button, styles[action.tone]]}
          accessibilityRole="button"
          accessibilityLabel={action.accessibilityLabel ?? action.label}
        >
          <Ionicons name={action.icon} size={20} color={iconColor[action.tone]} />
          <Text
            style={[styles.label, action.tone === 'neutral' && styles.labelNeutral]}
            numberOfLines={1}
          >
            {action.label}
          </Text>
        </Pressable>
      ))}
    </View>
  );
}
