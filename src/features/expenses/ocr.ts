/**
 * Receipt OCR — client-side contract.
 *
 * The interface is defined and the call path works end to end; the provider
 * behind the Edge Function is a no-op until one is configured. Nothing in the
 * expense flow depends on OCR succeeding: a receipt is attached, `ocr_status`
 * moves to 'skipped', and the user types the total as they otherwise would.
 *
 * Server side lives in supabase/functions/ocr-receipt/index.ts and writes its
 * answer to receipts.ocr_parsed in exactly this shape.
 */
import type { ExpenseItemInput, Json, ReceiptRow } from '../../lib/database.types';
import { supabase } from '../../lib/supabase';

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
  /** 0–1. Anything below this is presented as "bitte prüfen". */
  confidence: number;
}

export const OCR_TRUST_THRESHOLD = 0.6;

/** Asks the Edge Function to parse an already-uploaded receipt. */
export async function requestOcr(receiptId: string): Promise<{ status: string; parsed?: ParsedReceipt }> {
  const { data, error } = await supabase.functions.invoke('ocr-receipt', {
    body: { receiptId },
  });

  if (error) throw error;
  return data as { status: string; parsed?: ParsedReceipt };
}

export function parseReceiptPayload(payload: Json | null): ParsedReceipt | null {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return null;
  const candidate = payload as unknown as ParsedReceipt;
  if (!Array.isArray(candidate.lines)) return null;
  return candidate;
}

/** Turns a parsed receipt into editable expense line items. */
export function toExpenseItems(parsed: ParsedReceipt): ExpenseItemInput[] {
  return parsed.lines.map((line, index) => ({
    name: line.name,
    total_cents: line.totalCents,
    quantity: line.quantity ?? 1,
    unit_price_cents: line.unitPriceCents ?? null,
    position: index,
    source: 'ocr' as const,
  }));
}

export function ocrStatusLabel(receipt: Pick<ReceiptRow, 'ocr_status'>): string {
  switch (receipt.ocr_status) {
    case 'pending':
      return 'Warte auf Auswertung';
    case 'processing':
      return 'Wird ausgewertet…';
    case 'done':
      return 'Automatisch ausgelesen';
    case 'failed':
      return 'Auswertung fehlgeschlagen';
    case 'skipped':
    default:
      return 'Kein OCR-Anbieter konfiguriert';
  }
}
