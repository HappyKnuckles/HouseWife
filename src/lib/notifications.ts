import Constants, { ExecutionEnvironment } from 'expo-constants';
import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

import { env } from './env';
import { supabase } from './supabase';

/** Must match the channelId that household-tick sends. */
export const PUTZPLAN_CHANNEL = 'putzplan';

/**
 * Foreground behaviour. Without a handler, a notification that arrives while
 * the app is open is swallowed silently.
 *
 * Note `shouldShowBanner`/`shouldShowList` — these replaced the single
 * `shouldShowAlert` field; returning the old one now does nothing.
 */
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

export type PushRegistrationResult =
  | { status: 'registered'; token: string }
  | { status: 'denied' }
  | { status: 'simulator' }
  | { status: 'expo-go' }
  | { status: 'unconfigured' }
  | { status: 'error'; message: string };

const isExpoGo = Constants.executionEnvironment === ExecutionEnvironment.StoreClient;

/**
 * Registers this device for Putzplan reminders.
 *
 * Returns *why* it could not register rather than throwing, because the two
 * common reasons are both expected and both worth explaining in the UI:
 * running in Expo Go (remote push was removed from it in SDK 53 — a
 * development build is required) and running on a simulator.
 */
export async function registerPushToken(
  householdId: string,
  profileId: string,
): Promise<PushRegistrationResult> {
  if (isExpoGo) return { status: 'expo-go' };
  if (!Device.isDevice) return { status: 'simulator' };
  if (!env.easProjectId) return { status: 'unconfigured' };

  try {
    // The channel must exist before the first notification arrives, otherwise
    // Android silently drops it into a default channel the user cannot tune.
    if (Platform.OS === 'android') {
      await Notifications.setNotificationChannelAsync(PUTZPLAN_CHANNEL, {
        name: 'Putzplan',
        description: 'Erinnerungen für fällige Aufgaben',
        importance: Notifications.AndroidImportance.HIGH,
        vibrationPattern: [0, 250, 250, 250],
        lightColor: '#2563EB',
      });
    }

    const existing = await Notifications.getPermissionsAsync();
    let granted = existing.granted;

    if (!granted && existing.canAskAgain) {
      const requested = await Notifications.requestPermissionsAsync();
      granted = requested.granted;
    }

    if (!granted) return { status: 'denied' };

    const { data: token } = await Notifications.getExpoPushTokenAsync({
      projectId: env.easProjectId,
    });

    // onConflict 'token' means reinstalling or switching accounts updates the
    // existing row instead of accumulating duplicates, and clearing
    // disabled_at revives a token household-tick had previously pruned.
    const { error } = await supabase.from('push_tokens').upsert(
      {
        household_id: householdId,
        profile_id: profileId,
        token,
        platform: Platform.OS === 'ios' ? 'ios' : 'android',
        device_name: Device.deviceName ?? Device.modelName,
        last_seen_at: new Date().toISOString(),
        disabled_at: null,
      },
      { onConflict: 'token' },
    );

    if (error) return { status: 'error', message: error.message };

    return { status: 'registered', token };
  } catch (err) {
    return { status: 'error', message: String(err) };
  }
}

export const pushStatusMessage: Record<PushRegistrationResult['status'], string> = {
  registered: 'Erinnerungen sind aktiv.',
  denied: 'Benachrichtigungen sind in den Systemeinstellungen deaktiviert.',
  simulator: 'Push funktioniert nur auf einem echten Gerät.',
  'expo-go': 'Push funktioniert nicht in Expo Go — dafür wird ein Development Build gebraucht.',
  unconfigured: 'EXPO_PUBLIC_EAS_PROJECT_ID fehlt in der .env.',
  error: 'Registrierung fehlgeschlagen.',
};

/** Stops reminders for this device without touching the other one. */
export async function disablePushToken(token: string): Promise<void> {
  await supabase
    .from('push_tokens')
    .update({ disabled_at: new Date().toISOString() })
    .eq('token', token);
}
