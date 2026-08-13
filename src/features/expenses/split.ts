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

/**
 * Percentages → exact cents.
 *
 * Percent is an input convenience, not a second storage format: expense_shares
 * holds cents either way, and apply_expense_split() derives share_ratio from
 * them server-side, so "60 %" survives a round trip as 0.60000 without this
 * side needing to send it. That is also what makes the mode switch lossless —
 * percentFromCents() below reads the same number back out.
 *
 * The rounding is the existing rule, not a new one: floor everything, then
 * hand the leftover cents out one at a time starting with the payer. 84,98 €
 * at 33,33 / 66,67 comes to 28,32 and 56,66 and sums exactly.
 *
 * Only pure rounding drift is distributed. Percentages that do not add up to
 * 100 produce a result that visibly does not reach the total, which is the
 * honest preview — validatePercent() is what stops it being saved.
 */
export function centsFromPercent(
  totalCents: number,
  percentByMember: Record<string, number>,
  memberIds: string[],
  payerId: string,
): SplitResult {
  const ordered = orderMembers(memberIds, payerId);

  const floors = ordered.map((id) =>
    Math.floor((totalCents * (percentByMember[id] ?? 0)) / 100),
  );
  const remainder = totalCents - floors.reduce((sum, cents) => sum + cents, 0);

  const result: SplitResult = {};
  ordered.forEach((id, index) => {
    result[id] = floors[index] + (index < remainder ? 1 : 0);
  });

  return result;
}

/** The inverse, for showing an already-saved split as percentages. */
export function percentFromCents(
  totalCents: number,
  shares: SplitResult,
): Record<string, number> {
  if (totalCents <= 0) return {};
  return Object.fromEntries(
    Object.entries(shares).map(([id, cents]) => [id, (cents / totalCents) * 100]),
  );
}

/**
 * Guard for the save button in percent mode.
 *
 * Checked against 100 rather than against the cent total, because that is the
 * mistake actually being made — "60 und 30" is a missing 10 %, and saying so
 * is more useful than reporting the 8,50 € it happens to work out to. A tenth
 * of a percent of slack, so 33,3 / 33,3 / 33,4 is not rejected for being
 * exactly what someone meant.
 */
export function validatePercent(
  percentByMember: Record<string, number>,
  memberIds: string[],
): string | null {
  const sum = memberIds.reduce((total, id) => total + (percentByMember[id] ?? 0), 0);
  if (Math.abs(sum - 100) < 0.1) return null;

  const shown = Math.round(sum * 10) / 10;
  return `Die Prozente ergeben ${String(shown).replace('.', ',')} % statt 100 %.`;
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
