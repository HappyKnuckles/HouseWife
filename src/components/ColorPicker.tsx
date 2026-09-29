/**
 * A colour picker: saturation/value square plus a hue slider.
 *
 * Built rather than installed. Everything it needs was already here — svg for
 * the two gradients, gesture-handler for the dragging — so a dependency would
 * have bought one settings row an extra thing to keep working across Expo
 * upgrades.
 *
 * HSV rather than HSL because that is what this shape of picker *is*: white in
 * the top-left corner, the pure hue in the top-right, black along the bottom.
 * An HSL square puts the pure hue in the middle of the right edge and greys the
 * corners, which is correct and looks broken.
 *
 * Hue lives in state here rather than being read back out of the hex. It has
 * to: black and white have no hue at all, so dragging into the bottom-left
 * corner and back out would lose which colour you had been picking and snap you
 * to red.
 */
import { useEffect, useState } from 'react';
import { Text, View, type LayoutChangeEvent } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Svg, { Defs, LinearGradient, Rect, Stop } from 'react-native-svg';

import { hexToHsv, hsvToHex, readableTextOn } from '../lib/color';
import { radius, spacing } from '../lib/theme';
import { useThemedStyles } from '../lib/theme-context';

const SQUARE_HEIGHT = 170;
const SLIDER_HEIGHT = 22;
const THUMB = 26;

/** The six corners of the wheel, which is all a hue gradient needs. */
const HUE_STOPS = [0, 60, 120, 180, 240, 300, 360];

const clamp01 = (value: number) => Math.min(1, Math.max(0, value));

