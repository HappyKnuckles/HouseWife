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

import { darkColors, lightColors, type ThemeColors } from './theme';

export type ThemePreference = 'system' | 'light' | 'dark';
type ResolvedScheme = 'light' | 'dark';

const STORAGE_KEY = 'haushalt.theme-preference';

interface ThemeContextValue {
  colors: ThemeColors;
  /** What's actually being shown right now. */
  scheme: ResolvedScheme;
  /** What the user asked for — 'system' means "follow the OS". */
  preference: ThemePreference;
  setPreference: (pref: ThemePreference) => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

/**
 * Device-local, not synced through the household. Your dark mode preference
 * has no reason to flip your wife's phone, so this lives in AsyncStorage, not
 * in profiles/households.
 */
export function AppThemeProvider({ children }: { children: ReactNode }) {
  const systemScheme = useColorScheme();
  const [preference, setPreferenceState] = useState<ThemePreference>('system');

  // Starts as 'system' (the common case, and already correct on first paint
  // since it just follows systemScheme). If the user previously chose an
  // explicit override, this swaps to it as soon as the read completes — a
  // one-frame flash on cold start, not worth blocking the whole app on.
  useEffect(() => {
    AsyncStorage.getItem(STORAGE_KEY).then((stored) => {
      if (stored === 'light' || stored === 'dark' || stored === 'system') {
        setPreferenceState(stored);
      }
    });
  }, []);

  function setPreference(pref: ThemePreference) {
    setPreferenceState(pref);
    void AsyncStorage.setItem(STORAGE_KEY, pref);
  }

  const scheme: ResolvedScheme =
    preference === 'system' ? (systemScheme === 'dark' ? 'dark' : 'light') : preference;

  const value = useMemo<ThemeContextValue>(
    () => ({
      colors: scheme === 'dark' ? darkColors : lightColors,
      scheme,
      preference,
      setPreference,
    }),
    [scheme, preference],
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
