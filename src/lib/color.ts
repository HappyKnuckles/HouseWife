/**
 * Color maths, kept out of theme.ts on purpose — that file is the design
 * tokens, this is the arithmetic that a free colour picker forces on us.
 *
 * Two jobs, and the second is the one that matters. Converting between hex and
 * HSV is what makes a picker draggable at all. Deciding whether a colour needs
 * white or dark lettering on top is what stops the picker being a way to make
 * yourself invisible: <Avatar> used to hard-code white initials because every
 * colour it could receive was a saturated preset, and the moment a person can
 * choose pale yellow that assumption is simply wrong.
 */

export interface Hsv {
  /** Degrees, 0–360. */
  h: number;
  /** 0–1. */
  s: number;
  /** 0–1. */
  v: number;
}

const HEX = /^#?([0-9a-f]{6})$/i;

/** Falls back to mid-grey rather than throwing — a bad colour is not a crash. */
export function hexToRgb(hex: string): [number, number, number] {
  const match = HEX.exec(hex ?? '');
  if (!match) return [128, 128, 128];

  const value = parseInt(match[1], 16);
  return [(value >> 16) & 255, (value >> 8) & 255, value & 255];
}

export function rgbToHex(r: number, g: number, b: number): string {
  const channel = (v: number) =>
    Math.max(0, Math.min(255, Math.round(v)))
      .toString(16)
      .padStart(2, '0');

  return `#${channel(r)}${channel(g)}${channel(b)}`;
}

export function hexToHsv(hex: string): Hsv {
  const [r, g, b] = hexToRgb(hex).map((c) => c / 255);

  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const delta = max - min;

  const h =
    delta === 0
      ? 0
      : max === r
        ? ((g - b) / delta + (g < b ? 6 : 0)) * 60
        : max === g
          ? ((b - r) / delta + 2) * 60
          : ((r - g) / delta + 4) * 60;

  return { h, s: max === 0 ? 0 : delta / max, v: max };
}

export function hsvToHex(h: number, s: number, v: number): string {
  const hue = ((h % 360) + 360) % 360;
  const c = v * s;
  const x = c * (1 - Math.abs(((hue / 60) % 2) - 1));
  const m = v - c;

  const [r, g, b] =
    hue < 60
      ? [c, x, 0]
      : hue < 120
        ? [x, c, 0]
        : hue < 180
          ? [0, c, x]
          : hue < 240
            ? [0, x, c]
            : hue < 300
              ? [x, 0, c]
              : [c, 0, x];

  return rgbToHex((r + m) * 255, (g + m) * 255, (b + m) * 255);
}

/** WCAG relative luminance, 0 (black) to 1 (white). */
export function relativeLuminance(hex: string): number {
  const [r, g, b] = hexToRgb(hex)
    .map((c) => c / 255)
    .map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));

  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG contrast ratio between two colours, 1 (identical) to 21 (black/white). */
export function contrastRatio(a: string, b: string): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  const [light, dark] = la > lb ? [la, lb] : [lb, la];

  return (light + 0.05) / (dark + 0.05);
}

/** The app's dark ink — same value as lightColors.text, which is what it is. */
const INK = '#111827';
const PAPER = '#FFFFFF';

/**
 * Whichever of white or dark ink is actually legible on this background.
 *
 * Measured rather than guessed at with a lightness threshold: the eye is far
 * more sensitive to green than to blue, so #FFFF00 and #0000FF have wildly
 * different contrast against white despite both being fully saturated. The
 * WCAG ratio already encodes that, and picking the better of the two is one
 * comparison.
 */
export function readableTextOn(background: string): string {
  return contrastRatio(background, PAPER) >= contrastRatio(background, INK) ? PAPER : INK;
}

/**
 * How different two colours look, roughly — a weighted RGB distance.
 *
 * "Redmean" rather than plain Euclidean: it weights the channels the way the
 * eye does, so it does not claim two blues are as far apart as a blue and a
 * green that differ by the same raw numbers. Not a substitute for CIEDE2000,
 * but this only has to answer "are these two people's colours too similar to
 * tell apart", and for that it is plenty.
 *
 * 0 is identical; anything under ~60 reads as the same colour at avatar size.
 */
export function colorDistance(a: string, b: string): number {
  const [r1, g1, b1] = hexToRgb(a);
  const [r2, g2, b2] = hexToRgb(b);

  const rMean = (r1 + r2) / 2;
  const dr = r1 - r2;
  const dg = g1 - g2;
  const db = b1 - b2;

  return Math.sqrt(
    (2 + rMean / 256) * dr * dr + 4 * dg * dg + (2 + (255 - rMean) / 256) * db * db,
  );
}

/** Below this, two people's avatars are not telling you anything apart. */
export const TOO_SIMILAR = 60;
