import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { StyleSheet, useColorScheme } from 'react-native';

import {
  DEFAULT_ACCENT,
  darkColors,
  isAccentKey,
  lightColors,
  withAccent,
  type AccentKey,
  type ThemeColors,
} from './theme';

export type ThemePreference = 'system' | 'light' | 'dark';
type ResolvedScheme = 'light' | 'dark';

const STORAGE_KEY = 'haushalt.theme-preference';
const ACCENT_KEY = 'haushalt.theme-accent';

interface ThemeContextValue {
  colors: ThemeColors;
  /** What's actually being shown right now. */
  scheme: ResolvedScheme;
  /** What the user asked for — 'system' means "follow the OS". */
  preference: ThemePreference;
  setPreference: (pref: ThemePreference) => void;
  /** Which accent paints primary/primarySoft. */
  accent: AccentKey;
  setAccent: (accent: AccentKey) => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

/**
 * Device-local, not synced through the household. One member's dark mode
 * preference has no reason to flip the other's phone, so this lives in
 * AsyncStorage, not in profiles/households. The accent is the same kind of
 * thing and lives beside it, under its own key so a stored theme choice is
 * not rewritten every time a color is tapped.
 */
export function AppThemeProvider({ children }: { children: ReactNode }) {
  const systemScheme = useColorScheme();
  const [preference, setPreferenceState] = useState<ThemePreference>('system');
  const [accent, setAccentState] = useState<AccentKey>(DEFAULT_ACCENT);

  // Starts as 'system' (the common case, and already correct on first paint
  // since it just follows systemScheme). If the user previously chose an
  // explicit override, this swaps to it as soon as the read completes — a
  // one-frame flash on cold start, not worth blocking the whole app on.
  //
  // multiGet rather than two reads: one round trip, and the theme and its
  // accent land in the same commit instead of repainting twice.
  useEffect(() => {
    AsyncStorage.multiGet([STORAGE_KEY, ACCENT_KEY]).then((entries) => {
      const stored = Object.fromEntries(entries);

      const pref = stored[STORAGE_KEY];
      if (pref === 'light' || pref === 'dark' || pref === 'system') setPreferenceState(pref);

      // An accent removed from ACCENTS in a later version fails isAccentKey()
      // and falls back to the default rather than painting undefined.
      if (isAccentKey(stored[ACCENT_KEY])) setAccentState(stored[ACCENT_KEY]);
    });
  }, []);

  function setPreference(pref: ThemePreference) {
    setPreferenceState(pref);
    void AsyncStorage.setItem(STORAGE_KEY, pref);
  }

  function setAccent(next: AccentKey) {
    setAccentState(next);
    void AsyncStorage.setItem(ACCENT_KEY, next);
  }

  const scheme: ResolvedScheme =
    preference === 'system' ? (systemScheme === 'dark' ? 'dark' : 'light') : preference;

  const value = useMemo<ThemeContextValue>(
    () => ({
      colors: withAccent(scheme === 'dark' ? darkColors : lightColors, accent, scheme),
      scheme,
      preference,
      setPreference,
      accent,
      setAccent,
    }),
    [scheme, preference, accent],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useAppTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useAppTheme must be used inside <AppThemeProvider>');
  return ctx;
}

/**
 * Builds a StyleSheet from the active palette and memoizes it, so a theme
 * change re-renders with new colors without re-creating the object on every
 * unrelated render. This is the one addition each screen needs to go from a
 * static `const styles = StyleSheet.create({...})` to a themed one:
 *
 *   const styles = useThemedStyles((colors) => ({ ... }));
 *
 * The factory body is usually unchanged — `colors` was already the name of
 * the values used inside it.
 */
export function useThemedStyles<T extends StyleSheet.NamedStyles<T>>(
  factory: (colors: ThemeColors) => T,
): T {
  const { colors } = useAppTheme();
  // eslint-disable-next-line react-hooks/exhaustive-deps -- factory is a fresh
  // arrow function every render by design; only colors identity should retrigger.
  return useMemo(() => StyleSheet.create(factory(colors)), [colors]);
}