export function ColorPicker({
  value,
  onChange,
}: {
  value: string;
  /** Fires continuously while dragging — cheap, and the preview needs it. */
  onChange: (hex: string) => void;
}) {
  const styles = useThemedStyles((c) => ({
    wrap: { gap: spacing.md },
    square: { height: SQUARE_HEIGHT, borderRadius: radius.md, overflow: 'hidden' as const },
    slider: { height: SLIDER_HEIGHT, borderRadius: radius.pill, overflow: 'hidden' as const },
    // Two rings, light over dark, so the thumb stays visible on every colour
    // underneath it — a single white ring disappears into the top-left corner
    // of the square, which is pure white.
    thumb: {
      position: 'absolute' as const,
      width: THUMB,
      height: THUMB,
      borderRadius: radius.pill,
      borderWidth: 3,
      borderColor: '#FFFFFF',
      // Centring is done here rather than with transforms so the maths below
      // stays in plain pixels.
      marginLeft: -THUMB / 2,
      marginTop: -THUMB / 2,
    },
    thumbInner: {
      flex: 1,
      borderRadius: radius.pill,
      borderWidth: 1,
      borderColor: 'rgba(0,0,0,0.35)',
    },
    swatchRow: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: spacing.md },
    preview: {
      width: 44,
      height: 44,
      borderRadius: radius.pill,
      alignItems: 'center' as const,
      justifyContent: 'center' as const,
    },
    previewInitial: { fontSize: 15, fontWeight: '600' as const },
    hex: { flex: 1, fontVariant: ['tabular-nums' as const], color: c.textMuted, fontSize: 13 },
  }));

  const [hue, setHue] = useState(() => hexToHsv(value).h);
  const [square, setSquare] = useState({ width: 0, height: 0 });
  const [sliderWidth, setSliderWidth] = useState(0);

  const { s, v } = hexToHsv(value);

  // Re-seed the hue when the value is changed from outside — tapping one of
  // the preset swatches above the picker has to move the thumbs.
  useEffect(() => {
    const incoming = hexToHsv(value);
    if (hsvToHex(hue, incoming.s, incoming.v).toLowerCase() !== value.toLowerCase()) {
      setHue(incoming.h);
    }
    // Only when the value itself changes; `hue` here is the previous hue by
    // design, not a trigger.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  function pickFromSquare(x: number, y: number) {
    if (!square.width || !square.height) return;
    onChange(hsvToHex(hue, clamp01(x / square.width), 1 - clamp01(y / square.height)));
  }

  function pickFromSlider(x: number) {
    if (!sliderWidth) return;
    const nextHue = clamp01(x / sliderWidth) * 360;
    setHue(nextHue);
    // Dragging the hue of a black or fully-desaturated colour would otherwise
    // do nothing visible. Floor both so the slider always shows its effect.
    onChange(hsvToHex(nextHue, s === 0 ? 1 : s, v === 0 ? 1 : v));
  }

  // minDistance(0) so a tap lands the thumb instead of needing a drag, and
  // runOnJS because the output is React state either way — there is nothing
  // here worth marshalling onto the UI thread for.
  const squareGesture = Gesture.Pan()
    .runOnJS(true)
    .minDistance(0)
    .onBegin((e) => pickFromSquare(e.x, e.y))
    .onUpdate((e) => pickFromSquare(e.x, e.y));

  const sliderGesture = Gesture.Pan()
    .runOnJS(true)
    .minDistance(0)
    .onBegin((e) => pickFromSlider(e.x))
    .onUpdate((e) => pickFromSlider(e.x));

  const onSquareLayout = (e: LayoutChangeEvent) =>
    setSquare({ width: e.nativeEvent.layout.width, height: e.nativeEvent.layout.height });

  const hueHex = hsvToHex(hue, 1, 1);

  return (
    <View style={styles.wrap}>
      <GestureDetector gesture={squareGesture}>
        <View style={styles.square} onLayout={onSquareLayout}>
          <Svg width="100%" height="100%">
            <Defs>
              <LinearGradient id="cp-sat" x1="0" y1="0" x2="1" y2="0">
                <Stop offset="0" stopColor="#FFFFFF" />
                <Stop offset="1" stopColor={hueHex} />
              </LinearGradient>
              <LinearGradient id="cp-val" x1="0" y1="0" x2="0" y2="1">
                <Stop offset="0" stopColor="#000000" stopOpacity="0" />
                <Stop offset="1" stopColor="#000000" stopOpacity="1" />
              </LinearGradient>
            </Defs>
            <Rect width="100%" height="100%" fill="url(#cp-sat)" />
            <Rect width="100%" height="100%" fill="url(#cp-val)" />
          </Svg>

          <View
            pointerEvents="none"
            style={[
              styles.thumb,
              {
                left: s * square.width,
                top: (1 - v) * square.height,
                backgroundColor: value,
              },
            ]}
          >
            <View style={styles.thumbInner} />
          </View>
        </View>
      </GestureDetector>

      <GestureDetector gesture={sliderGesture}>
        <View
          style={styles.slider}
          onLayout={(e) => setSliderWidth(e.nativeEvent.layout.width)}
        >
          <Svg width="100%" height="100%">
            <Defs>
              <LinearGradient id="cp-hue" x1="0" y1="0" x2="1" y2="0">
                {HUE_STOPS.map((stop) => (
                  <Stop key={stop} offset={stop / 360} stopColor={hsvToHex(stop, 1, 1)} />
                ))}
              </LinearGradient>
            </Defs>
            <Rect width="100%" height="100%" fill="url(#cp-hue)" />
          </Svg>

          <View
            pointerEvents="none"
            style={[
              styles.thumb,
              {
                left: (hue / 360) * sliderWidth,
                top: SLIDER_HEIGHT / 2,
                backgroundColor: hueHex,
              },
            ]}
          >
            <View style={styles.thumbInner} />
          </View>
        </View>
      </GestureDetector>

      {/* The preview is an avatar, not a square: what is being chosen is the
          circle with your initials in it, and whether the letters are still
          readable is the only thing that can go wrong here. */}
      <View style={styles.swatchRow}>
        <View style={[styles.preview, { backgroundColor: value }]}>
          <Text style={[styles.previewInitial, { color: readableTextOn(value) }]}>Aa</Text>
        </View>
        <Text style={styles.hex}>{value.toUpperCase()}</Text>
      </View>
    </View>
  );
}
