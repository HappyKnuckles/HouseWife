/**
 * Design tokens. One source of truth for the whole app so the Putzplan, the
 * balance card and the inventory list actually look like the same product —
 * in both light and dark mode.
 *
 * Only `colors` differs between themes; spacing/radius/typography/shadow are
 * the same shapes regardless of scheme, so they stay flat exports. `colors`
 * itself is exported too (as the light palette) for the handful of call sites
 * that are not React components and therefore cannot use useAppTheme() — e.g.
 * the Android notification channel's LED color, which is a system-level
 * value, not something that repaints when the user flips a theme toggle.
 * Every screen and component reads the *active* palette through
 * useAppTheme()/useThemedStyles() instead (see theme-context.tsx).
 */
import type { AgendaStatus } from './database.types';

/**
 * Accent colors — the one part of the palette the user gets to choose.
 *
 * Only `primary`/`primarySoft` are swappable, and deliberately so: those are
 * the app's "this is tappable" language (buttons, the active tab, links, the
 * invite code box), which is a matter of taste. Everything else is not.
 * Überfällig stays red and erledigt stays green no matter what, because those
 * carry meaning rather than decoration — an accent that could recolor them
 * would let the user turn "overdue" into a soothing mint.
 *
 * Each accent names its own dark variant instead of deriving one: the same hex
 * that reads well on #F5F6F8 goes muddy on #0B0F16, which is exactly why
 * darkColors.primary is already a step brighter than the light one.
 */
export const ACCENTS = {
  blau: {
    label: 'Blau',
    light: { primary: '#2563EB', primarySoft: '#DBEAFE' },
    dark: { primary: '#3B82F6', primarySoft: '#152A4D' },
  },
  gruen: {
    label: 'Grün',
    light: { primary: '#059669', primarySoft: '#D1FAE5' },
    dark: { primary: '#34D399', primarySoft: '#0C2E26' },
  },
  tuerkis: {
    label: 'Türkis',
    light: { primary: '#0891B2', primarySoft: '#CFFAFE' },
    dark: { primary: '#22D3EE', primarySoft: '#0B2E38' },
  },
  violett: {
    label: 'Violett',
    light: { primary: '#7C3AED', primarySoft: '#EDE9FE' },
    dark: { primary: '#A78BFA', primarySoft: '#241B4D' },
  },
  pink: {
    label: 'Pink',
    light: { primary: '#DB2777', primarySoft: '#FCE7F3' },
    dark: { primary: '#F472B6', primarySoft: '#3D1330' },
  },
  orange: {
    label: 'Orange',
    light: { primary: '#EA580C', primarySoft: '#FFEDD5' },
    dark: { primary: '#FB923C', primarySoft: '#40230F' },
  },
  graphit: {
    label: 'Graphit',
    light: { primary: '#334155', primarySoft: '#E2E8F0' },
    dark: { primary: '#94A3B8', primarySoft: '#232A36' },
  },
} as const;

export type AccentKey = keyof typeof ACCENTS;

export const ACCENT_KEYS = Object.keys(ACCENTS) as AccentKey[];

/** What the app looked like before there was a choice, so nobody's app moves. */
export const DEFAULT_ACCENT: AccentKey = 'blau';

export function isAccentKey(value: unknown): value is AccentKey {
  return typeof value === 'string' && value in ACCENTS;
}

export const lightColors = {
  background: '#F5F6F8',
  surface: '#FFFFFF',
  surfaceMuted: '#EFF1F4',

  text: '#111827',
  textMuted: '#6B7280',
  textFaint: '#9CA3AF',
  // Always paired with a saturated background (primary button, avatar,
  // colored banner) rather than the page background, so it stays a light
  // constant in both palettes instead of inverting with the theme.
  textInverse: '#FFFFFF',

  border: '#E5E7EB',
  borderStrong: '#D1D5DB',

  // The default accent, spelled once. Choosing another one in Einstellungen
  // overwrites exactly these two keys — see withAccent().
  primary: ACCENTS[DEFAULT_ACCENT].light.primary,
  primarySoft: ACCENTS[DEFAULT_ACCENT].light.primarySoft,

  // Putzplan status language — used for the left rail of every task card,
  // the section headers and the badges, so urgency reads at a glance.
  overdue: '#DC2626',
  overdueSoft: '#FEE2E2',
  dueToday: '#EA580C',
  dueTodaySoft: '#FFEDD5',
  dueSoon: '#2563EB',
  dueSoonSoft: '#DBEAFE',
  upcoming: '#6B7280',
  upcomingSoft: '#F3F4F6',

  success: '#059669',
  successSoft: '#D1FAE5',
  danger: '#DC2626',
  warning: '#D97706',
} as const;

