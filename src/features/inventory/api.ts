import type {
  InventoryItemRow,
  InventoryTotalRow,
  LocationPathRow,
  MovementReason,
  ProductRow,
  ProductUnit,
  StorageLocationRow,
} from '../../lib/database.types';
import { supabase } from '../../lib/supabase';

/** What a barcode provider returns. Mirrors the Edge Function's type. */
export interface ProductLookupResult {
  barcode: string;
  name: string;
  brand?: string;
  category?: string;
  unit?: ProductUnit;
  netQuantity?: number;
  imageUrl?: string;
}

export interface LookupResponse {
  source: 'cache' | 'provider';
  provider: string;
  found: boolean;
  product: ProductLookupResult | null;
}

export interface InventoryItemWithRefs extends InventoryItemRow {
  products: Pick<ProductRow, 'id' | 'name' | 'brand' | 'barcode' | 'image_url' | 'unit'> | null;
  storage_locations: { id: string; name: string } | null;
}

export async function fetchInventoryTotals(householdId: string): Promise<InventoryTotalRow[]> {
  const { data, error } = await supabase
    .from('v_inventory_totals')
    .select('*')
    .eq('household_id', householdId)
    .order('name', { ascending: true });

  if (error) throw error;
  return data ?? [];
}

export async function fetchItems(householdId: string): Promise<InventoryItemWithRefs[]> {
  const { data, error } = await supabase
    .from('inventory_items')
    .select('*, products(id, name, brand, barcode, image_url, unit), storage_locations(id, name)')
    .eq('household_id', householdId)
    .order('updated_at', { ascending: false });

  if (error) throw error;
  return (data ?? []) as unknown as InventoryItemWithRefs[];
}

export async function fetchItemsForProduct(productId: string): Promise<InventoryItemWithRefs[]> {
  const { data, error } = await supabase
    .from('inventory_items')
    .select('*, products(id, name, brand, barcode, image_url, unit), storage_locations(id, name)')
    .eq('product_id', productId);

  if (error) throw error;
  return (data ?? []) as unknown as InventoryItemWithRefs[];
}

/** Locations with their full "Küche › Vorratsschrank" path for the picker. */
export async function fetchLocations(householdId: string): Promise<LocationPathRow[]> {
  const { data, error } = await supabase
    .from('v_location_paths')
    .select('*')
    .eq('household_id', householdId)
    .order('path', { ascending: true });

  if (error) throw error;
  return data ?? [];
}

/**
 * Creates one or more locations in a single insert.
 *
 * Plural rather than a loop in the caller: "Schrank, dann Schub 1 bis 3" is
 * one thought and should be one round trip, and a partial failure halfway
 * through a loop would leave the household with three of five drawers and no
 * obvious way to tell which.
 */
export async function createLocations(input: {
  householdId: string;
  names: string[];
  kind: LocationPathRow['kind'];
  parentId?: string | null;
}): Promise<StorageLocationRow[]> {
  const { data, error } = await supabase
    .from('storage_locations')
    .insert(
      input.names.map((name) => ({
        household_id: input.householdId,
        name: name.trim(),
        kind: input.kind,
        parent_id: input.parentId ?? null,
      })),
    )
    .select();

  if (error) throw error;
  return data ?? [];
}

/**
 * A short code to label a physical location with — printed or screenshotted
 * as a QR code and stuck on the actual shelf/drawer. Same unambiguous
 * alphabet as household invite codes (no 0/O/1/I), just longer: 8 characters
 * from a 32-symbol alphabet is ~1e12 combinations, comfortably collision-free
 * for the handful of locations one household has, with a DB-level unique
 * index as the real backstop.
 */
export function generateLocationCode(): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 8; i++) {
    code += alphabet[Math.floor(Math.random() * alphabet.length)];
  }
  return `LOC-${code}`;
}

/**
 * Assigns a code to a location, retrying on the rare collision. The unique
 * index (household_id, barcode) is the actual guarantee; this loop just makes
 * a collision self-heal instead of surfacing as an error.
 */
export async function assignLocationBarcode(
  locationId: string,
  existingCode?: string | null,
): Promise<StorageLocationRow> {
  if (existingCode) {
    const { data, error } = await supabase
      .from('storage_locations')
      .update({ barcode: existingCode })
      .eq('id', locationId)
      .select()
      .single();
    if (error) throw error;
    return data;
  }

  for (let attempt = 0; attempt < 5; attempt++) {
    const { data, error } = await supabase
      .from('storage_locations')
      .update({ barcode: generateLocationCode() })
      .eq('id', locationId)
      .select()
      .single();

    if (!error) return data;
    // 23505 = unique_violation. Any other error is real and should surface.
    if (error.code !== '23505') throw error;
  }

  throw new Error('Konnte keinen eindeutigen Code erzeugen. Bitte erneut versuchen.');
}

