import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import type { SettlementMethod } from '../../lib/database.types';
import { useAuth, useHouseholdId } from '../auth/AuthProvider';
import * as api from './api';

export function useExpenses(status?: 'open' | 'settled') {
  const householdId = useHouseholdId();
  return useQuery({
    queryKey: ['expenses', 'list', householdId, status ?? 'all'],
    queryFn: () => api.fetchExpenses(householdId, status),
  });
}

export function useExpense(expenseId: string) {
  return useQuery({
    queryKey: ['expenses', 'detail', expenseId],
    queryFn: () => api.fetchExpense(expenseId),
    enabled: !!expenseId,
  });
}

export function useBalances() {
  const householdId = useHouseholdId();
  return useQuery({
    queryKey: ['expenses', 'balances', householdId],
    queryFn: () => api.fetchBalances(householdId),
  });
}

/** The one number the overview screen leads with. */
export function useMyBalance() {
  const { profile } = useAuth();
  const { data, ...rest } = useBalances();

  const mine = data?.find((row) => row.profile_id === profile?.id) ?? null;
  const other = data?.find((row) => row.profile_id !== profile?.id) ?? null;

  return { mine, other, all: data ?? [], ...rest };
}

export function useSettlements() {
  const householdId = useHouseholdId();
  return useQuery({
    queryKey: ['expenses', 'settlements', householdId],
    queryFn: () => api.fetchSettlements(householdId),
  });
}

export function useCreateExpense() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: api.CreateExpenseInput) => api.createExpense(input),
    onSettled: () => queryClient.invalidateQueries({ queryKey: ['expenses'] }),
  });
}

export function useUpdateExpense() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: Partial<api.CreateExpenseInput> }) =>
      api.updateExpense(id, input),
    onSettled: () => queryClient.invalidateQueries({ queryKey: ['expenses'] }),
  });
}

export function useDeleteExpense() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (expenseId: string) => api.deleteExpense(expenseId),
    onSettled: () => queryClient.invalidateQueries({ queryKey: ['expenses'] }),
  });
}

export function useSettleUp() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      expenseIds,
      method,
      note,
    }: {
      expenseIds?: string[] | null;
      method: SettlementMethod;
      note?: string;
    }) => api.settleUp(expenseIds ?? null, method, note),
    onSettled: () => queryClient.invalidateQueries({ queryKey: ['expenses'] }),
  });
}

// ---------------------------------------------------------------------------
// Stats
// ---------------------------------------------------------------------------

/** `month` is the first of the month, `YYYY-MM-DD`. See monthKey() in format.ts. */
export function useCategoryMonth(month: string) {
  const householdId = useHouseholdId();
  return useQuery({
    queryKey: ['expenses', 'stats', 'category', householdId, month],
    queryFn: () => api.fetchCategoryMonth(householdId, month),
  });
}

export function useTopItems(limit = 12) {
  const householdId = useHouseholdId();
  return useQuery({
    queryKey: ['expenses', 'stats', 'top-items', householdId, limit],
    queryFn: () => api.fetchTopItems(householdId, limit),
  });
}

// ---------------------------------------------------------------------------
// Recurring expenses (Fixkosten)
// ---------------------------------------------------------------------------

export function useRecurringExpenses() {
  const householdId = useHouseholdId();
  return useQuery({
    queryKey: ['expenses', 'recurring', householdId],
    queryFn: () => api.fetchRecurringExpenses(householdId),
  });
}

export function useCreateRecurringExpense() {
  const householdId = useHouseholdId();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: Omit<api.CreateRecurringExpenseInput, 'householdId'>) =>
      api.createRecurringExpense({ householdId, ...input }),
    onSettled: () => queryClient.invalidateQueries({ queryKey: ['expenses'] }),
  });
}

export function useSetRecurringExpenseActive() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, isActive }: { id: string; isActive: boolean }) =>
      api.setRecurringExpenseActive(id, isActive),
    onSettled: () => queryClient.invalidateQueries({ queryKey: ['expenses'] }),
  });
}

export function useDeleteRecurringExpense() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.deleteRecurringExpense(id),
    onSettled: () => queryClient.invalidateQueries({ queryKey: ['expenses'] }),
  });
}

export function useUploadReceipt() {
  const householdId = useHouseholdId();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (params: { expenseId: string; uri: string; mimeType?: string; width?: number; height?: number }) =>
      api.uploadReceipt({ householdId, ...params }),
    onSettled: () => queryClient.invalidateQueries({ queryKey: ['expenses'] }),
  });
}

export function useSignedReceiptUrl(storagePath: string | null | undefined) {
  return useQuery({
    queryKey: ['expenses', 'receipt-url', storagePath],
    queryFn: () => api.signedReceiptUrl(storagePath!),
    enabled: !!storagePath,
    // Signed URLs expire after an hour; refresh a little before that.
    staleTime: 50 * 60 * 1000,
  });
}
