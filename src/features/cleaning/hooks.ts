import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import type { CleaningAgendaRow } from '../../lib/database.types';
import { useHouseholdId } from '../auth/AuthProvider';
import * as api from './api';

export function useAgenda() {
  const householdId = useHouseholdId();
  return useQuery({
    queryKey: ['cleaning', 'agenda', householdId],
    queryFn: () => api.fetchAgenda(householdId),
  });
}

export function useTask(taskId: string) {
  return useQuery({
    queryKey: ['cleaning', 'task', taskId],
    queryFn: () => api.fetchTask(taskId),
    enabled: !!taskId,
  });
}

export function useAreas() {
  const householdId = useHouseholdId();
  return useQuery({
    queryKey: ['cleaning', 'areas', householdId],
    queryFn: () => api.fetchAreas(householdId),
  });
}

export function useCompletions(taskId: string) {
  return useQuery({
    queryKey: ['cleaning', 'completions', taskId],
    queryFn: () => api.fetchCompletions(taskId),
    enabled: !!taskId,
  });
}

export function useCleaningStats() {
  const householdId = useHouseholdId();
  return useQuery({
    queryKey: ['cleaning', 'stats', householdId],
    queryFn: () => api.fetchStats(householdId),
  });
}

/**
 * Ticking a task off is the single most-used interaction in the app, so it is
 * optimistic: the row leaves the "overdue"/"today" section the instant you tap.
 * The realtime event that follows re-syncs both phones with the authoritative
 * next_due_on and the rotated assignee.
 */
export function useCompleteTask() {
  const householdId = useHouseholdId();
  const queryClient = useQueryClient();
  const queryKey = ['cleaning', 'agenda', householdId];

  return useMutation({
    mutationFn: ({ taskId, durationMinutes }: { taskId: string; durationMinutes?: number }) =>
      api.completeTask(taskId, durationMinutes),

    async onMutate({ taskId }) {
      await queryClient.cancelQueries({ queryKey });
      const previous = queryClient.getQueryData<CleaningAgendaRow[]>(queryKey);

      queryClient.setQueryData<CleaningAgendaRow[]>(queryKey, (rows) =>
        (rows ?? []).map((row) =>
          row.id === taskId
            ? { ...row, status: 'upcoming', days_until: Math.max(row.days_until, 1) }
            : row,
        ),
      );

      return { previous };
    },

    onError(_err, _vars, context) {
      if (context?.previous) queryClient.setQueryData(queryKey, context.previous);
    },

    onSettled() {
      void queryClient.invalidateQueries({ queryKey: ['cleaning'] });
    },
  });
}

export function useUndoCompletion() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (completionId: string) => api.undoCompletion(completionId),
    onSettled: () => queryClient.invalidateQueries({ queryKey: ['cleaning'] }),
  });
}

export function useCreateTask() {
  const householdId = useHouseholdId();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: Omit<Parameters<typeof api.createTask>[0], 'household_id'>) =>
      api.createTask({ ...input, household_id: householdId }),
    onSettled: () => queryClient.invalidateQueries({ queryKey: ['cleaning'] }),
  });
}

export function useUpdateTask() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ taskId, patch }: { taskId: string; patch: Parameters<typeof api.updateTask>[1] }) =>
      api.updateTask(taskId, patch),
    onSettled: () => queryClient.invalidateQueries({ queryKey: ['cleaning'] }),
  });
}

export function useDeleteTask() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (taskId: string) => api.deleteTask(taskId),
    onSettled: () => queryClient.invalidateQueries({ queryKey: ['cleaning'] }),
  });
}

export function useCreateArea() {
  const householdId = useHouseholdId();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ name, color, icon }: { name: string; color: string; icon: string }) =>
      api.createArea(householdId, name, color, icon),
    onSettled: () => queryClient.invalidateQueries({ queryKey: ['cleaning'] }),
  });
}

/** Groups the agenda into the four sections the Putzplan screen renders. */
export function groupAgenda(rows: CleaningAgendaRow[]) {
  return {
    overdue: rows.filter((r) => r.status === 'overdue'),
    today: rows.filter((r) => r.status === 'due_today'),
    soon: rows.filter((r) => r.status === 'due_soon'),
    upcoming: rows.filter((r) => r.status === 'upcoming'),
  };
}