export async function clearLocationBarcode(locationId: string): Promise<void> {
  const { error } = await supabase
    .from('storage_locations')
    .update({ barcode: null })
    .eq('id', locationId);

  if (error) throw error;
}

export async function findLocationByBarcode(
  householdId: string,
  barcode: string,
): Promise<LocationPathRow | null> {
  const { data, error } = await supabase
    .from('v_location_paths')
    .select('*')
    .eq('household_id', householdId)
    .eq('barcode', barcode)
    .maybeSingle();

  if (error) throw error;
  return data;
}

/**
 * Deleting a location does not touch its stock — inventory_items.location_id
 * is ON DELETE SET NULL, so items just become "ohne Ort" rather than being
 * deleted. Sub-locations are the opposite: storage_locations.parent_id is ON
 * DELETE CASCADE, so deleting "Küche" also deletes "Vorratsschrank" beneath
 * it. The caller is responsible for warning about that before calling this.
 */
export async function deleteLocation(locationId: string): Promise<void> {
  const { error } = await supabase.from('storage_locations').delete().eq('id', locationId);
  if (error) throw error;
}

/** Local catalog hit — the first and fastest step of the scan flow. */
export async function findProductByBarcode(
  householdId: string,
  barcode: string,
): Promise<ProductRow | null> {
  const { data, error } = await supabase
    .from('products')
    .select('*')
    .eq('household_id', householdId)
    .eq('barcode', barcode)
    .maybeSingle();

  if (error) throw error;
  return data;
}

/**
 * Typeahead for manual entry.
 *
 * Picking a suggestion rather than retyping is what keeps "Mehl" one catalog
 * entry instead of three. inventory_scan_in() also matches on the normalised
 * name as a backstop, so a near-miss here is a duplicate avoided anyway —
 * this is the visible half of the same guarantee.
 */
export async function searchProducts(
  householdId: string,
  query: string,
  limit = 8,
): Promise<ProductRow[]> {
  const needle = query.trim();
  if (needle.length < 2) return [];

  const { data, error } = await supabase
    .from('products')
    .select('*')
    .eq('household_id', householdId)
    // ilike, not full-text: a household catalog is hundreds of rows, and
    // "was heißt das nochmal" is a prefix/substring question, not a ranked one.
    .ilike('name', `%${needle}%`)
    .order('name')
    .limit(limit);

  if (error) throw error;
  return data ?? [];
}

export async function fetchProduct(productId: string): Promise<ProductRow | null> {
  const { data, error } = await supabase
    .from('products')
    .select('*')
    .eq('id', productId)
    .maybeSingle();

  if (error) throw error;
  return data;
}

/**
 * Marks a product as a staple, or stops tracking it (null).
 *
 * Deliberately on the product and not on a lot: an emptied lot is deleted by
 * inventory_adjust(), which would take the threshold with it — exactly when
 * the reminder matters most.
 */
export async function setRestockThreshold(
  productId: string,
  threshold: number | null,
): Promise<ProductRow> {
  const { data, error } = await supabase
    .from('products')
    .update({ restock_min_quantity: threshold })
    .eq('id', productId)
    .select()
    .single();

  if (error) throw error;
  return data;
}

/**
 * External lookup, step three of the scan flow.
 *
 * Ships pointed at a null provider that always misses, so scanning works
 * end to end without depending on a third party. Enable a real one with
 * `supabase secrets set BARCODE_PROVIDERS=openfoodfacts` — no app change.
 */
export async function lookupBarcode(barcode: string): Promise<LookupResponse> {
  const { data, error } = await supabase.functions.invoke('lookup-barcode', {
    body: { barcode },
  });

  if (error) throw error;
  return data as LookupResponse;
}

/**
 * Adds stock. Finds or creates the catalog entry, adds to the right
 * product/location/expiry lot and writes the movement log — one transaction.
 */
