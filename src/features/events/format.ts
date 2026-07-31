import type { Ionicons } from '@expo/vector-icons';

import type { EventAgendaRow, EventKind } from '../../lib/database.types';
import { formatDate } from '../../lib/format';

export function eventIcon(kind: EventKind): keyof typeof Ionicons.glyphMap {
  switch (kind) {
    case 'anniversary':
      return 'heart';
    case 'birthday':
      return 'gift';
    default:
      return 'calendar';
  }
}

export const EVENT_KIND_LABEL: Record<EventKind, string> = {
  event: 'Termin',
  anniversary: 'Jahrestag',
  birthday: 'Geburtstag',
};

/**
 * "in 3 Tagen" / "heute" / "vor 2 Wochen".
 *
 * Takes the day count the server already computed rather than a date, so it
 * cannot disagree with the countdown the other phone is showing.
 */
export function relativeDays(days: number): string {
  if (days === 0) return 'heute';
  if (days === 1) return 'morgen';
  if (days === -1) return 'gestern';
  if (days === 2) return 'übermorgen';

  if (days > 0) {
    if (days < 7) return `in ${days} Tagen`;
    if (days < 31) {
      const weeks = Math.round(days / 7);
      return weeks === 1 ? 'in 1 Woche' : `in ${weeks} Wochen`;
    }
    const months = Math.round(days / 30);
    return months === 1 ? 'in 1 Monat' : `in ${months} Monaten`;
  }

  const past = Math.abs(days);
  if (past < 7) return `vor ${past} Tagen`;
  if (past < 31) {
    const weeks = Math.round(past / 7);
    return weeks === 1 ? 'vor 1 Woche' : `vor ${weeks} Wochen`;
  }
  const months = Math.round(past / 30);
  return months === 1 ? 'vor 1 Monat' : `vor ${months} Monaten`;
}

/** The date line under an event title: date, optional time, optional range. */
export function eventWhen(event: Pick<EventAgendaRow, 'next_on' | 'starts_at' | 'ends_on' | 'starts_on'>): string {
  const date = formatDate(event.next_on);
  const time = event.starts_at ? ` · ${event.starts_at.slice(0, 5)} Uhr` : '';

  // A range only makes sense on the occurrence being shown, so it is offset by
  // the same amount the occurrence was.
  if (event.ends_on && event.ends_on !== event.starts_on) {
    const span = Number(new Date(event.ends_on)) - Number(new Date(event.starts_on));
    const end = new Date(Number(new Date(event.next_on)) + span);
    return `${date} – ${formatDate(end)}${time}`;
  }

  return `${date}${time}`;
}
