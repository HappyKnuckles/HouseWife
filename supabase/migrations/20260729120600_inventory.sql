-- ============================================================================
-- 0007 · Inventory with barcode scanning
-- ============================================================================
-- Three layers, deliberately separated:
--   storage_locations  where things are      (Raum › Regal › Kiste)
--   products           what a thing *is*     (the barcode-keyed catalog)
--   inventory_items    how many, where       (product × location)
-- Splitting product from item is what makes "we have 3 in the Keller and 1 in
-- der Küche" expressible at all.
-- ============================================================================

create table public.storage_locations (
  id           uuid primary key default gen_random_uuid(),
  household_id uuid        not null references public.households (id) on delete cascade,
  parent_id    uuid,
  name         text        not null check (length(btrim(name)) between 1 and 80),
  kind         text        not null default 'room'
                 check (kind in ('room', 'shelf', 'box', 'fridge', 'freezer', 'cabinet', 'other')),
  sort_order   int         not null default 0,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),

  constraint storage_locations_id_household_key unique (id, household_id),
  -- Self-reference stays inside the household.
  constraint storage_locations_parent_fkey foreign key (parent_id, household_id)
    references public.storage_locations (id, household_id) on delete cascade,
  constraint storage_locations_not_self check (parent_id is null or parent_id <> id)
);

create index storage_locations_parent_idx on public.storage_locations (household_id, parent_id, sort_order);

-- ----------------------------------------------------------------------------
-- products — the household's own catalog, keyed by barcode when there is one.
-- external_* columns are where an external product database writes its answer
-- once one is wired up; nothing else in the schema has to change for that.
-- ----------------------------------------------------------------------------
create table public.products (
  id                  uuid primary key default gen_random_uuid(),
  household_id        uuid        not null references public.households (id) on delete cascade,
  barcode             text        check (barcode ~ '^[0-9]{6,14}$'),
  name                text        not null check (length(btrim(name)) between 1 and 160),
  brand               text,
  category            text,
  unit                text        not null default 'piece'
                        check (unit in ('piece', 'g', 'kg', 'ml', 'l', 'pack')),
  net_quantity        numeric(12,3) check (net_quantity > 0),
  image_url           text,
  default_location_id uuid,
  notes               text,
  source              text        not null default 'manual'
                        check (source in ('manual', 'scan', 'external')),
  external_provider   text,
  external_id         text,
  external_payload    jsonb,
  created_by          uuid references public.profiles (id) on delete set null,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),

  constraint products_id_household_key unique (id, household_id),
  constraint products_default_location_fkey foreign key (default_location_id, household_id)
    references public.storage_locations (id, household_id) on delete set null (default_location_id)
);

-- One catalog entry per barcode per household; unbarcoded products are free-form.
create unique index products_barcode_unique
  on public.products (household_id, barcode)
  where barcode is not null;

create index products_name_idx on public.products (household_id, lower(name));

-- ----------------------------------------------------------------------------
-- The extension point for an external product database.
--
-- Not household-scoped: "EAN 4001686315101 is Ritter Sport Vollnuss" is a global
-- fact, and caching it per household would mean re-fetching it for every user.
-- Readable by any authenticated user, written only by the service role (i.e.
-- the lookup-barcode Edge Function).
-- ----------------------------------------------------------------------------
create table public.product_lookup_cache (
  barcode    text primary key check (barcode ~ '^[0-9]{6,14}$'),
  provider   text        not null,
  found      boolean     not null default true,
  payload    jsonb,
  hit_count  int         not null default 0,
  fetched_at timestamptz not null default now()
);

alter table public.product_lookup_cache enable row level security;

create policy product_lookup_cache_select on public.product_lookup_cache
  for select to authenticated using (true);

-- No insert/update policy: only the service role (which bypasses RLS) writes here.
revoke all on public.product_lookup_cache from anon;
grant select on public.product_lookup_cache to authenticated;

-- ----------------------------------------------------------------------------
-- inventory_items — quantity on hand, per product per location.
-- ----------------------------------------------------------------------------
create table public.inventory_items (
  id           uuid primary key default gen_random_uuid(),
  household_id uuid        not null references public.households (id) on delete cascade,
  product_id   uuid        not null,
  location_id  uuid,
  quantity     numeric(12,3) not null default 0 check (quantity >= 0),
  unit         text        not null default 'piece'
                 check (unit in ('piece', 'g', 'kg', 'ml', 'l', 'pack')),
  -- Drives the "geht zur Neige" list.
  min_quantity numeric(12,3) check (min_quantity >= 0),
  expires_on   date,
  opened_at    timestamptz,
  note         text,
  created_by   uuid references public.profiles (id) on delete set null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),

  constraint inventory_items_id_household_key unique (id, household_id),
  constraint inventory_items_product_fkey foreign key (product_id, household_id)
    references public.products (id, household_id) on delete cascade,
  constraint inventory_items_location_fkey foreign key (location_id, household_id)
    references public.storage_locations (id, household_id) on delete set null (location_id)
);

-- One stock row per product / location / expiry lot. NULLS NOT DISTINCT (PG15+)
-- makes "no location" and "no expiry" collapse into a single row instead of
-- silently accumulating duplicates every time the same item is scanned.
create unique index inventory_items_lot_unique
  on public.inventory_items (product_id, location_id, expires_on)
  nulls not distinct;

create index inventory_items_household_idx on public.inventory_items (household_id, location_id);
create index inventory_items_expiry_idx
  on public.inventory_items (household_id, expires_on)
  where expires_on is not null;

-- ----------------------------------------------------------------------------
-- Movement log. Cheap to write and it is what makes two phones adjusting the
-- same stock at the same time debuggable after the fact.
-- ----------------------------------------------------------------------------
create table public.inventory_movements (
  id               uuid primary key default gen_random_uuid(),
  household_id     uuid        not null references public.households (id) on delete cascade,
  item_id          uuid,
  product_id       uuid,
  delta            numeric(12,3) not null,
  reason           text        not null
                     check (reason in ('scan_in', 'manual_adjust', 'consume', 'move', 'correction', 'initial')),
  from_location_id uuid,
  to_location_id   uuid,
  note             text,
  created_by       uuid references public.profiles (id) on delete set null,
  created_at       timestamptz not null default now(),

  constraint inventory_movements_item_fkey foreign key (item_id, household_id)
    references public.inventory_items (id, household_id) on delete set null (item_id),
  constraint inventory_movements_product_fkey foreign key (product_id, household_id)
    references public.products (id, household_id) on delete set null (product_id)
);

create index inventory_movements_item_idx
  on public.inventory_movements (household_id, created_at desc);

-- ----------------------------------------------------------------------------
create trigger storage_locations_set_updated_at
  before update on public.storage_locations
  for each row execute function public.set_updated_at();

create trigger products_set_updated_at
  before update on public.products
  for each row execute function public.set_updated_at();

create trigger inventory_items_set_updated_at
  before update on public.inventory_items
  for each row execute function public.set_updated_at();

select public.apply_household_rls('storage_locations');
select public.apply_household_rls('products');
select public.apply_household_rls('inventory_items');
select public.apply_household_rls('inventory_movements');
