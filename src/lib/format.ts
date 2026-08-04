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

/**
 * Stock amounts.
 *
 * Quarters and halves render as fractions rather than decimals: an inventory
 * that says "0,5" reads like a measurement, and "½" reads like half a packet —
 * which is what it is, and the reason `quantity` is allowed to be fractional at
 * all (migration 0025). Anything that is not a neat quarter falls back to a
 * German decimal with the trailing zeros of numeric(12,3) trimmed off.
 */
const FRACTION_GLYPHS: Record<number, string> = { 0.25: '¼', 0.5: '½', 0.75: '¾' };

export function formatQuantity(value: number): string {
  // Rounded before anything else, so a float artefact (0.30000000000000004,
  // or 0.9999 from repeated subtraction) cannot leak into the output.
  const rounded = Math.round((Number.isFinite(value) ? value : 0) * 1000) / 1000;
  const sign = rounded < 0 ? '−' : '';
  const abs = Math.abs(rounded);

  const whole = Math.floor(abs);
  const glyph = FRACTION_GLYPHS[Number((abs - whole).toFixed(3))];
  if (glyph) return `${sign}${whole === 0 ? '' : whole}${glyph}`;

  return sign + abs.toFixed(3).replace(/\.?0+$/, '').replace('.', ',');
}

/**
 * The inverse, forgiving of everything a quantity field can end up holding:
 * "1,5", "1.5", and the "1½" that formatQuantity() itself puts there when a
 * field is prefilled with the current stock.
 */
export function parseQuantity(input: string): number | null {
  const trimmed = input.trim();
  if (!trimmed) return null;

  let rest = trimmed;
  let fraction = 0;
  for (const [value, glyph] of Object.entries(FRACTION_GLYPHS)) {
    if (rest.includes(glyph)) {
      fraction = Number(value);
      rest = rest.replace(glyph, '').trim();
      break;
    }
  }

  if (!rest) return fraction || null;

  const whole = Number(rest.replace(',', '.'));
  if (!Number.isFinite(whole) || whole < 0) return null;

  return whole + fraction;
}

const UNIT_LABELS: Record<string, [singular: string, plural: string]> = {
  piece: ['Stück', 'Stück'],
  pack: ['Packung', 'Packungen'],
  g: ['g', 'g'],
  kg: ['kg', 'kg'],
  ml: ['ml', 'ml'],
  l: ['l', 'l'],
};

export function unitLabel(unit: string, quantity = 1): string {
  const [singular, plural] = UNIT_LABELS[unit] ?? [unit, unit];
  return quantity === 1 ? singular : plural;
}

/** "1½ Packungen", "250 g", "2 Stück". */
export function formatQuantityWithUnit(quantity: number, unit: string): string {
  return `${formatQuantity(quantity)} ${unitLabel(unit, quantity)}`;
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

/**
 * A *local* `YYYY-MM-DD` — never `toISOString`, which is UTC and so renders as
 * the day before for any evening timestamp west of Greenwich.
 *
 * Takes a bare date through parseDateOnly() for the same reason, so passing a
 * value straight back out of this function is always a no-op.
 */
export function dateIso(value: Date | string): string {
  const date =
    typeof value === 'string'
      ? /^\d{4}-\d{2}-\d{2}$/.test(value)
        ? parseDateOnly(value)
        : new Date(value)
      : value;

  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${date.getFullYear()}-${m}-${d}`;
}

export function todayIso(): string {
  return dateIso(new Date());
}

/** `YYYY-MM-DD`, `days` later. Negative walks backwards. */
export function shiftDays(iso: string, days: number): string {
  const date = parseDateOnly(iso);
  date.setDate(date.getDate() + days);
  return dateIso(date);
}

/**
 * What someone types into a date field: "4.8.2026", "04.08.2026", "4/8/2026",
 * or an ISO date pasted in. Returns `YYYY-MM-DD`, or null so the caller can
 * hold the field in an error state.
 *
 * A native date picker would be nicer for "next Tuesday" and worse for "the
 * 3rd of May 1998" — an anniversary is usually years back, which is a lot of
 * swiping. Typing handles both, and quick chips cover the near dates.
 */
export function parseGermanDate(input: string): string | null {
  const trimmed = input.trim();
  const match = trimmed.match(/^(\d{1,2})[.\-/](\d{1,2})[.\-/](\d{4})$/);
  if (!match) return /^\d{4}-\d{2}-\d{2}$/.test(trimmed) ? trimmed : null;

  const [, d, m, y] = match;
  const iso = `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
  // Rejects 31.02.2026, which the regex alone happily accepts.
  const back = new Date(`${iso}T00:00:00Z`);
  return Number.isNaN(back.getTime()) || back.toISOString().slice(0, 10) !== iso ? null : iso;
}

/**
 * A `YYYY-MM-DD` as a timestamptz at *local noon*.
 *
 * Midnight is the obvious choice and the wrong one: it is only ever twelve
 * hours from being the day before somewhere, so a date entered here could come
 * back rendered as yesterday. Noon cannot land on the wrong day in any
 * timezone, and nothing in this app shows the time an expense was booked.
 */
export function dateIsoToTimestamp(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d, 12, 0, 0).toISOString();
}

/**
 * First of a month as `YYYY-MM-DD` — the key v_expense_category_month groups
 * on. `offset` walks backwards: 0 = this month, -1 = last month.
 */
export function monthKey(offset = 0): string {
  const now = new Date();
  const d = new Date(now.getFullYear(), now.getMonth() + offset, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`;
}

/** "Juli 2026" */
export function formatMonth(monthIso: string): string {
  return new Intl.DateTimeFormat('de-DE', { month: 'long', year: 'numeric' })
    .format(parseDateOnly(monthIso));
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
