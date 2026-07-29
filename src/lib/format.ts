/**
 * German-locale formatting. Money is always handled as integer cents; this file
 * is the only place that turns cents into something a human reads, and the only
 * place that turns typed text back into cents.
 */

const currencyFormatters = new Map<string, Intl.NumberFormat>();

function currencyFormatter(currency: string): Intl.NumberFormat {
  let fmt = currencyFormatters.get(currency);
  if (!fmt) {
    fmt = new Intl.NumberFormat('de-DE', { style: 'currency', currency });
    currencyFormatters.set(currency, fmt);
  }
  return fmt;
}

export function formatCents(cents: number, currency = 'EUR'): string {
  return currencyFormatter(currency).format((cents ?? 0) / 100);
}

/** Same as formatCents but always signed — used for balances. */
export function formatCentsSigned(cents: number, currency = 'EUR'): string {
  const formatted = formatCents(Math.abs(cents), currency);
  if (cents === 0) return formatted;
  return `${cents > 0 ? '+' : '−'}${formatted}`;
}

/**
 * Parses what someone actually types into a German amount field: "12,50",
 * "12.50", "1.234,56", "12". Returns null when it cannot be read as a number,
 * so the caller can keep the field in an error state rather than silently
 * booking 0 €.
 */
export function parseAmountToCents(input: string): number | null {
  const trimmed = input.trim().replace(/[€\s]/g, '');
  if (!trimmed) return null;

  let normalized: string;
  if (trimmed.includes(',')) {
    // German: dots are thousands separators, comma is the decimal point.
    normalized = trimmed.replace(/\./g, '').replace(',', '.');
  } else {
    // A single dot is ambiguous; treat it as a decimal point, which is what
    // someone typing on a numeric keypad means.
    normalized = trimmed;
  }

  const value = Number(normalized);
  if (!Number.isFinite(value) || value < 0) return null;

  return Math.round(value * 100);
}

const WEEKDAYS_SHORT = ['', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'];
const WEEKDAYS_LONG = ['', 'Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag', 'Sonntag'];

/** ISO weekday (1 = Montag) → label. */
export const weekdayShort = (isoDow: number) => WEEKDAYS_SHORT[isoDow] ?? '';
export const weekdayLong = (isoDow: number) => WEEKDAYS_LONG[isoDow] ?? '';

export function formatDate(value: string | Date, opts?: Intl.DateTimeFormatOptions): string {
  const date = typeof value === 'string' ? parseDateOnly(value) : value;
  return new Intl.DateTimeFormat('de-DE', opts ?? { day: '2-digit', month: '2-digit', year: 'numeric' })
    .format(date);
}

export function formatDateTime(value: string | Date): string {
  const date = typeof value === 'string' ? new Date(value) : value;
  return new Intl.DateTimeFormat('de-DE', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

/**
 * Parses a bare `YYYY-MM-DD` as *local* midnight.
 *
 * `new Date('2026-07-29')` is parsed as UTC midnight, which in Berlin renders
 * as 02:00 the same day but in negative-offset timezones renders as the day
 * before — a due date that shows up one day early.
 */
export function parseDateOnly(value: string): Date {
  const [y, m, d] = value.split('-').map(Number);
  if (!y || !m || !d) return new Date(value);
  return new Date(y, m - 1, d);
}

export function todayIso(): string {
  const now = new Date();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${now.getFullYear()}-${m}-${d}`;
}

/** "Heute", "Morgen", "Seit 3 Tagen", "In 5 Tagen" … */
export function dueLabel(daysUntil: number): string {
  if (daysUntil === 0) return 'Heute fällig';
  if (daysUntil === 1) return 'Morgen fällig';
  if (daysUntil === -1) return 'Seit gestern überfällig';
  if (daysUntil < 0) return `Seit ${Math.abs(daysUntil)} Tagen überfällig`;
  if (daysUntil <= 6) return `In ${daysUntil} Tagen`;
  return `In ${Math.round(daysUntil / 7)} Wochen`;
}

export function relativeTime(value: string): string {
  const then = new Date(value).getTime();
  const diffMinutes = Math.round((Date.now() - then) / 60000);

  if (diffMinutes < 1) return 'gerade eben';
  if (diffMinutes < 60) return `vor ${diffMinutes} Min.`;

  const hours = Math.round(diffMinutes / 60);
  if (hours < 24) return `vor ${hours} Std.`;

  const days = Math.round(hours / 24);
  if (days === 1) return 'gestern';
  if (days < 30) return `vor ${days} Tagen`;

  return formatDate(new Date(value));
}

/** "alle 2 Wochen", "wöchentlich Sa", "monatlich am 1." */
export function recurrenceLabel(task: {
  recurrence_unit: 'day' | 'week' | 'month';
  recurrence_interval: number;
  weekdays: number[] | null;
  day_of_month: number | null;
}): string {
  const { recurrence_unit: unit, recurrence_interval: every, weekdays, day_of_month } = task;

  if (unit === 'week' && weekdays?.length) {
    const days = weekdays.map(weekdayShort).join(', ');
    return every === 1 ? `Jede Woche · ${days}` : `Alle ${every} Wochen · ${days}`;
  }

  if (unit === 'month' && day_of_month) {
    return every === 1 ? `Monatlich am ${day_of_month}.` : `Alle ${every} Monate am ${day_of_month}.`;
  }

  const nouns = { day: ['Tag', 'Tage'], week: ['Woche', 'Wochen'], month: ['Monat', 'Monate'] } as const;
  const [singular, plural] = nouns[unit];

  if (every === 1) {
    return { day: 'Täglich', week: 'Wöchentlich', month: 'Monatlich' }[unit];
  }
  return `Alle ${every} ${every === 1 ? singular : plural}`;
}

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}
