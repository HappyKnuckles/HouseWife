import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo } from 'react';

import { useAuth, useHouseholdId } from '../auth/AuthProvider';
import * as api from './api';

export function useHousehold() {
  const householdId = useHouseholdId();
  return useQuery({
    queryKey: ['household', 'detail', householdId],
    queryFn: () => api.fetchHousehold(householdId),
  });
}

/**
 * The household's members, `color` and all, straight from profiles.
 *
 * Deliberately not derived from the theme accent, which was tried and undone:
 * a person's color reaches the screen by two completely separate routes — this
 * hook, and the denormalised `assignee_color` that v_cleaning_agenda joins in
 * for the Putzplan. Only one of them passes through here, so anything computed
 * client-side shows up on some screens and not others. profiles.color is the
 * one value both routes read, which makes it the only place a person's color
 * can actually live. Settings writes it; see PROFILE_COLORS.
 */
export function useMembers() {
  const householdId = useHouseholdId();
  return useQuery({
    queryKey: ['household', 'members', householdId],
    queryFn: () => api.fetchMembers(householdId),
  });
}

/** Members keyed by id — every screen that renders a name needs this. */
export function useMemberMap() {
  const { data } = useMembers();
  return useMemo(() => Object.fromEntries((data ?? []).map((m) => [m.id, m])), [data]);
}

export function useCreateHousehold() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ name, timezone }: { name: string; timezone?: string }) =>
      api.createHousehold(name, timezone),
    onSuccess: () => queryClient.invalidateQueries(),
  });
}

export function useAcceptInvite() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (code: string) => api.acceptInvite(code),
    onSuccess: () => queryClient.invalidateQueries(),
  });
}

export function useCreateInvite() {
  return useMutation({ mutationFn: () => api.createInvite() });
}

export function useUpdateProfile() {
  const { profile } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (patch: Parameters<typeof api.updateProfile>[1]) =>
      api.updateProfile(profile!.id, patch),
    // The same four keys realtime.ts invalidates for a `profiles` change, and
    // for the same reason: a name and a color are denormalised into views this
    // household reads everywhere — v_cleaning_agenda carries assignee_name and
    // assignee_color outright. Invalidating only ['household'] repainted the
    // members list and left the Putzplan on the old color until something else
    // happened to refetch it. Doing it here as well as over the socket means
    // your own tap is not waiting on a round trip through Realtime to show.
    onSettled: () =>
      Promise.all(
        [['household'], ['cleaning'], ['expenses'], ['todos']].map((queryKey) =>
          queryClient.invalidateQueries({ queryKey }),
        ),
      ),
  });
}

export function useUpdateHousehold() {
  const householdId = useHouseholdId();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (patch: Parameters<typeof api.updateHousehold>[1]) =>
      api.updateHousehold(householdId, patch),
    onSettled: () => queryClient.invalidateQueries({ queryKey: ['household'] }),
  });
}

export function useLastHeartbeat() {
  return useQuery({
    queryKey: ['household', 'heartbeat'],
    queryFn: api.fetchLastHeartbeat,
    refetchInterval: 5 * 60 * 1000,
  });
}
