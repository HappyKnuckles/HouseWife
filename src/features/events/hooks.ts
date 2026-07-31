import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { useHouseholdId } from '../auth/AuthProvider';
import * as api from './api';

export function useEvents() {
  const householdId = useHouseholdId();
  return useQuery({
    queryKey: ['events', householdId],
    queryFn: () => api.fetchEvents(householdId),
  });
}

export function useCreateEvent() {
  const householdId = useHouseholdId();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: api.EventInput) => api.createEvent(householdId, input),
    onSettled: () => queryClient.invalidateQueries({ queryKey: ['events'] }),
  });
}

export function useUpdateEvent() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: api.EventInput }) => api.updateEvent(id, input),
    onSettled: () => queryClient.invalidateQueries({ queryKey: ['events'] }),
  });
}

export function useDeleteEvent() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.deleteEvent(id),
    onSettled: () => queryClient.invalidateQueries({ queryKey: ['events'] }),
  });
}
