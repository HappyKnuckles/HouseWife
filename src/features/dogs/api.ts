import type { DogCommandRow } from '../../lib/database.types';
import { supabase } from '../../lib/supabase';

/**
 * Ordered by creation, oldest first: the commands you taught first are the
 * ones you look up least, but they are also the ones the list is anchored on.
 * There is no `position` column to reorder — see migration 0026.
 */
export async function fetchCommands(householdId: string): Promise<DogCommandRow[]> {
  const { data, error } = await supabase
    .from('dog_commands')
    .select('*')
    .eq('household_id', householdId)
    .order('created_at', { ascending: true });

  if (error) throw error;
  return data ?? [];
}

export async function addCommand(input: {
  householdId: string;
  command: string;
  description?: string | null;
}): Promise<DogCommandRow> {
  const { data, error } = await supabase
    .from('dog_commands')
    .insert({
      household_id: input.householdId,
      command: input.command.trim(),
      description: input.description?.trim() || null,
    })
    .select()
    .single();

  if (error) throw error;
  return data;
}

export async function updateCommand(
  commandId: string,
  patch: { command?: string; description?: string | null },
): Promise<DogCommandRow> {
  const { data, error } = await supabase
    .from('dog_commands')
    .update({
      ...(patch.command === undefined ? {} : { command: patch.command.trim() }),
      // Distinguishes "not changing the description" from "clearing it".
      ...(patch.description === undefined ? {} : { description: patch.description?.trim() || null }),
    })
    .eq('id', commandId)
    .select()
    .single();

  if (error) throw error;
  return data;
}

export async function deleteCommand(commandId: string): Promise<void> {
  const { error } = await supabase.from('dog_commands').delete().eq('id', commandId);
  if (error) throw error;
}
