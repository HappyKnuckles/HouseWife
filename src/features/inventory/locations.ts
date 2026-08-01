import type { Ionicons } from '@expo/vector-icons';

/**
 * `storage_locations.kind` is free text since migration 0022 — it only ever
 * picked an icon, so a closed set of seven was an arbitrary limit on what you
 * could call a place.
 *
 * These are the ones the picker offers and the only ones with their own icon;
 * anything else you type is stored as-is and falls back to a pin.
 */
export const LOCATION_KINDS: { value: string; label: string; icon: keyof typeof Ionicons.glyphMap }[] = [
  { value: 'room', label: 'Raum', icon: 'home-outline' },
  { value: 'cabinet', label: 'Schrank', icon: 'file-tray-stacked-outline' },
  { value: 'shelf', label: 'Regal', icon: 'library-outline' },
  { value: 'box', label: 'Kiste', icon: 'cube-outline' },
  { value: 'fridge', label: 'Kühlschrank', icon: 'snow-outline' },
  { value: 'freezer', label: 'Gefrierschrank', icon: 'snow-outline' },
  { value: 'other', label: 'Sonstiges', icon: 'ellipsis-horizontal-outline' },
];

export function locationIcon(kind: string): keyof typeof Ionicons.glyphMap {
  return LOCATION_KINDS.find((k) => k.value === kind)?.icon ?? 'location-outline';
}

/** A custom kind is shown as typed; a known one gets its German label. */
export function locationKindLabel(kind: string): string {
  return LOCATION_KINDS.find((k) => k.value === kind)?.label ?? kind;
}

/**
 * A single submit can create more than one location — one form per drawer is
 * the reason half of a Schrank never gets entered.
 *
 * Twenty at a time covers the real case (a cabinet's drawers, a shelf's
 * compartments) and is small enough that a fat-fingered "Schub 1-500" is
 * refused as the typo it is rather than filling the household with junk.
 */
export const MAX_LOCATIONS_PER_BATCH = 20;

/**
 * Whether a name still carries an unexpanded range — which only happens when
 * `expandLocationNames` refused one for being descending or too long. The
 * composer uses it to say so out loud, because the fallback (creating a single
 * place literally called "Schub 1-500") is otherwise a silent wrong answer.
 */
export function hasRefusedRange(names: string[]): boolean {
  return names.some((name) => /\d+\s*[-–]\s*\d+$/.test(name));
}

/**
 * Expands one Name input into the names to actually create.
 *
 * Both separators are things people already type when listing places out
 * loud: commas or line breaks for a list ("Schrank, Kommode"), and a trailing
 * number range for a run of near-identical ones ("Schub 1-3" → Schub 1,
 * Schub 2, Schub 3). Everything else is taken literally, so a place genuinely
 * called "Kiste 2-4" is still reachable by typing it without the range being
 * the only reading — that one loses, deliberately: the run is the common case.
 */
export function expandLocationNames(input: string): string[] {
  const names: string[] = [];

  for (const rawEntry of input.split(/[,\n]/)) {
    const entry = rawEntry.trim();
    if (!entry) continue;

    // The prefix keeps its own spacing, so "Schub 1-3" and "Schub1-3" each
    // number the way they were typed.
    const range = /^(.*?)(\d+)\s*[-–]\s*(\d+)$/.exec(entry);
    const from = range ? Number(range[2]) : 0;
    const to = range ? Number(range[3]) : 0;

    if (!range || to < from || to - from + 1 > MAX_LOCATIONS_PER_BATCH) {
      names.push(entry);
      continue;
    }

    for (let n = from; n <= to; n++) names.push(`${range[1]}${n}`);
  }

  return names.slice(0, MAX_LOCATIONS_PER_BATCH);
}
