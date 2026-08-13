/**
 * Full-screen receipt, with pinch to zoom.
 *
 * The whole point of keeping a photo of the receipt is being able to read what
 * is on it two weeks later — and a 320pt-high preview of an 80cm till roll is
 * not readable by anyone. So this is not a lightbox for looking at a picture,
 * it is the thing that makes the feature worth having.
 *
 * Deliberately not themed: a photo viewer is black in every app that has one,
 * because anything else casts a tint over the image you are trying to read.
 * These are the only hard-coded colors in the app that are not in theme.ts.
 */
import { Ionicons } from '@expo/vector-icons';
import { Image } from 'expo-image';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { Gesture, GestureDetector, GestureHandlerRootView } from 'react-native-gesture-handler';
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { radius, spacing, typography } from '../../../lib/theme';

const MAX_SCALE = 6;
/** What a double-tap zooms to — enough to read a price column, not a pixel. */
const TAP_SCALE = 2.5;

function clamp(value: number, min: number, max: number) {
  'worklet';
  return Math.min(Math.max(value, min), max);
}

export function ReceiptViewer({ uri, onClose }: { uri: string | null; onClose: () => void }) {
  const insets = useSafeAreaInsets();

  const scale = useSharedValue(1);
  const savedScale = useSharedValue(1);
  const x = useSharedValue(0);
  const y = useSharedValue(0);
  const savedX = useSharedValue(0);
  const savedY = useSharedValue(0);

  function reset() {
    'worklet';
    scale.value = withTiming(1);
    savedScale.value = 1;
    x.value = withTiming(0);
    y.value = withTiming(0);
    savedX.value = 0;
    savedY.value = 0;
  }

  const pinch = Gesture.Pinch()
    .onUpdate((event) => {
      scale.value = clamp(savedScale.value * event.scale, 1, MAX_SCALE);
    })
    .onEnd(() => {
      savedScale.value = scale.value;
      // Zooming back out snaps the image back to the middle: a pan offset that
      // is invisible at 1× would otherwise still be there on the next pinch.
      if (scale.value <= 1) reset();
    });

  // averageTouches, so a two-finger pinch that drifts sideways moves the image
  // with the midpoint instead of jumping to whichever finger landed first.
  const pan = Gesture.Pan()
    .averageTouches(true)
    .onUpdate((event) => {
      x.value = savedX.value + event.translationX;
      y.value = savedY.value + event.translationY;
    })
    .onEnd(() => {
      savedX.value = x.value;
      savedY.value = y.value;
    });

  const doubleTap = Gesture.Tap()
    .numberOfTaps(2)
    .onEnd(() => {
      if (scale.value > 1) {
        reset();
      } else {
        scale.value = withTiming(TAP_SCALE);
        savedScale.value = TAP_SCALE;
      }
    });

  // Race, not Simultaneous: a double-tap must not also register as the start
  // of a pan, or the image slides away from under the second tap.
  const gesture = Gesture.Race(doubleTap, Gesture.Simultaneous(pinch, pan));

  const imageStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: x.value }, { translateY: y.value }, { scale: scale.value }],
  }));

  return (
    <Modal
      visible={!!uri}
      transparent
      animationType="fade"
      onRequestClose={onClose}
      statusBarTranslucent
      // Every open starts at 1×, rather than wherever the last receipt was
      // left — the shared values outlive the modal, the image does not.
      onShow={reset}
    >
      {/* Modal content is its own native root on Android, and gestures inside
          it are dead without a root view of their own. */}
      <GestureHandlerRootView style={styles.root}>
        <GestureDetector gesture={gesture}>
          <Animated.View style={styles.stage}>
            {uri ? (
              <Animated.View style={[styles.imageWrap, imageStyle]}>
                <Image source={{ uri }} style={styles.image} contentFit="contain" />
              </Animated.View>
            ) : null}
          </Animated.View>
        </GestureDetector>

        <Pressable
          onPress={onClose}
          style={[styles.close, { top: insets.top + spacing.md }]}
          hitSlop={10}
          accessibilityRole="button"
          accessibilityLabel="Schließen"
        >
          <Ionicons name="close" size={24} color="#FFFFFF" />
        </Pressable>

        <Text style={[styles.hint, { bottom: insets.bottom + spacing.lg }]}>
          Zwei Finger zum Zoomen · Doppeltippen
        </Text>
      </GestureHandlerRootView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#000000' },
  stage: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  imageWrap: { width: '100%', height: '100%' },
  image: { width: '100%', height: '100%' },
  close: {
    position: 'absolute',
    right: spacing.lg,
    width: 40,
    height: 40,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.15)',
  },
  hint: {
    position: 'absolute',
    alignSelf: 'center',
    ...typography.caption,
    color: 'rgba(255,255,255,0.6)',
  },
});
