/**
 * Turning a German supermarket receipt into line items.
 *
 * This is the half of receipt OCR that no OCR service does for you. Google
 * Vision returns the text on the paper and where each glyph sits; it has no
 * idea that "MILCH 3,5%  1,19 A" is a purchase, that "A 19% 4,63 0,88 5,51"
 * is a tax table, or that the "2 x 0,89" on its own line belongs to the item
 * above it. That knowledge lives here.
 *
 * Deliberately line-based rather than geometric. Bounding boxes would let us
 * cluster columns properly, but they also make the parser dependent on how
 * square the photo is — and Vision's `fullTextAnnotation.text` already emits
 * lines in reading order, which is the one thing every German receipt layout
 * agrees on: name on the left, price at the right end of the same line.
 *
 * Pure and Deno-free on purpose: it is the piece most likely to need
 * iterating against real receipts, so it has to be runnable under plain node
 * (`npm run test:receipt`).
 */

export interface ParsedReceiptLine {
  name: string;
  quantity?: number;
  unitPriceCents?: number;
  totalCents: number;
}

export interface ParsedReceipt {
  merchant?: string;
  purchasedAt?: string;
  totalCents?: number;
  currency?: string;
  lines: ParsedReceiptLine[];
  confidence: number;
  raw?: unknown;
}

/**
 * Lines that carry a number but are not a purchase.
 *
 * Matched against the *name* part, after the price has been split off, so
 * "SUMME" here does not accidentally kill an item called "Summenbrot".
 */
const NOT_AN_ITEM =
  /^(summe|gesamt|gesamtsumme|zu ?zahlen|total|karte|zahlung|betrag|mwst|ust|netto|brutto|steuer|trinkgeld|posten|artikel|datum|uhrzeit|zeit|uid|kasse)$/i;

/**
 * The same thing, but for lines where the giveaway is a *substring* — payment
 * and bookkeeping lines are printed with prefixes and suffixes that vary by
 * till ("Geg. EC-Karte", "Summe EUR", "davon MwSt").
 *
 * Word boundaries throughout, and no bare `bar`, because a receipt containing
 * Barilla should not silently lose it.
 */
const NOT_AN_ITEM_ANYWHERE =
  /(ec[- ]?karte|ec[- ]?cash|girocard|karten?zahlung|kreditkarte|mastercard|\bvisa\b|maestro|\bbar(zahlung|geld)?\b|rückgeld|ruckgeld|wechselgeld|\bgeg\.|gegeben|zurück\b|zu ?zahlen|mwst|ust-?id|steuer|\btse\b|signatur|seriennummer|transaktion|terminal|kundenbeleg|beleg-?nr|bon-?nr|zwischensumme)/i;

/** A price at the end of a line: "1,19", "1,19 A", "-0,50", "1,19 EUR". */
const TRAILING_PRICE =
  /^(?<name>.*?)[\s.:*]*(?<sign>[-−])?\s*(?<price>\d{1,5}(?:[.\s]\d{3})*[.,]\d{2})\s*(?:€|EUR|eur)?\s*(?<tax>[A-Z]{1,2}\*?|\*)?\s*$/;

/** "2 x 0,89", "2 Stk x 0,89", "0,532 kg x 2,99 EUR/kg", "3 X 1,50". */
const MULTIPLIER =
  /^\s*(?<qty>\d+(?:[.,]\d+)?)\s*(?<unit>stk\.?|st\.?|kg|g|l|ml|x)?\s*[x×*]\s*(?<unitPrice>\d{1,4}[.,]\d{2})\s*(?:€|EUR)?(?:\s*\/\s*(?:kg|g|l|ml|stk?))?\s*$/i;

/** "SUMME 6,30", "zu zahlen 6,30", "GESAMT EUR 6,30". */
const TOTAL_LINE = /^(summe|gesamtsumme|gesamt|zu ?zahlen|total|endbetrag)\b/i;

const DATE = /(?<d>[0-3]?\d)[.\/](?<m>[01]?\d)[.\/](?<y>\d{4}|\d{2})/;

/** German decimal comma, optional thousands separator. Returns integer cents. */
export function toCents(raw: string): number | null {
  const cleaned = raw.replace(/\s/g, '');
  // The last separator is the decimal one; anything before it groups thousands.
  const match = /^(?<whole>[\d.,]*\d)[.,](?<frac>\d{2})$/.exec(cleaned);
  if (!match?.groups) return null;

  const whole = match.groups.whole.replace(/[.,]/g, '');
  const cents = Number(whole) * 100 + Number(match.groups.frac);
  return Number.isFinite(cents) ? cents : null;
}

