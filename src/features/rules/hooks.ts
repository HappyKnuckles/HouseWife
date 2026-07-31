import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import type { HouseRuleRow } from '../../lib/database.types';
import { useHouseholdId } from '../auth/AuthProvider';
import * as api from './api';

export function useRules() {
  const householdId = useHouseholdId();
  return useQuery({
    queryKey: ['rules', householdId],
    queryFn: () => api.fetchRules(householdId),
  });
}

export function useAddRule() {
  const householdId = useHouseholdId();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (text: string) => {
      const existing = queryClient.getQueryData<HouseRuleRow[]>(['rules', householdId]) ?? [];
      // Appended, not prepended like a to-do: a rule list is read top to
      // bottom and "Regel 1" should keep meaning the same rule.
      const maxPosition = existing.reduce((max, rule) => Math.max(max, rule.position), 0);

      return api.addRule({ householdId, text, position: maxPosition + 1 });
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: ['rules'] }),
  });
}

export function useUpdateRule() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, text }: { id: string; text: string }) => api.updateRule(id, { text }),
    onSettled: () => queryClient.invalidateQueries({ queryKey: ['rules'] }),
  });
}

export function useDeleteRule() {
  const householdId = useHouseholdId();
  const queryClient = useQueryClient();
  const queryKey = ['rules', householdId];

  return useMutation({
    mutationFn: (id: string) => api.deleteRule(id),

    async onMutate(id) {
      await queryClient.cancelQueries({ queryKey });
      const previous = queryClient.getQueryData<HouseRuleRow[]>(queryKey);
      queryClient.setQueryData<HouseRuleRow[]>(queryKey, (rows) =>
        (rows ?? []).filter((row) => row.id !== id),
      );
      return { previous };
    },

    onError(_err, _id, context) {
      if (context?.previous) queryClient.setQueryData(queryKey, context.previous);
    },

    onSettled: () => queryClient.invalidateQueries({ queryKey: ['rules'] }),
  });
}

/**
 * Optimistic: the row jumps immediately. The numbers beside the rules are
 * positions in the list, so waiting a round-trip to see them change makes the
 * buttons feel broken.
 */
export function useMoveRule() {
  const householdId = useHouseholdId();
  const queryClient = useQueryClient();
  const queryKey = ['rules', householdId];

  return useMutation({
    mutationFn: ({ id, direction }: { id: string; direction: 'up' | 'down' }) =>
      api.moveRule(id, direction),

    async onMutate({ id, direction }) {
      await queryClient.cancelQueries({ queryKey });
      const previous = queryClient.getQueryData<HouseRuleRow[]>(queryKey);

      queryClient.setQueryData<HouseRuleRow[]>(queryKey, (rows) => {
        const next = [...(rows ?? [])];
        const index = next.findIndex((row) => row.id === id);
        const target = direction === 'up' ? index - 1 : index + 1;
        if (index < 0 || target < 0 || target >= next.length) return next;

        [next[index], next[target]] = [next[target], next[index]];
        return next;
      });

      return { previous };
    },

    onError(_err, _vars, context) {
      if (context?.previous) queryClient.setQueryData(queryKey, context.previous);
    },

    onSettled: () => queryClient.invalidateQueries({ queryKey: ['rules'] }),
  });
}
