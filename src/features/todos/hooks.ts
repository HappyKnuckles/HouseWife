import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import type { TodoList, TodoRow } from '../../lib/database.types';
import { useHouseholdId } from '../auth/AuthProvider';
import * as api from './api';

/**
 * Every hook here takes the list it operates on.
 *
 * The two screens (To-dos and Einkaufsliste) are the same machinery over the
 * same table, so they share these hooks — but they must not share a cache
 * entry, or ticking off "Mehl kaufen" would flicker through the to-do list.
 * The list is therefore part of the query key, and ['todos'] stays a prefix of
 * both so one realtime event still refetches whichever screen is open.
 */
const keyFor = (householdId: string, list: TodoList) => ['todos', householdId, list];

export function useTodos(list: TodoList) {
  const householdId = useHouseholdId();
  return useQuery({
    queryKey: keyFor(householdId, list),
    queryFn: () => api.fetchTodos(householdId, list),
  });
}

export function useAddTodo(list: TodoList) {
  const householdId = useHouseholdId();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: { title: string; assigneeId?: string | null; dueDate?: string | null }) => {
      const existing = queryClient.getQueryData<TodoRow[]>(keyFor(householdId, list)) ?? [];
      // Fractional position: new items go to the top without renumbering.
      const minPosition = existing.reduce((min, t) => Math.min(min, t.position), 0);

      return api.addTodo({ householdId, list, position: minPosition - 1, ...input });
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: ['todos'] }),
  });
}

/**
 * Optimistic: the checkbox flips instantly. Realtime then delivers the
 * authoritative row (including who ticked it) to both phones.
 */
export function useToggleTodo(list: TodoList) {
  const householdId = useHouseholdId();
  const queryClient = useQueryClient();
  const queryKey = keyFor(householdId, list);

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

/**
 * Optimistic, because it is a stepper: waiting a round trip per tap makes
 * "three of those" feel like fighting the app rather than counting.
 */
export function useSetQuantity(list: TodoList) {
  const householdId = useHouseholdId();
  const queryClient = useQueryClient();
  const queryKey = keyFor(householdId, list);

  return useMutation({
    mutationFn: ({ id, quantity }: { id: string; quantity: number }) =>
      api.updateTodo(id, { quantity }),

    async onMutate({ id, quantity }) {
      await queryClient.cancelQueries({ queryKey });
      const previous = queryClient.getQueryData<TodoRow[]>(queryKey);
      queryClient.setQueryData<TodoRow[]>(queryKey, (rows) =>
        (rows ?? []).map((row) => (row.id === id ? { ...row, quantity } : row)),
      );
      return { previous };
    },

    onError(_err, _vars, context) {
      if (context?.previous) queryClient.setQueryData(queryKey, context.previous);
    },

    onSettled: () => queryClient.invalidateQueries({ queryKey: ['todos'] }),
  });
}

export function useDeleteTodo(list: TodoList) {
  const householdId = useHouseholdId();
  const queryClient = useQueryClient();
  const queryKey = keyFor(householdId, list);

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

export function useClearCompleted(list: TodoList) {
  const householdId = useHouseholdId();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: () => api.clearCompleted(householdId, list),
    onSettled: () => queryClient.invalidateQueries({ queryKey: ['todos'] }),
  });
}

/**
 * What this household buys, for the one-tap re-add row.
 *
 * Its own key rather than a slice of ['todos', …]: it is derived from ticked
 * *and* cleared rows plus every itemised receipt, so it does not change when
 * the visible list does — only when something is actually bought.
 */
export function useShoppingSuggestions() {
  const householdId = useHouseholdId();
  return useQuery({
    queryKey: ['todos', 'suggestions', householdId],
    queryFn: () => api.fetchShoppingSuggestions(householdId),
  });
}

export function useShoppingHistory() {
  const householdId = useHouseholdId();
  return useQuery({
    queryKey: ['todos', 'history', householdId],
    queryFn: () => api.fetchShoppingHistory(householdId),
  });
}

/** Closes a finished shop, optionally stamping the expense it produced. */
export function useCloseShoppingRows() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { ids: string[]; expenseId?: string | null }) =>
      api.closeShoppingRows(input),
    onSettled: () => queryClient.invalidateQueries({ queryKey: ['todos'] }),
  });
}

/** Deletes a whole shopping trip out of the Einkaufshistorie. See deleteTrip(). */
export function useDeleteTrip() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (todoIds: string[]) => api.deleteTrip(todoIds),
    onSettled: () => queryClient.invalidateQueries({ queryKey: ['todos'] }),
  });
}

/** Attaches an already-closed shop to the expense it was billed into. */
export function useLinkShoppingRows() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { ids: string[]; expenseId: string }) => api.linkShoppingRows(input),
    onSettled: () => queryClient.invalidateQueries({ queryKey: ['todos'] }),
  });
}