export async function scanIn(input: {
  barcode?: string | null;
  name?: string | null;
  locationId?: string | null;
  quantity?: number;
  unit?: ProductUnit;
  expiresOn?: string | null;
  brand?: string | null;
  imageUrl?: string | null;
  externalProvider?: string | null;
}): Promise<InventoryItemRow> {
  const { data, error } = await supabase.rpc('inventory_scan_in', {
    p_barcode: input.barcode ?? null,
    p_name: input.name ?? null,
    p_location_id: input.locationId ?? null,
    p_quantity: input.quantity ?? 1,
    p_unit: input.unit ?? 'piece',
    p_expires_on: input.expiresOn ?? null,
    p_brand: input.brand ?? null,
    p_image_url: input.imageUrl ?? null,
    p_external_provider: input.externalProvider ?? null,
  });

  if (error) throw error;
  return data as InventoryItemRow;
}

export async function adjustQuantity(
  itemId: string,
  delta: number,
  reason: MovementReason = 'manual_adjust',
  note?: string,
): Promise<InventoryItemRow> {
  const { data, error } = await supabase.rpc('inventory_adjust', {
    p_item_id: itemId,
    p_delta: delta,
    p_reason: reason,
    p_note: note ?? null,
  });

  if (error) throw error;
  return data as InventoryItemRow;
}

/**
 * Corrects the catalog entry itself — the name you mistyped, the brand the
 * lookup got wrong, the unit.
 *
 * Note there is no uniqueness on product names, so renaming one product onto
 * another's name leaves you with two entries that look identical. Merging
 * products is a bigger feature than this; the name matching in
 * inventory_scan_in() only prevents duplicates being *created*, it cannot
 * retroactively fuse two that already exist.
 */
export async function updateProduct(
  productId: string,
  patch: Partial<Pick<ProductRow, 'name' | 'brand' | 'unit' | 'category' | 'notes'>>,
): Promise<ProductRow> {
  const { data, error } = await supabase
    .from('products')
    .update(patch)
    .eq('id', productId)
    .select()
    .single();

  if (error) throw error;
  return data;
}

/**
 * Moves stock to another location — all of a lot, or `quantity` of it.
 *
 * An RPC rather than an update on location_id, because the destination may
 * already hold this product at the same expiry — which is the normal case,
 * not an error — and the lot-uniqueness index would reject it. The function
 * merges the two lots instead, or splits off a new one for a partial move.
 * See migrations 0017 and 0018.
 *
 * Returns the lot the stock ended up in, which for a partial move is a
 * different row than the one that was passed in.
 */
export async function moveItem(
  itemId: string,
  locationId: string | null,
  quantity?: number | null,
): Promise<InventoryItemRow> {
  const { data, error } = await supabase.rpc('inventory_move', {
    p_item_id: itemId,
    p_location_id: locationId,
    p_quantity: quantity ?? null,
  });

  if (error) throw error;
  return data as InventoryItemRow;
}

export async function updateItem(
  itemId: string,
  patch: Partial<Pick<InventoryItemRow, 'location_id' | 'min_quantity' | 'expires_on' | 'note'>>,
) {
  const { data, error } = await supabase
    .from('inventory_items')
    .update(patch)
    .eq('id', itemId)
    .select()
    .single();

  if (error) throw error;
  return data;
}

export async function deleteItem(itemId: string): Promise<void> {
  const { error } = await supabase.from('inventory_items').delete().eq('id', itemId);
  if (error) throw error;
}

/**
 * Renames / re-types / re-parents a location.
 *
 * An RPC only for the cycle check: parent_id is a plain self-reference, so
 * making a location its own grandparent passes every constraint on the table
 * and then hangs the recursive CTE behind v_location_paths — taking the Orte
 * screen with it, including the screen you would need to undo it. See
 * migration 0022.
 *
 * NULL means "leave alone", so detaching from a parent has its own flag.
 */
export async function updateLocation(
  locationId: string,
  patch: { name?: string; kind?: string; parentId?: string | null; clearParent?: boolean },
): Promise<StorageLocationRow> {
  const { data, error } = await supabase.rpc('update_location', {
    p_location_id: locationId,
    p_name: patch.name ?? null,
    p_kind: patch.kind ?? null,
    p_parent_id: patch.parentId ?? null,
    p_clear_parent: patch.clearParent ?? false,
  });

  if (error) throw error;
  return data as StorageLocationRow;
}

/** Product categories this household has used, for the picker to offer. */
export async function fetchProductCategories(householdId: string): Promise<string[]> {
  const { data, error } = await supabase
    .from('v_inventory_totals')
    .select('category')
    .eq('household_id', householdId)
    .not('category', 'is', null);

  if (error) throw error;
  return [...new Set((data ?? []).map((row) => row.category).filter((c): c is string => !!c))].sort(
    (a, b) => a.localeCompare(b, 'de'),
  );
}
