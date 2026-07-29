import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import type { TodoRow } from '../../lib/database.types';
import { useHouseholdId } from '../auth/AuthProvider';
import * as api from './api';

export function useTodos() {
  const householdId = useHouseholdId();
  return useQuery({
    queryKey: ['todos', householdId],
    queryFn: () => api.fetchTodos(householdId),
  });
}

export function useAddTodo() {
  const householdId = useHouseholdId();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: { title: string; assigneeId?: string | null; dueDate?: string | null }) => {
      const existing = queryClient.getQueryData<TodoRow[]>(['todos', householdId]) ?? [];
      // Fractional position: new items go to the top without renumbering.
      const minPosition = existing.reduce((min, t) => Math.min(min, t.position), 0);

      return api.addTodo({ householdId, position: minPosition - 1, ...input });
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: ['todos'] }),
  });
}

/**
 * Optimistic: the checkbox flips instantly. Realtime then delivers the
 * authoritative row (including who ticked it) to both phones.
 */
export function useToggleTodo() {
  const householdId = useHouseholdId();
  const queryClient = useQueryClient();
  const queryKey = ['todos', householdId];

  return useMutation({
    mutationFn: ({ id, isDone }: { id: string; isDone: boolean }) => api.setTodoDone(id, isDone),

    async onMutate({ id, isDone }) {
      await queryClient.cancelQueries({ queryKey });
      const previous = queryClient.getQueryData<TodoRow[]>(queryKey);

      queryClient.setQueryData<TodoRow[]>(queryKey, (rows) =>
        (rows ?? []).map((row) => (row.id === id ? { ...row, is_done: isDone } : row)),
      );

      return { previous };
    },

    onError(_err, _vars, context) {
      if (context?.previous) queryClient.setQueryData(queryKey, context.previous);
    },

    onSettled: () => queryClient.invalidateQueries({ queryKey: ['todos'] }),
  });
}

export function useUpdateTodo() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: Parameters<typeof api.updateTodo>[1] }) =>
      api.updateTodo(id, patch),
    onSettled: () => queryClient.invalidateQueries({ queryKey: ['todos'] }),
  });
}

export function useDeleteTodo() {
  const householdId = useHouseholdId();
  const queryClient = useQueryClient();
  const queryKey = ['todos', householdId];

  return useMutation({
    mutationFn: (id: string) => api.deleteTodo(id),

    async onMutate(id) {
      await queryClient.cancelQueries({ queryKey });
      const previous = queryClient.getQueryData<TodoRow[]>(queryKey);
      queryClient.setQueryData<TodoRow[]>(queryKey, (rows) => (rows ?? []).filter((r) => r.id !== id));
      return { previous };
    },

    onError(_err, _id, context) {
      if (context?.previous) queryClient.setQueryData(queryKey, context.previous);
    },

    onSettled: () => queryClient.invalidateQueries({ queryKey: ['todos'] }),
  });
}

export function useClearCompleted() {
  const householdId = useHouseholdId();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: () => api.clearCompleted(householdId),
    onSettled: () => queryClient.invalidateQueries({ queryKey: ['todos'] }),
  });
}
