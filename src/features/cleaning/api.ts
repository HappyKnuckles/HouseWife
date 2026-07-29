import type {
  CleaningAgendaRow,
  CleaningAreaRow,
  CleaningCompletionRow,
  CleaningStatsRow,
  CleaningTaskRow,
  Database,
} from '../../lib/database.types';
import { supabase } from '../../lib/supabase';

type TaskInsert = Database['public']['Tables']['cleaning_tasks']['Insert'];
type TaskUpdate = Database['public']['Tables']['cleaning_tasks']['Update'];

/**
 * The agenda screen reads the view, not the table: `status` and `days_until`
 * are computed in the household's own timezone by Postgres, so a task cannot
 * turn red at a different moment on two phones in two different places.
 */
export async function fetchAgenda(householdId: string): Promise<CleaningAgendaRow[]> {
  const { data, error } = await supabase
    .from('v_cleaning_agenda')
    .select('*')
    .eq('household_id', householdId)
    .eq('is_active', true)
    .order('next_due_on', { ascending: true })
    .order('sort_order', { ascending: true });

  if (error) throw error;
  return data ?? [];
}

export async function fetchTask(taskId: string): Promise<CleaningAgendaRow | null> {
  const { data, error } = await supabase
    .from('v_cleaning_agenda')
    .select('*')
    .eq('id', taskId)
    .maybeSingle();

  if (error) throw error;
  return data;
}

export async function fetchAreas(householdId: string): Promise<CleaningAreaRow[]> {
  const { data, error } = await supabase
    .from('cleaning_areas')
    .select('*')
    .eq('household_id', householdId)
    .order('sort_order', { ascending: true });

  if (error) throw error;
  return data ?? [];
}

export async function fetchCompletions(taskId: string, limit = 20): Promise<CleaningCompletionRow[]> {
  const { data, error } = await supabase
    .from('cleaning_completions')
    .select('*')
    .eq('task_id', taskId)
    .order('completed_at', { ascending: false })
    .limit(limit);

  if (error) throw error;
  return data ?? [];
}

export async function fetchStats(householdId: string): Promise<CleaningStatsRow[]> {
  const { data, error } = await supabase
    .from('v_cleaning_stats')
    .select('*')
    .eq('household_id', householdId)
    .order('month', { ascending: false });

  if (error) throw error;
  return data ?? [];
}

/**
 * One RPC, one transaction: records the completion, advances next_due_on with
 * the same recurrence function the seeder uses, and rotates the assignee.
 * Doing this client-side would be three round-trips that can half-fail.
 */
export async function completeTask(taskId: string, durationMinutes?: number): Promise<CleaningTaskRow> {
  const { data, error } = await supabase.rpc('complete_cleaning_task', {
    p_task_id: taskId,
    p_duration_minutes: durationMinutes ?? null,
  });

  if (error) throw error;
  return data as CleaningTaskRow;
}

export async function undoCompletion(completionId: string): Promise<CleaningTaskRow> {
  const { data, error } = await supabase.rpc('undo_cleaning_completion', {
    p_completion_id: completionId,
  });

  if (error) throw error;
  return data as CleaningTaskRow;
}

/** The completion to undo right after ticking a task off. */
export async function fetchLatestCompletion(taskId: string): Promise<CleaningCompletionRow | null> {
  const { data, error } = await supabase
    .from('cleaning_completions')
    .select('*')
    .eq('task_id', taskId)
    .order('completed_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) throw error;
  return data;
}

export async function createTask(input: TaskInsert): Promise<CleaningTaskRow> {
  const { data, error } = await supabase.from('cleaning_tasks').insert(input).select().single();
  if (error) throw error;
  return data;
}

export async function updateTask(taskId: string, patch: TaskUpdate): Promise<CleaningTaskRow> {
  const { data, error } = await supabase
    .from('cleaning_tasks')
    .update(patch)
    .eq('id', taskId)
    .select()
    .single();

  if (error) throw error;
  return data;
}

/** Soft-retire rather than delete, so the completion history stays intact. */
export async function deactivateTask(taskId: string): Promise<void> {
  const { error } = await supabase.from('cleaning_tasks').update({ is_active: false }).eq('id', taskId);
  if (error) throw error;
}

export async function deleteTask(taskId: string): Promise<void> {
  const { error } = await supabase.from('cleaning_tasks').delete().eq('id', taskId);
  if (error) throw error;
}

export async function createArea(householdId: string, name: string, color: string, icon: string) {
  const { data, error } = await supabase
    .from('cleaning_areas')
    .insert({ household_id: householdId, name, color, icon })
    .select()
    .single();

  if (error) throw error;
  return data;
}