export const darkColors: ThemeColors = {
  // Slate rather than pure black: pure black next to white text is harsher
  // than it needs to be, and OLED smearing on a near-black is not a concern
  // worth chasing for a household app.
  background: '#0B0F16',
  surface: '#161B24',
  surfaceMuted: '#1F2530',

  text: '#F3F4F6',
  textMuted: '#9CA3AF',
  textFaint: '#6B7280',
  textInverse: '#FFFFFF',

  border: '#232A36',
  borderStrong: '#333B49',

  // One step brighter than the light palette's primary — the same hex reads
  // muddy at low lightness against a dark background.
  primary: ACCENTS[DEFAULT_ACCENT].dark.primary,
  primarySoft: ACCENTS[DEFAULT_ACCENT].dark.primarySoft,

  overdue: '#F87171',
  overdueSoft: '#3F1A1A',
  dueToday: '#FB923C',
  dueTodaySoft: '#402A12',
  dueSoon: '#3B82F6',
  dueSoonSoft: '#152A4D',
  upcoming: '#9CA3AF',
  upcomingSoft: '#1F2530',

  success: '#34D399',
  successSoft: '#123027',
  danger: '#F87171',
  warning: '#FBBF24',
};

// Widened to `string` per key rather than `typeof lightColors` directly: the
// `as const` above gives each light-palette value its own literal type (e.g.
// `background: "#F5F6F8"`), which would make darkColors a type error for
// having the audacity to be a different color.
export type ThemeColors = { [K in keyof typeof lightColors]: string };

/** Back-compat / non-component call sites. Prefer useAppTheme() in screens. */
export const colors = lightColors;

/**
 * The palette with the chosen accent painted over it.
 *
 * A new object every call rather than a mutation — theme-context memoizes on
 * the result's identity, and a mutated palette would repaint nothing.
 */
export function withAccent(
  base: ThemeColors,
  accent: AccentKey,
  scheme: 'light' | 'dark',
): ThemeColors {
  return { ...base, ...ACCENTS[accent][scheme] };
}

export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
} as const;

export const radius = {
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  pill: 999,
} as const;

export const typography = {
  display: { fontSize: 28, fontWeight: '700' as const, letterSpacing: -0.5 },
  title: { fontSize: 20, fontWeight: '700' as const, letterSpacing: -0.3 },
  heading: { fontSize: 17, fontWeight: '600' as const },
  body: { fontSize: 15, fontWeight: '400' as const },
  bodyStrong: { fontSize: 15, fontWeight: '600' as const },
  caption: { fontSize: 13, fontWeight: '400' as const },
  captionStrong: { fontSize: 13, fontWeight: '600' as const },
  micro: { fontSize: 11, fontWeight: '600' as const, letterSpacing: 0.4 },
} as const;

export const shadow = {
  card: {
    shadowColor: '#0F172A',
    shadowOpacity: 0.06,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 2,
  },
} as const;

/** Derived from the active palette, so it repaints along with everything else. */
export function getStatusColor(
  c: ThemeColors,
): Record<AgendaStatus, { fg: string; bg: string; label: string }> {
  return {
    overdue: { fg: c.overdue, bg: c.overdueSoft, label: 'Überfällig' },
    due_today: { fg: c.dueToday, bg: c.dueTodaySoft, label: 'Heute' },
    due_soon: { fg: c.dueSoon, bg: c.dueSoonSoft, label: 'Bald' },
    upcoming: { fg: c.upcoming, bg: c.upcomingSoft, label: 'Geplant' },
  };
}
