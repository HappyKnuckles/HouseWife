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
import { handlePreflight, jsonResponse } from '../_shared/cors.ts';
import { serviceClient } from '../_shared/supabase.ts';
import { type ParsedReceipt, parseReceiptText } from './parse-receipt.ts';

export type { ParsedReceipt, ParsedReceiptLine } from './parse-receipt.ts';

export interface ReceiptOcrProvider {
  readonly name: string;
  parse(input: { signedUrl: string; mimeType: string }): Promise<ParsedReceipt>;
}

const noopProvider: ReceiptOcrProvider = {
  name: 'noop',
  parse: () => Promise.resolve({ lines: [], confidence: 0 }),
};

/** btoa() needs a binary string, and a receipt photo is too big for one spread. */
function toBase64(bytes: Uint8Array): string {
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

/**
 * Google Cloud Vision.
 *
 * Two halves, and only the first is Google's: DOCUMENT_TEXT_DETECTION returns
 * the text on the paper, and parse-receipt.ts turns that into line items.
 * Vision has no concept of a receipt — it cannot tell a purchase from a tax
 * table — so the parser is where the accuracy actually comes from, and it is
 * tested on its own (`npm run test:receipt`).
 *
 * The image is fetched and sent inline rather than handed over as a URL:
 * Vision's `imageUri` would accept the signed URL, but that makes Google's
 * fetcher a second thing that can fail, against a link that expires in 120s.
 *
 * Authenticated with an API key rather than a service account — the whole call
 * is one HTTP POST, and a key restricted to the Vision API is both a smaller
 * blast radius and far less machinery than signing JWTs in Deno.
 */
const googleVisionProvider: ReceiptOcrProvider = {
  name: 'google-vision',
  async parse({ signedUrl }) {
    const apiKey = Deno.env.get('GOOGLE_VISION_API_KEY');
    if (!apiKey) throw new Error('GOOGLE_VISION_API_KEY is not set');

    const image = await fetch(signedUrl);
    if (!image.ok) throw new Error(`could not read the receipt image (${image.status})`);

    const response = await fetch(
      `https://vision.googleapis.com/v1/images:annotate?key=${encodeURIComponent(apiKey)}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          requests: [
            {
              image: { content: toBase64(new Uint8Array(await image.arrayBuffer())) },
              // DOCUMENT_TEXT_DETECTION, not TEXT_DETECTION: a receipt is a
              // dense column of small type, which is what it is tuned for.
              features: [{ type: 'DOCUMENT_TEXT_DETECTION' }],
              imageContext: { languageHints: ['de'] },
            },
          ],
        }),
      },
    );

    const payload = await response.json();
    if (!response.ok) {
      throw new Error(payload?.error?.message ?? `Vision API returned ${response.status}`);
    }

    const result = payload?.responses?.[0];
    // Vision reports per-image failures inside a 200 response.
    if (result?.error?.message) throw new Error(result.error.message);

    const text: string = result?.fullTextAnnotation?.text ?? '';

    // The raw text goes onto the receipt row: when a parse comes out wrong,
    // that is what says whether Vision misread the paper or the parser misread
    // Vision — and it is the fixture to paste into receipt-parse.test.mjs.
    return { ...parseReceiptText(text), raw: { text } };
  },
};

const PROVIDERS: Record<string, ReceiptOcrProvider> = {
  noop: noopProvider,
  'google-vision': googleVisionProvider,
};

function activeProvider(): ReceiptOcrProvider {
  return PROVIDERS[Deno.env.get('OCR_PROVIDER') ?? 'noop'] ?? noopProvider;
}

const json = jsonResponse;

Deno.serve(async (req) => {
  const preflight = handlePreflight(req);
  if (preflight) return preflight;

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
