import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import * as Notifications from 'expo-notifications';
import { DarkTheme, DefaultTheme, Stack, ThemeProvider, useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import * as SystemUI from 'expo-system-ui';
import { useEffect, useMemo, useRef, useState } from 'react';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { Platform } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { LoadingState } from '../components/Screen';
import { AuthProvider, useAuth } from '../features/auth/AuthProvider';
import { AppThemeProvider, useAppTheme } from '../lib/theme-context';

function makeQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        // Realtime pushes invalidations, so polling would be waste. This is
        // only the fallback for a missed event.
        staleTime: 30_000,
        retry: 1,
        refetchOnWindowFocus: false,
      },
    },
  });
}

/**
 * Deep-links a tapped reminder straight to the task it is about.
 *
 * expo-notifications' response APIs are native-only — Expo Go/web don't
 * implement getLastNotificationResponseAsync or the response listener, so
 * this is a no-op there. Reminders themselves already require a development
 * build (see README), so nothing is lost by skipping it.
 */
function useNotificationRouting() {
  const router = useRouter();
  const handledColdStart = useRef(false);

  useEffect(() => {
    if (Platform.OS === 'web') return;

    function open(response: Notifications.NotificationResponse) {
      const data = response.notification.request.content.data as { taskId?: string; type?: string };
      if (data?.taskId) router.push(`/putzplan/${data.taskId}`);
      // A restock push is about the Einkaufsliste, where the entry has already
      // been written — not about the product page it came from.
      else if (data?.type === 'restock') router.push('/einkaufsliste');
    }

    // A notification that launched the app from a cold start arrives here, not
    // through the listener below.
    void Notifications.getLastNotificationResponseAsync().then((response) => {
      if (response && !handledColdStart.current) {
        handledColdStart.current = true;
        open(response);
      }
    });

    const subscription = Notifications.addNotificationResponseReceivedListener(open);
    return () => subscription.remove();
  }, [router]);
}

/**
 * Route access.
 *
 * Stack.Protected rather than a redirect in useEffect: an effect runs *after*
 * the children mount, so for one frame a signed-out user would mount the
 * household-scoped screens — and those call useHouseholdId(), which throws
 * when there is no household. Unavailable routes here are never mounted at
 * all, and expo-router moves to the first available one on its own.
 */
function RootNavigator() {
  const { session, profile, initializing, profileLoading } = useAuth();
  const { colors } = useAppTheme();
  useNotificationRouting();

  const signedIn = !!session;
  const hasHousehold = !!profile?.household_id;

  // Deciding before the stored session has been read would flash the sign-in
  // screen at someone who is already logged in.
  const settled = !initializing && !(signedIn && profileLoading);
  if (!settled) return <LoadingState label="Anmeldung wird geprüft…" />;

  return (
    <Stack
      screenOptions={{
        headerStyle: { backgroundColor: colors.background },
        headerShadowVisible: false,
        headerTintColor: colors.text,
        contentStyle: { backgroundColor: colors.background },
      }}
    >
      <Stack.Protected guard={!signedIn}>
        <Stack.Screen name="(auth)" options={{ headerShown: false }} />
      </Stack.Protected>

      <Stack.Protected guard={signedIn && !hasHousehold}>
        <Stack.Screen name="onboarding" options={{ headerShown: false }} />
      </Stack.Protected>

      <Stack.Protected guard={signedIn && hasHousehold}>
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        <Stack.Screen name="putzplan/neu" options={{ title: 'Neue Aufgabe', presentation: 'modal' }} />
        <Stack.Screen name="putzplan/[id]" options={{ title: 'Aufgabe' }} />
        <Stack.Screen name="ausgaben/neu" options={{ title: 'Neue Ausgabe', presentation: 'modal' }} />
        <Stack.Screen name="ausgaben/[id]" options={{ title: 'Ausgabe' }} />
        <Stack.Screen
          name="ausgaben/bearbeiten/[id]"
          options={{ title: 'Ausgabe bearbeiten', presentation: 'modal' }}
        />
        <Stack.Screen name="ausgaben/statistik" options={{ title: 'Statistik' }} />
        <Stack.Screen name="ausgaben/fixkosten" options={{ title: 'Fixkosten' }} />
        <Stack.Screen name="inventar/scan" options={{ title: 'Scannen', presentation: 'modal' }} />
        <Stack.Screen name="inventar/neu" options={{ title: 'Manuell hinzufügen', presentation: 'modal' }} />
        <Stack.Screen name="inventar/orte" options={{ title: 'Orte' }} />
        <Stack.Screen name="inventar/orte/[id]" options={{ title: 'Ort' }} />
        <Stack.Screen name="inventar/produkt/[id]" options={{ title: 'Produkt' }} />
        <Stack.Screen name="termine/neu" options={{ title: 'Neuer Termin', presentation: 'modal' }} />
        <Stack.Screen name="termine/[id]" options={{ title: 'Termin' }} />
      </Stack.Protected>
    </Stack>
  );
}

/**
 * Reads the resolved theme to paint the root container and status bar —
 * split out from RootLayout because that needs to render *inside*
 * AppThemeProvider to call useAppTheme() at all.
 */
function ThemedRoot() {
  const { colors, scheme } = useAppTheme();
  const [queryClient] = useState(makeQueryClient);

  /**
   * The navigator's own theme, which is a separate thing from ours.
   *
   * Every navigator paints the container a screen mounts into with
   * `theme.colors.background`, and expo-router's built-in default is
   * `rgb(242, 242, 242)` — so the first time a tab was opened, that near-white
   * showed for the frame between the scene being laid out and the screen
   * painting itself. Which is why the flash happened in dark mode too: nothing
   * about it came from our palette.
   *
   * `card` is the header/tab-bar surface and `border` its hairline; both are
   * set here as well so a screen that does use a navigator header does not
   * have to override them one by one.
   */
  const navigationTheme = useMemo(() => {
    const base = scheme === 'dark' ? DarkTheme : DefaultTheme;
    return {
      ...base,
      colors: {
        ...base.colors,
        primary: colors.primary,
        background: colors.background,
        card: colors.surface,
        text: colors.text,
        border: colors.border,
        notification: colors.danger,
      },
    };
  }, [scheme, colors]);

  /**
   * The native root view underneath React — what shows during a cold start and
   * whenever the JS view tree is briefly not covering the window. Defaults to
   * white, so it is the second half of the same flash.
   *
   * Runtime, unlike `userInterfaceStyle` in app.json, so it follows the theme
   * toggle rather than needing a new binary.
   */
  useEffect(() => {
    void SystemUI.setBackgroundColorAsync(colors.background);
  }, [colors.background]);

  return (
    <GestureHandlerRootView style={{ flex: 1, backgroundColor: colors.background }}>
      <SafeAreaProvider>
        <QueryClientProvider client={queryClient}>
          <AuthProvider>
            {/* expo-status-bar's "style" names the icon/text color, so a dark
                background needs the light-content variant and vice versa. */}
            <StatusBar style={scheme === 'dark' ? 'light' : 'dark'} />
            <ThemeProvider value={navigationTheme}>
              <RootNavigator />
            </ThemeProvider>
          </AuthProvider>
        </QueryClientProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

export default function RootLayout() {
  return (
    <AppThemeProvider>
      <ThemedRoot />
    </AppThemeProvider>
  );
}
