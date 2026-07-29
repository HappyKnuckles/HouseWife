import type { TodoRow } from '../../lib/database.types';
import { supabase } from '../../lib/supabase';

export async function fetchTodos(householdId: string): Promise<TodoRow[]> {
  const { data, error } = await supabase
    .from('todos')
    .select('*')
    .eq('household_id', householdId)
    .order('is_done', { ascending: true })
    .order('position', { ascending: true })
    .order('created_at', { ascending: false });

  if (error) throw error;
  return data ?? [];
}

export async function addTodo(input: {
  householdId: string;
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
  patch: Partial<Pick<TodoRow, 'title' | 'notes' | 'assignee_id' | 'due_date' | 'position'>>,
): Promise<TodoRow> {
  const { data, error } = await supabase.from('todos').update(patch).eq('id', todoId).select().single();
  if (error) throw error;
  return data;
}

export async function deleteTodo(todoId: string): Promise<void> {
  const { error } = await supabase.from('todos').delete().eq('id', todoId);
  if (error) throw error;
}

export async function clearCompleted(householdId: string): Promise<void> {
  const { error } = await supabase
    .from('todos')
    .delete()
    .eq('household_id', householdId)
    .eq('is_done', true);

  if (error) throw error;
}