function countDecimals(line: string): number {
  return (line.match(/\d{1,5}[.,]\d{2}\b/g) ?? []).length;
}

/**
 * The tax summary block at the foot of every German receipt:
 *
 *   MwSt%   Netto    MwSt   Brutto
 *   A 19%    4,63    0,88     5,51
 *
 * Three or more amounts on one line is the tell — no purchase line has that —
 * plus a row that *opens* with a tax class and a percentage, for tills that
 * print the block in two columns instead of four.
 *
 * Note what is deliberately NOT a signal here: a percentage anywhere in the
 * line. "MILCH 3,5%" is the single most common item on a German receipt, and
 * treating "%" as tax-table evidence silently drops it.
 */
function isTaxTableRow(line: string): boolean {
  return countDecimals(line) >= 3 || /^[A-Z]\s?\d{1,2}(?:[.,]\d)?\s?%/.test(line);
}

export function parseReceiptText(text: string): ParsedReceipt {
  const rawLines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  const lines: ParsedReceiptLine[] = [];
  let totalCents: number | undefined;
  let merchant: string | undefined;
  let purchasedAt: string | undefined;

  for (const line of rawLines) {
    if (!purchasedAt) {
      const date = DATE.exec(line);
      if (date?.groups) {
        const year = date.groups.y.length === 2 ? `20${date.groups.y}` : date.groups.y;
        const month = date.groups.m.padStart(2, '0');
        const day = date.groups.d.padStart(2, '0');
        // Guarded because "12.34" in an address would otherwise become a date.
        if (Number(month) >= 1 && Number(month) <= 12 && Number(day) >= 1 && Number(day) <= 31) {
          purchasedAt = `${year}-${month}-${day}`;
        }
      }
    }

    // A quantity line modifies the item above it rather than being one.
    const multiplier = MULTIPLIER.exec(line);
    if (multiplier?.groups && lines.length > 0) {
      const quantity = Number(multiplier.groups.qty.replace(',', '.'));
      const unitPriceCents = toCents(multiplier.groups.unitPrice);
      const previous = lines[lines.length - 1];
      if (Number.isFinite(quantity) && quantity > 0) previous.quantity = quantity;
      if (unitPriceCents !== null) previous.unitPriceCents = unitPriceCents;
      continue;
    }

    if (isTaxTableRow(line)) continue;

    const priced = TRAILING_PRICE.exec(line);
    if (!priced?.groups) {
      // The shop's name is the first line with letters and no price on it.
      if (!merchant && /[a-zäöüß]{3}/i.test(line) && !/\d{4,}/.test(line)) {
        merchant = line.replace(/\s{2,}/g, ' ');
      }
      continue;
    }

    const name = priced.groups.name.replace(/\s{2,}/g, ' ').trim();
    const cents = toCents(priced.groups.price);
    if (cents === null) continue;

    const signed = priced.groups.sign ? -cents : cents;

    if (TOTAL_LINE.test(name)) {
      // The first total wins: what follows is usually the same number again
      // as "gegeben" and "zurück".
      totalCents ??= signed;
      continue;
    }

    // A price with no name is a column fragment, not a purchase.
    if (!name || !/[a-zäöüß]{2}/i.test(name)) continue;
    if (NOT_AN_ITEM.test(name) || NOT_AN_ITEM_ANYWHERE.test(name)) continue;

    lines.push({ name, totalCents: signed });
  }

  return {
    merchant,
    purchasedAt,
    totalCents,
    currency: 'EUR',
    lines,
    confidence: scoreConfidence(lines, totalCents),
  };
}

/**
 * How much to trust this parse — and it is a real measurement, not a guess.
 *
 * A receipt is self-checking: the items have to add up to the total printed
 * at the bottom. If they do, every line was found and read correctly, because
 * a missed line or a misread digit would break the sum. That makes the
 * agreement between the two the honest confidence signal, and it is what the
 * UI uses to decide between "prices are filled in" and "please check these".
 */
function scoreConfidence(lines: ParsedReceiptLine[], totalCents?: number): number {
  if (lines.length === 0) return 0;
  // Without a total there is nothing to check against; enough to show, not
  // enough to trust silently.
  if (totalCents === undefined || totalCents <= 0) return 0.5;

  const sum = lines.reduce((acc, line) => acc + line.totalCents, 0);
  const gap = Math.abs(sum - totalCents);
  if (gap <= 2) return 0.97;

  // Scaled by how far off it is: 5% out is still probably usable, 50% is not.
  const relative = gap / totalCents;
  return Math.max(0.1, Math.min(0.9, 0.9 - relative * 2));
}
