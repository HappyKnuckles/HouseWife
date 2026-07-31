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
