/**
 * Receipt parser tests.
 *
 *   npm run test:receipt
 *
 * The parser is the part of OCR that is ours rather than Google's, and the
 * part that will need tuning against real receipts — so it runs under plain
 * node (via type stripping) instead of only inside Deno, and the fixtures
 * below are the shapes German discounters actually print.
 *
 * When a real receipt parses badly: paste its text in as a new fixture, watch
 * the assertion fail, then fix the parser. That is the whole workflow.
 */
import { parseReceiptText, toCents } from '../functions/ocr-receipt/parse-receipt.ts';

let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => {
  if (cond) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name} ${extra}`); }
};
const section = (s) => console.log(`\n=== ${s} ===`);

section('cents parsing');
ok('German decimal comma', toCents('1,19') === 119);
ok('thousands separator', toCents('1.234,56') === 123456);
ok('dot as decimal separator', toCents('1.19') === 119);
ok('rejects a bare integer', toCents('119') === null);

section('a plain REWE receipt');
const rewe = parseReceiptText(`REWE Markt GmbH
Musterstraße 1
12345 Berlin

MILCH 3,5% 1,19 A
BUTTER MARKENBUTTER 2,29 A
BANANEN 1,78 B
GURKE 0,79 B
PFAND 0,25 A
SUMME 6,30
Geg. EC-Karte 6,30

MwSt% Netto MwSt Brutto
A 19% 3,13 0,60 3,73
B 7% 2,40 0,17 2,57

Datum: 03.08.2026 14:32
Vielen Dank für Ihren Einkauf`);

ok('finds every item and nothing else', rewe.lines.length === 5,
   JSON.stringify(rewe.lines.map((l) => l.name)));
ok('reads the first price', rewe.lines[0].name === 'MILCH 3,5%' && rewe.lines[0].totalCents === 119,
   JSON.stringify(rewe.lines[0]));
ok('keeps Pfand — it is money', rewe.lines.some((l) => /pfand/i.test(l.name)), JSON.stringify(rewe.lines));
ok('finds the total', rewe.totalCents === 630, String(rewe.totalCents));
ok('the tax table is not shopping', !rewe.lines.some((l) => /mwst|19%|7%/i.test(l.name)),
   JSON.stringify(rewe.lines.map((l) => l.name)));
ok('the payment line is not shopping', !rewe.lines.some((l) => /ec-karte|geg/i.test(l.name)),
   JSON.stringify(rewe.lines.map((l) => l.name)));
ok('reads the date', rewe.purchasedAt === '2026-08-03', String(rewe.purchasedAt));
ok('reads the merchant', /REWE/.test(rewe.merchant ?? ''), String(rewe.merchant));
// The items add up to the printed total, which is the whole confidence signal.
ok('items summing to the total is high confidence', rewe.confidence > 0.9, String(rewe.confidence));

section('quantities and weights');
const lidl = parseReceiptText(`Lidl
JOGHURT 1,98 A
2 x 0,99
BANANEN 1,59 B
0,532 kg x 2,99 EUR/kg
SUMME 3,57`);

ok('a multiplier line is not its own item', lidl.lines.length === 2,
   JSON.stringify(lidl.lines.map((l) => l.name)));
ok('...it sets quantity and unit price on the item above',
   lidl.lines[0].quantity === 2 && lidl.lines[0].unitPriceCents === 99,
   JSON.stringify(lidl.lines[0]));
ok('a weight line does the same',
   lidl.lines[1].quantity === 0.532 && lidl.lines[1].unitPriceCents === 299,
   JSON.stringify(lidl.lines[1]));
ok('...and the line total stays what was charged', lidl.lines[1].totalCents === 159,
   String(lidl.lines[1].totalCents));

section('discounts');
const discounted = parseReceiptText(`Netto
KAFFEE 4,99 A
RABATT -1,00 A
SUMME 3,99`);
ok('a discount is a negative line, not a dropped one',
   discounted.lines.length === 2 && discounted.lines[1].totalCents === -100,
   JSON.stringify(discounted.lines));
ok('...and it still adds up', discounted.confidence > 0.9, String(discounted.confidence));

section('when the read went wrong');
const misread = parseReceiptText(`Aldi
MEHL 1,49 A
ZUCKER 0,89 A
SUMME 9,38`);
ok('items that do not reach the total lower the confidence',
   misread.confidence < 0.6, String(misread.confidence));

const noTotal = parseReceiptText(`Edeka
MEHL 1,49 A
ZUCKER 0,89 A`);
ok('no total means nothing to check against', noTotal.confidence === 0.5, String(noTotal.confidence));

ok('an unreadable photo yields nothing rather than noise',
   parseReceiptText('').lines.length === 0 && parseReceiptText('').confidence === 0);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
