/**
 * ocr-receipt — receipt parsing, stubbed on purpose.
 *
 * The plumbing is complete and working: authenticate, resolve the receipt row,
 * sign a URL for the stored image, run a provider, write the result back to
 * receipts.ocr_parsed / ocr_status. Only the provider itself is a no-op.
 *
 * That is the deliberate shape of this deliverable — OCR was a nice-to-have and
 * nothing else is allowed to depend on it. Wiring up a real one (Google Vision,
 * Taggun, Mindee, a local model) means writing one object that satisfies
 * ReceiptOcrProvider and adding it to PROVIDERS. No schema change, no client
 * change: the app already renders ocr_parsed.lines as editable expense items
 * and flags them with source = 'ocr'.
 */
import { createClient } from 'npm:@supabase/supabase-js@2';
import { serviceClient } from '../_shared/supabase.ts';

/** Mirrors src/features/expenses/ocr.ts on the client. */
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
  /** 0–1. The client warns before trusting anything below ~0.6. */
  confidence: number;
  raw?: unknown;
}

export interface ReceiptOcrProvider {
  readonly name: string;
  parse(input: { signedUrl: string; mimeType: string }): Promise<ParsedReceipt>;
}

const noopProvider: ReceiptOcrProvider = {
  name: 'noop',
  parse: () => Promise.resolve({ lines: [], confidence: 0 }),
};

const PROVIDERS: Record<string, ReceiptOcrProvider> = {
  noop: noopProvider,
};

function activeProvider(): ReceiptOcrProvider {
  return PROVIDERS[Deno.env.get('OCR_PROVIDER') ?? 'noop'] ?? noopProvider;
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json({ error: 'method not allowed' }, 405);

  const authHeader = req.headers.get('Authorization') ?? '';
  const userClient = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_ANON_KEY')!,
    { global: { headers: { Authorization: authHeader } }, auth: { persistSession: false } },
  );

  const { data: { user } } = await userClient.auth.getUser();
  if (!user) return json({ error: 'unauthorized' }, 401);

  let receiptId: string;
  try {
    receiptId = String(((await req.json()) as { receiptId?: string }).receiptId ?? '');
  } catch {
    return json({ error: 'invalid JSON body' }, 400);
  }
  if (!receiptId) return json({ error: 'receiptId is required' }, 400);

  // Read through the *user's* client so RLS decides whether they may see this
  // receipt. The service client below only does the write-back.
  const { data: receipt, error } = await userClient
    .from('receipts')
    .select('id, storage_path, mime_type, ocr_status')
    .eq('id', receiptId)
    .maybeSingle();

  if (error || !receipt) return json({ error: 'receipt not found' }, 404);

  const admin = serviceClient();
  const provider = activeProvider();

  await admin
    .from('receipts')
    .update({ ocr_status: 'processing', ocr_provider: provider.name })
    .eq('id', receiptId);

  try {
    const { data: signed, error: signErr } = await admin.storage
      .from('receipts')
      .createSignedUrl(receipt.storage_path as string, 120);

    if (signErr || !signed) throw signErr ?? new Error('could not sign receipt URL');

    const parsed = await provider.parse({
      signedUrl: signed.signedUrl,
      mimeType: (receipt.mime_type as string) ?? 'image/jpeg',
    });

    // The no-op provider returns nothing useful; recording that as 'skipped'
    // rather than 'done' keeps "OCR ran and found nothing" distinguishable
    // from "OCR is not configured".
    const status = provider.name === 'noop' || parsed.lines.length === 0 ? 'skipped' : 'done';

    await admin
      .from('receipts')
      .update({
        ocr_status: status,
        ocr_parsed: parsed,
        ocr_raw: parsed.raw ?? null,
        ocr_error: null,
        ocr_completed_at: new Date().toISOString(),
      })
      .eq('id', receiptId);

    return json({ ok: true, status, provider: provider.name, parsed });
  } catch (err) {
    await admin
      .from('receipts')
      .update({
        ocr_status: 'failed',
        ocr_error: String(err),
        ocr_completed_at: new Date().toISOString(),
      })
      .eq('id', receiptId);

    return json({ ok: false, error: String(err) }, 500);
  }
});
