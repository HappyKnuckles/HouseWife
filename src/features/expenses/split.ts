/**
 * Client-side split preview.
 *
 * This mirrors public.apply_expense_split() so the "du zahlst X, sie zahlt Y"
 * line can update while typing, before anything is saved. Postgres remains the
 * authority — expense_shares is written server-side and a deferred constraint
 * trigger rejects anything that does not sum to the total — so a bug here shows
 * up as a wrong preview, never as a wrong ledger.
 *
 * Rounding rule, identical on both sides: integer-divide, then hand the
 * remaining cents out one at a time starting with the payer. 40.01 € between
 * two people gives the payer 20.01 €.
 */
import type { ExpenseItemInput, SplitType } from '../../lib/database.types';

export interface SplitInput {
  totalCents: number;
  memberIds: string[];
  payerId: string;
  splitType: SplitType;
  items?: ExpenseItemInput[];
  /** For split_type = 'shares': explicit cent amounts per member. */
  customShares?: Record<string, number>;
}

export type SplitResult = Record<string, number>;

/** Payer first, then stable by id — the same ORDER BY the SQL uses. */
function orderMembers(memberIds: string[], payerId: string): string[] {
  return [...memberIds].sort((a, b) => {
    if (a === payerId) return -1;
    if (b === payerId) return 1;
    return a.localeCompare(b);
  });
}

function distribute(amountCents: number, members: string[]): SplitResult {
  const result: SplitResult = {};
  if (members.length === 0) return result;

  const base = Math.trunc(amountCents / members.length);
  const remainder = amountCents - base * members.length;

  members.forEach((id, index) => {
    result[id] = base + (index < remainder ? 1 : 0);
  });

  return result;
}

export function computeSplit(input: SplitInput): SplitResult {
  const { totalCents, memberIds, payerId, splitType, items = [], customShares } = input;
  const ordered = orderMembers(memberIds, payerId);

  if (splitType === 'shares') {
    return Object.fromEntries(ordered.map((id) => [id, customShares?.[id] ?? 0]));
  }

  if (splitType === 'items') {
    // Anything not explicitly assigned to someone is shared. That also absorbs
    // Pfand, tips and any gap between the line items and the receipt total.
    const assigned: SplitResult = Object.fromEntries(ordered.map((id) => [id, 0]));
    let assignedTotal = 0;

    for (const item of items) {
      if (!item.paid_for) continue;
      assigned[item.paid_for] = (assigned[item.paid_for] ?? 0) + item.total_cents;
      assignedTotal += item.total_cents;
    }

    const shared = distribute(Math.max(0, totalCents - assignedTotal), ordered);
    return Object.fromEntries(ordered.map((id) => [id, (assigned[id] ?? 0) + (shared[id] ?? 0)]));
  }

  return distribute(totalCents, ordered);
}

/**
 * What this expense changes about the balance, from one person's perspective:
 * positive = they are owed money.
 */
export function netForMember(
  totalCents: number,
  payerId: string,
  shares: SplitResult,
  memberId: string,
): number {
  const paid = payerId === memberId ? totalCents : 0;
  return paid - (shares[memberId] ?? 0);
}

export function sumShares(shares: SplitResult): number {
  return Object.values(shares).reduce((sum, cents) => sum + cents, 0);
}

/** Guard for the save button: custom shares must add up before submitting. */
export function validateSplit(totalCents: number, shares: SplitResult): string | null {
  const sum = sumShares(shares);
  if (sum !== totalCents) {
    const diff = (totalCents - sum) / 100;
    return `Die Anteile ergeben nicht die Summe (${diff > 0 ? 'es fehlen' : 'zu viel'} ${Math.abs(diff)
      .toFixed(2)
      .replace('.', ',')} €).`;
  }
  return null;
}
