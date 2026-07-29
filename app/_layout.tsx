import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import * as Notifications from 'expo-notifications';
import { Stack, useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useRef, useState } from 'react';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { Platform } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { LoadingState } from '../src/components/Screen';
import { AuthProvider, useAuth } from '../src/features/auth/AuthProvider';
import { AppThemeProvider, useAppTheme } from '../src/lib/theme-context';

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
      const data = response.notification.request.content.data as { taskId?: string };
      if (data?.taskId) router.push(`/putzplan/${data.taskId}`);
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
        <Stack.Screen name="inventar/scan" options={{ title: 'Scannen', presentation: 'modal' }} />
        <Stack.Screen name="inventar/neu" options={{ title: 'Manuell hinzufügen', presentation: 'modal' }} />
        <Stack.Screen name="inventar/orte" options={{ title: 'Orte' }} />
        <Stack.Screen name="inventar/orte/[id]" options={{ title: 'Ort' }} />
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

  return (
    <GestureHandlerRootView style={{ flex: 1, backgroundColor: colors.background }}>
      <SafeAreaProvider>
        <QueryClientProvider client={queryClient}>
          <AuthProvider>
            {/* expo-status-bar's "style" names the icon/text color, so a dark
                background needs the light-content variant and vice versa. */}
            <StatusBar style={scheme === 'dark' ? 'light' : 'dark'} />
            <RootNavigator />
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
