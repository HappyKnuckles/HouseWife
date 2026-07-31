/**
 * lookup-barcode — scan → lookup → store, server side.
 *
 * This is the extension point for an external product database. Providers are
 * tried in order and the first hit wins; results (including misses) are cached
 * in product_lookup_cache, which is global rather than per-household because
 * "EAN 4001686315101 is Ritter Sport Vollnuss" is a fact about the world.
 *
 * Ships with three providers, the first two on by default:
 *   openfoodfacts     food & groceries. Millions of products, strong EU coverage.
 *   openproductsfacts everything that isn't food — cleaning supplies, toiletries,
 *                     household goods. Same platform and JSON shape as Open Food
 *                     Facts (Product Opener), much smaller catalog (~40k products
 *                     vs. millions), so misses are expected and just fall through
 *                     to manual entry.
 *   null              always misses — kept as an explicit opt-out; set
 *                     BARCODE_PROVIDERS=null to look up nothing.
 *
 * Override with the BARCODE_PROVIDERS secret, e.g.
 *   supabase secrets set BARCODE_PROVIDERS=openfoodfacts,openproductsfacts
 *
 * Adding a new one is a single object in the PROVIDERS map below; no schema
 * change and no client change.
 */
import { createClient } from 'npm:@supabase/supabase-js@2';
import { handlePreflight, jsonResponse } from '../_shared/cors.ts';
import { serviceClient } from '../_shared/supabase.ts';

/** What every provider must return. Mirrors src/features/inventory/types.ts. */
export interface ProductLookupResult {
  barcode: string;
  name: string;
  brand?: string;
  category?: string;
  unit?: 'piece' | 'g' | 'kg' | 'ml' | 'l' | 'pack';
  netQuantity?: number;
  imageUrl?: string;
  raw?: unknown;
}

export interface BarcodeProvider {
  readonly name: string;
  lookup(barcode: string): Promise<ProductLookupResult | null>;
}

const nullProvider: BarcodeProvider = {
  name: 'null',
  lookup: () => Promise.resolve(null),
};

/**
 * Both Open *X* Facts providers run on the same open-source platform (Product
 * Opener) and return an identical JSON shape — only the host and the catalog
 * behind it differ. One request builder, parameterised by host, instead of
 * two near-duplicate functions that would drift apart over time.
 */
function makeProductOpenerProvider(name: string, host: string): BarcodeProvider {
  return {
    name,
    async lookup(barcode) {
      const res = await fetch(
        `https://${host}/api/v2/product/${barcode}.json` +
          `?fields=product_name,product_name_de,brands,categories,quantity,image_url`,
        { headers: { 'User-Agent': 'Haushalt/1.0 (self-hosted household app)' } },
      );

      if (!res.ok) return null;

      const json = await res.json() as {
        status?: number;
        product?: Record<string, string | undefined>;
      };
      if (json.status !== 1 || !json.product) return null;

      const p = json.product;
      // Sparsely-filled entries (common on the smaller Open Products Facts
      // catalog) can have a barcode but no name at all — not usable as a match.
      const productName = p.product_name_de || p.product_name;
      if (!productName) return null;

      return {
        barcode,
        name: productName,
        brand: p.brands?.split(',')[0]?.trim(),
        category: p.categories?.split(',')[0]?.trim(),
        imageUrl: p.image_url,
        raw: json.product,
      };
    },
  };
}

const openFoodFacts = makeProductOpenerProvider('openfoodfacts', 'world.openfoodfacts.org');
const openProductsFacts = makeProductOpenerProvider('openproductsfacts', 'world.openproductsfacts.org');

const PROVIDERS: Record<string, BarcodeProvider> = {
  null: nullProvider,
  openfoodfacts: openFoodFacts,
  openproductsfacts: openProductsFacts,
};

/** Food first: the larger, better-maintained catalog gets the first try. */
const DEFAULT_PROVIDERS = 'openfoodfacts,openproductsfacts';

function activeProviders(): BarcodeProvider[] {
  const configured = (Deno.env.get('BARCODE_PROVIDERS') ?? DEFAULT_PROVIDERS)
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

  const providers = configured.map((n) => PROVIDERS[n]).filter(Boolean);
  return providers.length > 0 ? providers : [nullProvider];
}

const json = jsonResponse;

Deno.serve(async (req) => {
  const preflight = handlePreflight(req);
  if (preflight) return preflight;

  if (req.method !== 'POST') return json({ error: 'method not allowed' }, 405);

  // Authenticate the caller. This function is deployed *with* JWT verification,
  // but we still resolve the user so an anonymous key alone is not enough.
  const authHeader = req.headers.get('Authorization') ?? '';
  const userClient = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_ANON_KEY')!,
    { global: { headers: { Authorization: authHeader } }, auth: { persistSession: false } },
  );

  const { data: { user } } = await userClient.auth.getUser();
  if (!user) return json({ error: 'unauthorized' }, 401);

  let barcode: string;
  try {
    barcode = String(((await req.json()) as { barcode?: string }).barcode ?? '').trim();
  } catch {
    return json({ error: 'invalid JSON body' }, 400);
  }

  if (!/^[0-9]{6,14}$/.test(barcode)) {
    return json({ error: 'barcode must be 6–14 digits' }, 400);
  }

  const admin = serviceClient();

  // Cache first — including cached misses, so a barcode no provider knows is
  // not re-fetched on every scan.
  const { data: cached } = await admin
    .from('product_lookup_cache')
    .select('barcode, provider, found, payload, hit_count')
    .eq('barcode', barcode)
    .maybeSingle();

  if (cached) {
    await admin
      .from('product_lookup_cache')
      .update({ hit_count: (cached.hit_count ?? 0) + 1 })
      .eq('barcode', barcode);

    return json({
      source: 'cache',
      provider: cached.provider,
      found: cached.found,
      product: cached.found ? cached.payload : null,
    });
  }

  let result: ProductLookupResult | null = null;
  let providerName = 'null';

  for (const provider of activeProviders()) {
    try {
      result = await provider.lookup(barcode);
    } catch (err) {
      console.error(`barcode provider ${provider.name} failed:`, err);
      continue;
    }
    if (result) {
      providerName = provider.name;
      break;
    }
  }

  await admin.from('product_lookup_cache').upsert({
    barcode,
    provider: providerName,
    found: result !== null,
    payload: result,
    fetched_at: new Date().toISOString(),
  });

  return json({
    source: 'provider',
    provider: providerName,
    found: result !== null,
    product: result,
  });
});
