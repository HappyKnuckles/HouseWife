import * as Crypto from 'expo-crypto';
import { File } from 'expo-file-system';

import type {
  ExpenseItemInput,
  ExpenseItemRow,
  ExpenseRow,
  ExpenseShareInput,
  ExpenseShareRow,
  HouseholdBalanceRow,
  ReceiptRow,
  SettlementMethod,
  SplitType,
} from '../../lib/database.types';
import { supabase } from '../../lib/supabase';

export interface ExpenseWithDetails extends ExpenseRow {
  expense_items: ExpenseItemRow[];
  expense_shares: ExpenseShareRow[];
  receipts: ReceiptRow[];
}

export async function fetchExpenses(
  householdId: string,
  status?: 'open' | 'settled',
): Promise<ExpenseWithDetails[]> {
  let query = supabase
    .from('expenses')
    .select('*, expense_items(*), expense_shares(*), receipts(*)')
    .eq('household_id', householdId)
    .order('purchased_at', { ascending: false })
    .limit(200);

  if (status) query = query.eq('status', status);

  const { data, error } = await query;
  if (error) throw error;
  return (data ?? []) as unknown as ExpenseWithDetails[];
}

export async function fetchExpense(expenseId: string): Promise<ExpenseWithDetails | null> {
  const { data, error } = await supabase
    .from('expenses')
    .select('*, expense_items(*), expense_shares(*), receipts(*)')
    .eq('id', expenseId)
    .maybeSingle();

  if (error) throw error;
  return data as unknown as ExpenseWithDetails | null;
}

export async function fetchBalances(householdId: string): Promise<HouseholdBalanceRow[]> {
  const { data, error } = await supabase
    .from('v_household_balances')
    .select('*')
    .eq('household_id', householdId);

  if (error) throw error;
  return data ?? [];
}

export interface CreateExpenseInput {
  title: string;
  totalCents: number;
  paidBy: string;
  splitType: SplitType;
  purchasedAt?: string;
  note?: string | null;
  category?: string | null;
  items?: ExpenseItemInput[];
  shares?: ExpenseShareInput[] | null;
}

/**
 * Always an RPC, never a plain insert.
 *
 * expense_shares must balance against expenses.total_cents at COMMIT, and
 * PostgREST is one statement per request — so writing the expense and its
 * shares as two calls can never be one transaction and would always fail the
 * constraint. The RPC does both atomically.
 */
export async function createExpense(input: CreateExpenseInput): Promise<ExpenseRow> {
  const { data, error } = await supabase.rpc('create_expense', {
    p_title: input.title,
    p_total_cents: input.totalCents,
    p_paid_by: input.paidBy,
    p_split_type: input.splitType,
    p_purchased_at: input.purchasedAt ?? new Date().toISOString(),
    p_note: input.note ?? null,
    p_category: input.category ?? null,
    p_items: input.items ?? [],
    p_shares: input.shares ?? null,
  });

  if (error) throw error;
  return data as ExpenseRow;
}

export async function updateExpense(
  expenseId: string,
  input: Partial<CreateExpenseInput>,
): Promise<ExpenseRow> {
  const { data, error } = await supabase.rpc('update_expense', {
    p_expense_id: expenseId,
    p_title: input.title ?? null,
    p_total_cents: input.totalCents ?? null,
    p_paid_by: input.paidBy ?? null,
    p_split_type: input.splitType ?? null,
    p_purchased_at: input.purchasedAt ?? null,
    p_note: input.note ?? null,
    p_category: input.category ?? null,
    p_items: input.items ?? [],
    p_shares: input.shares ?? null,
  });

  if (error) throw error;
  return data as ExpenseRow;
}

export async function deleteExpense(expenseId: string): Promise<void> {
  const { error } = await supabase.from('expenses').delete().eq('id', expenseId);
  if (error) throw error;
}

/** Closes the given expenses (or every open one) and records the transfer. */
export async function settleUp(
  expenseIds: string[] | null,
  method: SettlementMethod,
  note?: string,
): Promise<string | null> {
  const { data, error } = await supabase.rpc('settle_up', {
    p_expense_ids: expenseIds,
    p_method: method,
    p_note: note ?? null,
  });

  if (error) throw error;
  return data as string | null;
}

export async function fetchSettlements(householdId: string) {
  const { data, error } = await supabase
    .from('settlements')
    .select('*')
    .eq('household_id', householdId)
    .order('settled_at', { ascending: false })
    .limit(50);

  if (error) throw error;
  return data ?? [];
}

// ---------------------------------------------------------------------------
// Receipts
// ---------------------------------------------------------------------------

/**
 * Uploads a receipt image and records its metadata.
 *
 * The path layout `{household_id}/{expense_id}/{uuid}.{ext}` is load-bearing:
 * the storage.objects policies authorise on the first path segment, and
 * public.receipts has a CHECK constraint that the metadata row agrees. Change
 * this and uploads start failing with a permission error.
 */
export async function uploadReceipt(params: {
  householdId: string;
  expenseId: string;
  uri: string;
  mimeType?: string;
  width?: number;
  height?: number;
}): Promise<ReceiptRow> {
  const mimeType = params.mimeType ?? 'image/jpeg';
  const extension = mimeType.includes('png') ? 'png' : mimeType.includes('webp') ? 'webp' : 'jpg';
  const path = `${params.householdId}/${params.expenseId}/${Crypto.randomUUID()}.${extension}`;

  const file = new File(params.uri);
  const bytes = await file.bytes();

  const { error: uploadError } = await supabase.storage
    .from('receipts')
    .upload(path, bytes, { contentType: mimeType, upsert: false });

  if (uploadError) throw uploadError;

  const { data, error } = await supabase
    .from('receipts')
    .insert({
      household_id: params.householdId,
      expense_id: params.expenseId,
      storage_path: path,
      mime_type: mimeType,
      size_bytes: bytes.byteLength,
      width: params.width ?? null,
      height: params.height ?? null,
    })
    .select()
    .single();

  if (error) throw error;
  return data;
}

/** Receipts live in a private bucket, so display needs a short-lived URL. */
export async function signedReceiptUrl(storagePath: string, expiresIn = 3600): Promise<string> {
  const { data, error } = await supabase.storage
    .from('receipts')
    .createSignedUrl(storagePath, expiresIn);

  if (error) throw error;
  return data.signedUrl;
}

export async function deleteReceipt(receipt: ReceiptRow): Promise<void> {
  await supabase.storage.from('receipts').remove([receipt.storage_path]);
  const { error } = await supabase.from('receipts').delete().eq('id', receipt.id);
  if (error) throw error;
}
