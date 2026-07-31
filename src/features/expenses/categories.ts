import type { Ionicons } from '@expo/vector-icons';

/**
 * The category vocabulary, shared by the expense form, the Fixkosten form and
 * the stats screen.
 *
 * expenses.category is a free-text column, not an enum — a household that
 * wants "Katzenfutter" as its own line should not need a migration. This list
 * is therefore the set of *offered* categories, not the set of allowed ones:
 * the stats screen renders whatever comes back from the view, falling back to
 * a neutral icon/colour for anything not listed here.
 */
export interface ExpenseCategory {
  value: string;
  icon: keyof typeof Ionicons.glyphMap;
  color: string;
}

export const EXPENSE_CATEGORIES: ExpenseCategory[] = [
  { value: 'Lebensmittel', icon: 'cart', color: '#6FCF97' },
  { value: 'Haushalt', icon: 'home', color: '#56CCF2' },
  { value: 'Miete', icon: 'business', color: '#BB6BD9' },
  { value: 'Mabel', icon: 'paw', color: '#4422db' },
  { value: 'Strom', icon: 'flash', color: '#F2C94C' },
  { value: 'Internet', icon: 'wifi', color: '#4F8DF7' },
  { value: 'Versicherung', icon: 'shield-checkmark', color: '#828282' },
  { value: 'Transport', icon: 'car', color: '#F2994A' },
  { value: 'Gesundheit', icon: 'medkit', color: '#EB5757' },
  { value: 'Freizeit', icon: 'game-controller', color: '#9B51E0' },
  { value: 'Restaurant', icon: 'restaurant', color: '#f24ac5' },
  { value: 'Abo', icon: 'repeat', color: '#2D9CDB' },
  { value: 'Sonstiges', icon: 'ellipsis-horizontal', color: '#9CA3AF' },
];

const FALLBACK: Omit<ExpenseCategory, 'value'> = {
  icon: 'pricetag',
  color: '#9CA3AF',
};

/** Never throws on an unknown category — see the note above. */
export function categoryMeta(value: string | null | undefined): ExpenseCategory {
  const name = value ?? 'Sonstiges';
  const known = EXPENSE_CATEGORIES.find((c) => c.value === name);
  return known ?? { value: name, ...FALLBACK };
}
