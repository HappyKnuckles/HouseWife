import type { EventAgendaRow, EventKind, EventRow } from '../../lib/database.types';
import { supabase } from '../../lib/supabase';

export interface EventInput {
  kind: EventKind;
  title: string;
  description?: string | null;
  place?: string | null;
  startsOn: string;
  startsAt?: string | null;
  endsOn?: string | null;
  repeatYearly: boolean;
  remindDaysBefore: number;
}

/**
 * Reads the agenda view rather than the table: next_on, days_until, years and
 * days_since_start are all derived from the same `current_date` on the server,
 * so two phones in different timezones cannot disagree about how many days are
 * left — and a device with a wrong clock cannot invent an anniversary.
 */
export async function fetchEvents(householdId: string): Promise<EventAgendaRow[]> {
  const { data, error } = await supabase
    .from('v_event_agenda')
    .select('*')
    .eq('household_id', householdId)
    .order('next_on', { ascending: true });

  if (error) throw error;
  return data ?? [];
}

function toRow(input: EventInput) {
  return {
    kind: input.kind,
    title: input.title.trim(),
    description: input.description?.trim() || null,
    place: input.place?.trim() || null,
    starts_on: input.startsOn,
    starts_at: input.startsAt || null,
    ends_on: input.endsOn || null,
    // An anniversary or birthday that does not come back every year is not
    // one — the CHECK enforces it, this just keeps the client from tripping it.
    repeat_yearly: input.kind === 'event' ? input.repeatYearly : true,
    remind_days_before: input.remindDaysBefore,
  };
}

export async function createEvent(householdId: string, input: EventInput): Promise<EventRow> {
  const { data, error } = await supabase
    .from('events')
    .insert({ household_id: householdId, ...toRow(input) })
    .select()
    .single();

  if (error) throw error;
  return data;
}

export async function updateEvent(eventId: string, input: EventInput): Promise<EventRow> {
  const { data, error } = await supabase
    .from('events')
    .update(toRow(input))
    .eq('id', eventId)
    .select()
    .single();

  if (error) throw error;
  return data;
}

export async function deleteEvent(eventId: string): Promise<void> {
  const { error } = await supabase.from('events').delete().eq('id', eventId);
  if (error) throw error;
}
