import type { RecurringExpenseUnit } from '../../lib/database.types';
import { dateIso, formatDate, parseDateOnly } from '../../lib/format';

/**
 * Fixkosten cadences as people actually say them.
 *
 * The schema only knows 'week' and 'month' plus an interval, and that is
 * already enough: "jährlich" is month × 12, "vierteljährlich" month × 3. The
 * generator (generate_due_recurring_expenses) and recurring_expense_next_due()
 * handle any interval up to 60, so no migration is needed for these — the
 * form just stops hard-coding the interval to 1.
 */
export interface Cadence {
  key: string;
  label: string;
  unit: RecurringExpenseUnit;
  interval: number;
}

export const CADENCES: Cadence[] = [
  { key: 'week', label: 'Wöchentlich', unit: 'week', interval: 1 },
  { key: 'month', label: 'Monatlich', unit: 'month', interval: 1 },
  { key: 'quarter', label: 'Vierteljährlich', unit: 'month', interval: 3 },
  { key: 'half', label: 'Halbjährlich', unit: 'month', interval: 6 },
  { key: 'year', label: 'Jährlich', unit: 'month', interval: 12 },
];

export function cadenceFor(unit: RecurringExpenseUnit, interval: number): Cadence | undefined {
  return CADENCES.find((c) => c.unit === unit && c.interval === interval);
}

/**
 * One-tap starting points for the costs everyone has. A preset fills name,
 * category and the cadence it usually comes in — the amount and date are
 * always the household's own, so those are left alone.
 */
export interface RecurringPreset {
  name: string;
  category: string;
  cadenceKey: string;
}

export const RECURRING_PRESETS: RecurringPreset[] = [
  { name: 'Versicherung', category: 'Versicherung', cadenceKey: 'year' },
  { name: 'Miete', category: 'Miete', cadenceKey: 'month' },
  { name: 'Strom', category: 'Strom', cadenceKey: 'month' },
  { name: 'Internet', category: 'Internet', cadenceKey: 'month' },
  { name: 'Handy', category: 'Abo', cadenceKey: 'month' },
  { name: 'Rundfunkbeitrag', category: 'Abo', cadenceKey: 'quarter' },
  { name: 'Streaming', category: 'Abo', cadenceKey: 'month' },
];

/** "Jährlich am 01.03." / "Monatlich am 1." / "Alle 2 Wochen" */
export function scheduleLabel(
  unit: RecurringExpenseUnit,
  every: number,
  dayOfMonth: number | null,
  nextDueOn?: string,
): string {
  if (unit === 'week') return every === 1 ? 'Wöchentlich' : `Alle ${every} Wochen`;

  const cadence = cadenceFor(unit, every);
  // Monthly names the day; anything longer than a month needs the month too,
  // otherwise "Jährlich am 1." says nothing about *when* in the year.
  if (every > 1 && nextDueOn) {
    const when = formatDate(nextDueOn, { day: '2-digit', month: '2-digit' });
    return `${cadence?.label ?? `Alle ${every} Monate`} ab ${when}`;
  }
  const day = dayOfMonth ? ` am ${dayOfMonth}.` : '';
  return `${cadence?.label ?? `Alle ${every} Monate`}${day}`;
}

/**
 * A template's cost spread over one month. Weekly is normalised with 52/12 so
 * the headline total means one thing rather than silently mixing cadences.
 */
export function monthlyEquivalentCents(
  amountCents: number,
  unit: RecurringExpenseUnit,
  every: number,
): number {
  const perPeriod = amountCents / every;
  return Math.round(unit === 'month' ? perPeriod : (perPeriod * 52) / 12);
}

/**
 * The same step recurring_expense_next_due() takes in SQL, client-side, for
 * "schon bezahlt — erst ab dem nächsten Mal". Month steps clamp to the end of
 * a short month exactly like the server does, so 31.01. + 1 Monat = 28./29.02.
 */
export function nextOccurrence(iso: string, unit: RecurringExpenseUnit, every: number): string {
  const date = parseDateOnly(iso);
  if (unit === 'week') {
    date.setDate(date.getDate() + 7 * every);
    return dateIso(date);
  }

  const day = date.getDate();
  const target = new Date(date.getFullYear(), date.getMonth() + every, 1);
  const daysInMonth = new Date(target.getFullYear(), target.getMonth() + 1, 0).getDate();
  target.setDate(Math.min(day, daysInMonth));
  return dateIso(target);
}
