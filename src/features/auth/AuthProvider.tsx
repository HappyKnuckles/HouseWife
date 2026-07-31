import type { Session } from '@supabase/supabase-js';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';

import type { ProfileRow } from '../../lib/database.types';
import { useHouseholdRealtime } from '../../lib/realtime';
import { supabase } from '../../lib/supabase';

interface AuthContextValue {
  session: Session | null;
  profile: ProfileRow | null;
  householdId: string | null;
  /** True until the stored session has been read from disk. */
  initializing: boolean;
  profileLoading: boolean;
  signIn: (email: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [initializing, setInitializing] = useState(true);
  const queryClient = useQueryClient();

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setInitializing(false);
    });

    const { data: sub } = supabase.auth.onAuthStateChange((_event, next) => {
      setSession(next);
      // Never let one account see the previous account's cached rows.
      queryClient.clear();
    });

    return () => sub.subscription.unsubscribe();
  }, [queryClient]);

  const userId = session?.user.id ?? null;

  const { data: profile, isLoading: profileLoading } = useQuery({
    queryKey: ['household', 'profile', userId],
    enabled: !!userId,
    queryFn: async (): Promise<ProfileRow | null> => {
      const { data, error } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', userId!)
        .maybeSingle();

      if (error) throw error;
      return data;
    },
  });

  const householdId = profile?.household_id ?? null;

  // One websocket for the whole app, opened as soon as we know the household.
  useHouseholdRealtime(householdId);

  const value = useMemo<AuthContextValue>(
    () => ({
      session,
      profile: profile ?? null,
      householdId,
      initializing,
      profileLoading,
      async signIn(email, password) {
        const { error } = await supabase.auth.signInWithPassword({
          email: email.trim(),
          password,
        });
        if (error) throw error;
      },
      async signOut() {
        await supabase.auth.signOut();
      },
    }),
    [session, profile, householdId, initializing, profileLoading],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>');
  return ctx;
}

/**
 * For screens that only render once a household exists. Throwing here beats
 * threading `string | null` through every query key in the app.
 */
export function useHouseholdId(): string {
  const { householdId } = useAuth();
  if (!householdId) throw new Error('useHouseholdId used outside a household-scoped screen');
  return householdId;
}
