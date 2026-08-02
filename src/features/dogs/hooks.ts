import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import type { DogCommandRow } from '../../lib/database.types';
import { useHouseholdId } from '../auth/AuthProvider';
import * as api from './api';

export function useDogCommands() {
  const householdId = useHouseholdId();
  return useQuery({
    queryKey: ['dog-commands', householdId],
    queryFn: () => api.fetchCommands(householdId),
  });
}

export function useAddDogCommand() {
  const householdId = useHouseholdId();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: { command: string; description?: string | null }) =>
      api.addCommand({ householdId, ...input }),
    onSettled: () => queryClient.invalidateQueries({ queryKey: ['dog-commands'] }),
  });
}

export function useUpdateDogCommand() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: Parameters<typeof api.updateCommand>[1] }) =>
      api.updateCommand(id, patch),
    onSettled: () => queryClient.invalidateQueries({ queryKey: ['dog-commands'] }),
  });
}

/** Optimistic, like every other delete in the app: the row goes at once. */
export function useDeleteDogCommand() {
  const householdId = useHouseholdId();
  const queryClient = useQueryClient();
  const queryKey = ['dog-commands', householdId];

  return useMutation({
    mutationFn: (id: string) => api.deleteCommand(id),

    async onMutate(id) {
      await queryClient.cancelQueries({ queryKey });
      const previous = queryClient.getQueryData<DogCommandRow[]>(queryKey);
      queryClient.setQueryData<DogCommandRow[]>(queryKey, (rows) =>
        (rows ?? []).filter((row) => row.id !== id),
      );
      return { previous };
    },

    onError(_err, _id, context) {
      if (context?.previous) queryClient.setQueryData(queryKey, context.previous);
    },

    onSettled: () => queryClient.invalidateQueries({ queryKey: ['dog-commands'] }),
  });
}
