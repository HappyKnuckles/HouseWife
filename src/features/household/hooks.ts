import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { useAuth, useHouseholdId } from '../auth/AuthProvider';
import * as api from './api';

export function useHousehold() {
  const householdId = useHouseholdId();
  return useQuery({
    queryKey: ['household', 'detail', householdId],
    queryFn: () => api.fetchHousehold(householdId),
  });
}

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
  return Object.fromEntries((data ?? []).map((m) => [m.id, m]));
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
    onSettled: () => queryClient.invalidateQueries({ queryKey: ['household'] }),
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
