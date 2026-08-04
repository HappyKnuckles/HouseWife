import type { ShoppingSuggestionRow, TodoList, TodoRow } from '../../lib/database.types';
import { supabase } from '../../lib/supabase';

/**
 * One table, two lists.
 *
 * `list` is a required argument everywhere rather than an optional filter: the
 * to-do screen and the Einkaufsliste each own exactly one of them, and a query
 * that forgot to say which would quietly show the other list's rows. See
 * migration 0024.
 */
export async function fetchTodos(householdId: string, list: TodoList): Promise<TodoRow[]> {
  const { data, error } = await supabase
    .from('todos')
    .select('*')
    // Cleared rows are history, not list content — see migration 0028.
    .is('cleared_at', null)
    .eq('household_id', householdId)
    .eq('list', list)
    .order('is_done', { ascending: true })
    .order('position', { ascending: true })
    .order('created_at', { ascending: false });

  if (error) throw error;
  return data ?? [];
}

export async function addTodo(input: {
  householdId: string;
  list: TodoList;
  title: string;
  assigneeId?: string | null;
  dueDate?: string | null;
  notes?: string | null;
  position: number;
}): Promise<TodoRow> {
  const { data, error } = await supabase
    .from('todos')
    .insert({
      household_id: input.householdId,
      list: input.list,
      title: input.title.trim(),
      assignee_id: input.assigneeId ?? null,
      due_date: input.dueDate ?? null,
      notes: input.notes ?? null,
      position: input.position,
    })
    .select()
    .single();

  if (error) throw error;
  return data;
}

/**
 * Only `is_done` is written — done_at and done_by are stamped by a trigger, so
 * the checkbox stays a genuine single-column update and two phones toggling at
 * once cannot disagree about who ticked it.
 */
export async function setTodoDone(todoId: string, isDone: boolean): Promise<TodoRow> {
  const { data, error } = await supabase
    .from('todos')
    .update({ is_done: isDone })
    .eq('id', todoId)
    .select()
    .single();

  if (error) throw error;
  return data;
}

export async function updateTodo(
  todoId: string,
  patch: Partial<
    Pick<
      TodoRow,
      'title' | 'notes' | 'assignee_id' | 'due_date' | 'position' | 'quantity' | 'product_id'
    >
  >,
): Promise<TodoRow> {
  const { data, error } = await supabase.from('todos').update(patch).eq('id', todoId).select().single();
  if (error) throw error;
  return data;
}

export async function deleteTodo(todoId: string): Promise<void> {
  const { error } = await supabase.from('todos').delete().eq('id', todoId);
  if (error) throw error;
}

/**
 * Clears the done rows off one list.
 *
 * An UPDATE, not a DELETE. What this household buys and how often is the one
 * thing only the shopping list knows, and until migration 0028 it was destroyed
 * every time someone tidied up. Deleting a single row by hand stays a real
 * delete — that means "I never wanted this", which is not a purchase.
 *
 * Scoped to one list: clearing the shopping must not empty the to-dos.
 */
export async function clearCompleted(householdId: string, list: TodoList): Promise<void> {
  const { error } = await supabase
    .from('todos')
    .update({ cleared_at: new Date().toISOString() })
    .eq('household_id', householdId)
    .eq('list', list)
    .eq('is_done', true)
    .is('cleared_at', null);

  if (error) throw error;
}

/** What this household buys: how often, how long ago, at what price. */
export async function fetchShoppingSuggestions(
  householdId: string,
): Promise<ShoppingSuggestionRow[]> {
  const { data, error } = await supabase
    .from('v_shopping_suggestions')
    .select('*')
    .eq('household_id', householdId)
    .order('times_bought', { ascending: false })
    .order('times_paid', { ascending: false })
    .limit(60);

  if (error) throw error;
  return data ?? [];
}

/**
 * Past purchases, newest first — one row per thing bought.
 *
 * Only closed rows. A ticked row that has not been through "Einkauf
 * abschließen" is still shopping in progress and belongs on the list, not in
 * the history; `cleared_at` is exactly the line between the two.
 */
export async function fetchShoppingHistory(householdId: string, limit = 200): Promise<TodoRow[]> {
  const { data, error } = await supabase
    .from('todos')
    .select('*')
    .eq('household_id', householdId)
    .eq('list', 'shopping')
    .eq('is_done', true)
    .not('done_at', 'is', null)
    .not('cleared_at', 'is', null)
    .order('done_at', { ascending: false })
    .limit(limit);

  if (error) throw error;
  return data ?? [];
}

/**
 * Closes a finished shop: the rows leave the list, and carry the expense they
 * were billed into if there was one.
 *
 * One statement rather than one per row — half a closed shop would be a list
 * that lies in both directions at once.
 */
export async function closeShoppingRows(input: {
  ids: string[];
  expenseId?: string | null;
}): Promise<void> {
  if (input.ids.length === 0) return;

  const { error } = await supabase
    .from('todos')
    .update({
      cleared_at: new Date().toISOString(),
      ...(input.expenseId ? { expense_id: input.expenseId } : {}),
    })
    .in('id', input.ids);

  if (error) throw error;
}

/**
 * Attaches a shop to the expense it turned out to be.
 *
 * Separate from closeShoppingRows() because it runs on rows that are already
 * closed: paying is allowed to happen days after the shopping was put away,
 * and re-stamping `cleared_at` would move when the list was tidied to when
 * somebody got round to the money.
 */
export async function linkShoppingRows(input: {
  ids: string[];
  expenseId: string;
}): Promise<void> {
  if (input.ids.length === 0) return;

  const { error } = await supabase
    .from('todos')
    .update({ expense_id: input.expenseId })
    .in('id', input.ids);

  if (error) throw error;
}
