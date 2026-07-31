import type { HouseRuleRow } from '../../lib/database.types';
import { supabase } from '../../lib/supabase';

export async function fetchRules(householdId: string): Promise<HouseRuleRow[]> {
  const { data, error } = await supabase
    .from('house_rules')
    .select('*')
    .eq('household_id', householdId)
    .order('position', { ascending: true })
    .order('created_at', { ascending: true });

  if (error) throw error;
  return data ?? [];
}

export async function addRule(input: {
  householdId: string;
  text: string;
  position: number;
}): Promise<HouseRuleRow> {
  const { data, error } = await supabase
    .from('house_rules')
    .insert({
      household_id: input.householdId,
      text: input.text.trim(),
      position: input.position,
    })
    .select()
    .single();

  if (error) throw error;
  return data;
}

export async function updateRule(
  ruleId: string,
  patch: Partial<Pick<HouseRuleRow, 'text' | 'position'>>,
): Promise<HouseRuleRow> {
  const { data, error } = await supabase
    .from('house_rules')
    .update(patch)
    .eq('id', ruleId)
    .select()
    .single();

  if (error) throw error;
  return data;
}

export async function deleteRule(ruleId: string): Promise<void> {
  const { error } = await supabase.from('house_rules').delete().eq('id', ruleId);
  if (error) throw error;
}

/**
 * An RPC because a swap writes two rows, and PostgREST runs one statement per
 * request — two updates from the client could leave the list half-swapped.
 * Moving past the first or last rule is a no-op, not an error.
 */
export async function moveRule(ruleId: string, direction: 'up' | 'down'): Promise<void> {
  const { error } = await supabase.rpc('house_rules_move', {
    p_rule_id: ruleId,
    p_direction: direction,
  });

  if (error) throw error;
}
