import type { HouseholdRow, ProfileRow } from '../../lib/database.types';
import { supabase } from '../../lib/supabase';

export async function fetchHousehold(householdId: string): Promise<HouseholdRow | null> {
  const { data, error } = await supabase
    .from('households')
    .select('*')
    .eq('id', householdId)
    .maybeSingle();

  if (error) throw error;
  return data;
}

export async function fetchMembers(householdId: string): Promise<ProfileRow[]> {
  const { data, error } = await supabase
    .from('profiles')
    .select('*')
    .eq('household_id', householdId)
    .order('display_name', { ascending: true });

  if (error) throw error;
  return data ?? [];
}

/**
 * Creates the household, links the caller and seeds a starter Putzplan — all in
 * one transaction, so a failure cannot leave an orphan household that nobody
 * is a member of and therefore nobody can see or delete.
 */
export async function createHousehold(name: string, timezone?: string): Promise<string> {
  const { data, error } = await supabase.rpc('create_household', {
    p_name: name,
    p_timezone: timezone ?? 'Europe/Berlin',
  });

  if (error) throw error;
  return data as string;
}

export async function createInvite(): Promise<string> {
  const { data, error } = await supabase.rpc('create_invite', {});
  if (error) throw error;
  return data as string;
}

export async function acceptInvite(code: string): Promise<string> {
  const { data, error } = await supabase.rpc('accept_invite', { p_code: code.toUpperCase() });
  if (error) throw error;
  return data as string;
}

export async function updateProfile(
  profileId: string,
  patch: { display_name?: string; color?: string; avatar_url?: string | null },
) {
  const { data, error } = await supabase
    .from('profiles')
    .update(patch)
    .eq('id', profileId)
    .select()
    .single();

  if (error) throw error;
  return data;
}

export async function updateHousehold(
  householdId: string,
  patch: { name?: string; reminder_hour?: number; notify_both_on_overdue?: boolean; timezone?: string },
) {
  const { data, error } = await supabase
    .from('households')
    .update(patch)
    .eq('id', householdId)
    .select()
    .single();

  if (error) throw error;
  return data;
}

/** Cron health. If the newest row is hours old, reminders are not running. */
export async function fetchLastHeartbeat() {
  const { data, error } = await supabase
    .from('system_heartbeat')
    .select('*')
    .order('ran_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) throw error;
  return data;
}
