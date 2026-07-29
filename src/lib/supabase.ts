import 'react-native-url-polyfill/auto';

import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient } from '@supabase/supabase-js';
import { AppState } from 'react-native';

import type { Database } from './database.types';
import { env } from './env';

/**
 * The typed Supabase client. Everything in the app goes through this — there is
 * no other network layer and no custom server.
 */
export const supabase = createClient<Database>(env.supabaseUrl, env.supabaseAnonKey, {
  auth: {
    storage: AsyncStorage,
    autoRefreshToken: true,
    persistSession: true,
    // React Native has no URL to read a session back out of.
    detectSessionInUrl: false,
  },
});

/**
 * Refresh the access token only while the app is in the foreground.
 *
 * Without this the timer keeps firing in the background, burning battery and
 * occasionally racing with a suspended network stack to produce spurious
 * "Invalid Refresh Token" errors on resume.
 */
AppState.addEventListener('change', (state) => {
  if (state === 'active') {
    void supabase.auth.startAutoRefresh();
  } else {
    void supabase.auth.stopAutoRefresh();
  }
});
