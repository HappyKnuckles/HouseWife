# Haushalt

A household app for two people sharing one household: **Putzplan**, expense splitting,
a shared to-do list, and barcode-scanned inventory. Everything syncs live between both
phones — no manual refresh, no custom server.

- **Expo (React Native) + TypeScript**, mobile-first
- **Supabase** for all of it: Postgres, Auth, Realtime, Storage, Edge Functions, RLS
- Cleaning reminders are pushed from a **scheduled Edge Function**, so they fire with
  the app closed — and that same job keeps the free-tier project from pausing

---

## Table of contents

1. [What you get](#what-you-get)
2. [Setup](#setup) — the exact steps
3. [Verifying it works](#verifying-it-works)
4. [How it fits together](#how-it-fits-together)
5. [Scripts](#scripts)
6. [Troubleshooting](#troubleshooting)

---

## What you get

```
supabase/
  migrations/        22 ordered SQL files — the whole schema, RLS, views, RPCs
  functions/
    household-tick/  hourly cron: fixed costs + restock + cleaning reminders + keep-alive
    lookup-barcode/  barcode → product, pluggable providers (stub by default)
    ocr-receipt/     receipt OCR interface + no-op provider
  cron/schedule.sql  one-time pg_cron setup
  tests/             schema behaviour tests against a real Postgres
src/
  app/               expo-router screens — every file here is a route
  components/        domain-agnostic primitives (Button, Card, Screen, …)
  features/          expenses · todos · cleaning · inventory · household · auth
  lib/               typed Supabase client, realtime, notifications, formatting, theme
docs/data-model.md   the design write-up
```

Expo Router picks `src/app` over a top-level `app/` automatically — no config, and it
says so on start (*"Using src/app as the root directory for Expo Router"*). Files
under `src/app` are routes and nothing else: adding `src/app/ExpenseForm.tsx` would
create a navigable `/ExpenseForm`. Shared UI therefore lives one level up, split by
reach rather than by being UI — `src/components/` knows nothing about the domain and
would drop into another app unchanged, while `src/features/<domain>/components/` sits
next to the `api.ts` and `hooks.ts` it changes together with.

---

## Setup

### Prerequisites

- Node 20+ (this was built on 22)
- A Supabase account — the free tier is enough
- For push notifications: an [Expo account](https://expo.dev) and a **development build**
  (see [step 7](#7-run-it))

```bash
npm install
```

---

### 1. Create the Supabase project

1. <https://supabase.com/dashboard> → **New project**
2. Pick a region close to you (`eu-central-1` for Germany) and save the database password
3. Once it is up, go to **Project Settings → API** and note:
   - **Project URL** → `EXPO_PUBLIC_SUPABASE_URL`
   - **anon public** key → `EXPO_PUBLIC_SUPABASE_ANON_KEY`
   - the **Project ref** (the subdomain of the URL) — you need it in steps 2, 4 and 5

> The schema needs **PostgreSQL 15 or newer** (it uses `NULLS NOT DISTINCT` and
> `ON DELETE SET NULL (column)`). Every new Supabase project is well past that.

### 2. Apply the migrations

**With the CLI (recommended — repeatable):**

```bash
npx supabase login
npx supabase link --project-ref <your-project-ref>
npx supabase db push
```

**Or by hand:** open the **SQL Editor** in the dashboard and run the files in
`supabase/migrations/` **in filename order**, one at a time. They are ordered and
must be applied in sequence.

This creates the tables, all RLS policies, the views, the RPCs, the `receipts`
storage bucket and its policies, and it adds the right tables to the realtime
publication. Steps 3 and 4 below are therefore *verification*, not work.

### 3. Verify the storage bucket

**Storage** should now list a private bucket called **`receipts`** (10 MB limit,
images + PDF). Created by `20260729121100_storage.sql`.

Its policies authorise on the **first path segment** of the object name, which is
why receipts are stored as `{household_id}/{expense_id}/{uuid}.jpg`. Do not change
that layout without changing the policies — uploads would start failing with a
permission error.

### 4. Verify Realtime

**Database → Replication → `supabase_realtime`** should list `expenses`,
`expense_items`, `expense_shares`, `receipts`, `settlements`,
`settlement_expenses`, `todos`, `cleaning_areas`, `cleaning_tasks`,
`cleaning_completions`, `storage_locations`, `products`, `inventory_items`,
`profiles` and `households`. Added by `20260729121200_realtime.sql`.

That migration also sets `REPLICA IDENTITY FULL` on each of them. This part matters
and is easy to miss: with RLS on, Postgres ships only the primary key for `DELETE`,
so Realtime cannot evaluate your policy against the deleted row and drops the event
entirely. Without it, deleting a to-do simply never disappears on the other phone.

### 5. Deploy the Edge Functions

```bash
# a shared secret only the cron job knows
npx supabase secrets set CRON_SECRET="$(openssl rand -hex 32)"
#   PowerShell: npx supabase secrets set CRON_SECRET=(-join ((48..57)+(97..102) | Get-Random -Count 64 | % {[char]$_}))

npx supabase functions deploy household-tick --no-verify-jwt
npx supabase functions deploy lookup-barcode
npx supabase functions deploy ocr-receipt
```

`household-tick` is deployed with `--no-verify-jwt` because a cron job cannot present
a user JWT; it authorises on the `x-cron-secret` header instead and refuses to run
without one. The other two keep JWT verification and additionally resolve the calling
user. `SUPABASE_URL`, `SUPABASE_ANON_KEY` and `SUPABASE_SERVICE_ROLE_KEY` are injected
automatically — never set them yourself.

Barcode lookups hit [Open Food Facts](https://world.openfoodfacts.org) and
[Open Products Facts](https://world.openproductsfacts.org) by default — free, no
API key, no setup. Food is well covered; non-food (cleaning supplies, toiletries)
is a much smaller catalog (~40k products), so misses there are expected and just
fall through to manual entry. Override or disable with:

```bash
npx supabase secrets set BARCODE_PROVIDERS=openfoodfacts   # food only
npx supabase secrets set BARCODE_PROVIDERS=null             # no lookups at all
```

OCR has no real provider by default:

```bash
npx supabase secrets set OCR_PROVIDER=noop                 # no real OCR provider ships
```

### 6. Schedule the reminder / keep-alive job

Fill your project ref and `CRON_SECRET` into `supabase/cron/schedule.sql`, then:

```bash
npx supabase db query --linked -f supabase/cron/schedule.sql
```

(or paste it into the **SQL Editor**). It enables `pg_cron` and `pg_net`, stores
the secret in Vault, and schedules `household-tick` **hourly**. Re-running it is
safe — the job is unscheduled first and the Vault secret is updated in place.

The secret goes in Vault rather than `alter database … set app.cron_secret`,
which is the more obvious way to keep it out of `cron.job`: a custom GUC is a
placeholder until an extension claims its prefix, and Postgres wants superuser
to set a placeholder per-database. Supabase's `postgres` role owns the database
but is not a superuser, so that route dead-ends at
`42501: permission denied to set parameter`.

Hourly rather than daily for two reasons: each household is reminded at its own
local `reminder_hour` without any UTC/DST arithmetic, and the keep-alive gets 24
chances a day instead of one.

The secret must match `supabase secrets set CRON_SECRET=…` byte for byte — no
surrounding quotes, no trailing space. A mismatch fails the way a wrong secret
always does: `cron.job_run_details` reports the POST as *succeeded* (pg_net did
send the request), the function answers 401, and `system_heartbeat` simply stays
empty. So verify with the heartbeat, not with the job log:

```sql
select ran_at, households_scanned, notifications_sent from public.system_heartbeat
order by ran_at desc limit 5;
```

No new row within an hour of scheduling means the job is not reaching the
function.

### 7. Run it

There is no sign-up screen — the app has exactly two fixed accounts, and signing in
is just picking which one you are. Which two people depends on an **env profile**:

```bash
cp .env.example .env                                    # fill in URL + anon key
cp env-profiles/prod.env.example env-profiles/prod.env   # fill in your real names/passwords
cp env-profiles/dev.env.example env-profiles/dev.env     # placeholders (test1/test2) work as-is

npm run env:prod   # or: npm run env:dev
```

`dev` and `prod` are the **same Supabase project** — no second backend to stand up —
but `dev`'s two accounts get their own household (`Testhaushalt` by default), and RLS
means that household can never see or touch the real one's rows. Switch profiles any
time with `npm run env:dev` / `npm run env:prod`, then restart Metro.

Provision whichever pair is currently active (safe to re-run — a no-op once it's done):

```bash
# PowerShell
$env:SUPABASE_SERVICE_ROLE_KEY = "..."   # Project Settings → API → service_role — never put this in a file
npm run seed:users
```

```bash
# bash
SUPABASE_SERVICE_ROLE_KEY=... npm run seed:users
```

This creates both accounts (`auth.admin.createUser` with `email_confirm: true`, so
the addresses never need to receive real mail), puts them in one household via the
same `create_household`/`accept_invite` RPCs onboarding would use, and seeds the
starter Putzplan.

```bash
npx expo start
```

Open the app, tap your name.

**About push notifications:** remote push was removed from Expo Go in SDK 53, so
Putzplan reminders need a **development build**. Everything else — realtime, camera,
barcode scanning — works in Expo Go, so you can develop almost everything without one.

```bash
npx eas init          # writes your projectId — copy it into .env as EXPO_PUBLIC_EAS_PROJECT_ID
npx eas build --profile development --platform android
```

Then **Mehr → Push auf diesem Gerät → Aktivieren** to register the device. The screen
tells you exactly why registration failed if it does (Expo Go, simulator, missing
project id, permission denied).

### 8. Cloud builds need the env vars uploaded separately

`.env` and `.env*.local` are git-ignored, and EAS Build excludes git-ignored files
from the upload. So a cloud build has none of them: every `EXPO_PUBLIC_*` inlines
as `undefined` and the app dies on launch at `required()` in `src/lib/env.ts`.
Local builds (`expo run:android`, `eas build --local`) read the filesystem and are
unaffected.

Push each profile into the matching EAS environment once:

```bash
npm run env:prod && npx eas-cli env:push preview      --path .env.local --force
npm run env:prod && npx eas-cli env:push production   --path .env.local --force
npm run env:dev  && npx eas-cli env:push development  --path .env.local --force
```

(`.env.local` only carries the active profile's pair — add the three shared values
from `.env` to the pushed file, or `eas env:push` them separately.) Each build
profile in `eas.json` names its environment, so `--profile preview` picks up the
`preview` set.

Uploaded values win over local `.env` files during a build, so a cloud build is not
affected by whichever profile happens to be active on your machine. To confirm what
a build would actually bake in:

```bash
npx eas-cli env:exec preview "npx expo export --platform android --output-dir dist-check"
grep -a "your.address@haushalt.local" dist-check/_expo/static/js/android/*.hbc
```

Re-run `env:push` after rotating a password — the uploaded copy does not track the
file.

### 9. Shipping changes without reinstalling

`expo-updates` is configured, so JS and asset changes reach installed apps over the
air. Each build profile publishes to the channel of the same name:

```bash
npm run update:preview      # eas update --channel preview --environment preview
npm run update:production
```

`--environment` is not optional (SDK 55+): the bundle is built on your machine, so
without it `EXPO_PUBLIC_*` would be inlined from whichever local profile happens to
be active — publishing your dev credentials into the real app. The scripts above
pin it to the matching EAS environment.

`runtimeVersion` uses the `fingerprint` policy rather than `appVersion`. A
fingerprint is computed from the native project — dependencies, config plugins,
app config — so adding a native module changes it automatically and old binaries
simply stop receiving updates. Under `appVersion` you would have to remember to
bump `version` by hand, and forgetting means shipping JS that its binary cannot
run. Silently no update beats a crash.

So: **JS, styling, screens, copy → OTA.** New native dependency, changed config
plugin, an Expo SDK bump → new APK. `npx expo-updates fingerprint:generate
--platform android` before and after a change tells you which one you are looking at.

Updates install on the next cold start by themselves. **Mehr → App-Version** shows
what is running and can pull and apply one immediately, which is also how you check
whether the other phone is on the current version.

---

## Verifying it works

**Realtime:** open the app on two devices, tick a to-do on one — it flips on the other
without a refresh.

**The database logic** has its own test suite. It applies every migration to a real
PostgreSQL (PGlite — Postgres compiled to WASM, no Docker and no Supabase project
needed) and exercises the parts that carry logic: the balance invariant, all three
split rules, RLS enforcement, recurrence and rotation, and the inventory scan flow.

```bash
npm run test:db
# 70 passed, 0 failed
```

**The cron:** the app shows it under **Mehr → Server-Status**. Or query it directly:

```sql
select ran_at, households_scanned, tasks_due, notifications_sent,
       restock_notifications_sent, recurring_expenses_generated,
       restock_todos_synced, duration_ms, error
from public.system_heartbeat
order by ran_at desc
limit 24;
```

A row per hour means reminders are running *and* the project is being kept alive.
If the newest row is more than ~2 hours old, both have stopped.

You can also trigger a run by hand — `force` ignores each household's reminder hour:

```bash
curl -X POST "https://<ref>.supabase.co/functions/v1/household-tick?force=true" \
  -H "x-cron-secret: <CRON_SECRET>"
```

---

## How it fits together

### The household is the tenant boundary

Every table carries `household_id`, even where it could be derived through a parent.
That buys two things: every RLS policy is the same one-liner, and every realtime
subscription filters on one indexed column. The denormalization is kept honest with
**composite foreign keys** — `(expense_id, household_id) → expenses(id, household_id)` —
so a child row cannot physically point at a parent in another household.

Every policy resolves through one function:

```sql
create function public.current_household_id() returns uuid
language sql stable security definer ...
```

`SECURITY DEFINER` is load-bearing. The function reads `profiles`, and the RLS policy
on `profiles` calls the function — without DEFINER that is infinite recursion.

One more hole that a policy alone cannot close: "update your own row" includes setting
your own `household_id` to any UUID you can guess. Column-level privileges close it —
`authenticated` may only update `display_name`, `avatar_url` and `color`. Membership
changes go exclusively through `create_household()` and `accept_invite()`.

### Money cannot go wrong

`expense_shares` is the single source of truth for who owes whom. A **deferred
constraint trigger** enforces that the shares sum exactly to `expenses.total_cents`
at COMMIT — no client bug and no old app version can leave the ledger inconsistent.

That has a direct consequence: since PostgREST gives you one statement per request,
an insert of the expense followed by an insert of its shares can never be one
transaction and would always fail the constraint. **Expenses are therefore created
through `create_expense()`**, not by inserting rows. Same for `settle_up()` and
`complete_cleaning_task()`.

Amounts are always `bigint` cents, and odd cents go to the payer first, then by
profile id — deterministic on both the client preview and the server.

### The Putzplan gets two things right

`schedule_mode` decides what "next" means. `fixed` advances from the *scheduled* date
("Bad jeden Samstag" stays on Saturdays even if you clean on Sunday); `after_completion`
advances from the *completion* date ("saugen alle 7 Tage" genuinely shifts when you do
it late). Supporting only one would be wrong about half of all real chores.

`next_due_on` is materialized rather than computed on read, so the hourly cron and the
agenda screen both do a single indexed comparison — and cannot disagree with each other.

### Reminders and the keep-alive

`household-tick` does three jobs per run, in this order:

1. **Keep-alive**, always first and in its own try/catch. A read and a write through
   PostgREST. Supabase pauses free projects after ~7 idle days; a `pg_cron` job that
   only runs SQL never leaves the database process, so it is not something to bet
   uptime on. An HTTP round-trip from the function to the project's own API
   unambiguously is activity, and it happens whether or not any reminder is due.
2. **Recurring expenses** — see below. Unconditional, like the keep-alive: a bill
   is due on its date regardless of which hour the household likes to be nudged at.
3. **Reminders**, per household at its own local `reminder_hour` — first staples at
   or below their restock threshold, then cleaning tasks that are due or overdue.
   The restock pass runs before the cleaning one and shares none of its early exits,
   so a household with no chores due still gets told it is out of toilet paper.

Both reminder passes go through one `deliver()` helper rather than two copies of the
ticket → receipt → dead-token dance: that is the fiddly part of Expo push, and a
second copy would drift the moment one of them was fixed.

Duplicate suppression is a unique index on
`notification_log (task_id, profile_id, kind, due_on)`. The function inserts with
`ON CONFLICT DO NOTHING` *before* sending and only pushes rows that actually inserted,
so it can run every hour, crash mid-batch, or be re-triggered by hand and you still get
exactly one "Bad putzen" per task per due date per person.

Dead push tokens heal themselves: Expo's ticket often reports `DeviceNotRegistered`
immediately, and a later sweep checks delivery receipts and disables what is gone.

### Fixkosten are templates, not a second ledger

`recurring_expenses` holds rent, Strom, subscriptions — a *template*, never money.
`generate_due_recurring_expenses()` turns a due template into an ordinary row in
`expenses`, through the same `apply_expense_split()` the manual flow uses, so a
generated bill is indistinguishable from a typed one: same balance, same settlement,
same stats. The alternative — keeping projected fixed costs in their own table and
adding them to reports — needs every reader to remember to combine two sources, and
gives you two numbers that can disagree.

Consequences worth knowing: the split is always equal (a template has no way to
supply per-item lines or custom ratios at generation time), and a template that has
been due for months produces only the *next* occurrence per run rather than
backfilling a year of missed bills. Pausing (`is_active = false`) is the intended
"stop this" — deleting is also fine, it just leaves the already-generated expenses
behind with nothing pointing at them.

### Stats

Two views, both `security_invoker` like every other view here.
`v_expense_category_month` groups on `date_trunc('month', purchased_at)` and folds
`NULL` categories into `Sonstiges`. `v_item_purchase_frequency` groups
`expense_items.name` on `lower(btrim(...))` — free text, so casing and stray
whitespace merge, but genuine spelling variants ("Milch" vs "Vollmilch") stay
separate; merging those needs real product matching that table has no way to do.

`expenses.category` stays free text rather than an enum. `EXPENSE_CATEGORIES` in
`src/features/expenses/categories.ts` is the set the pickers *offer*; the stats
screen renders whatever the view returns and falls back to a neutral icon for
anything unlisted, so adding a category never needs a migration.

### Empty lots are deleted, staples are tracked on the product

`inventory_adjust()` deletes a lot once it reaches zero — an empty shelf row is
not inventory, it is clutter in the one list you scan to answer "haben wir noch".
That forces a decision about where "erinnere mich, wenn das knapp wird" lives: on
the lot it would be deleted at exactly the moment it matters, so it lives on
`products.restock_min_quantity` instead. Which is where it belonged regardless —
"wir wollen immer Klopapier im Haus" is a fact about the product, not about one
particular Schrank.

The product row therefore always survives. That is load-bearing twice over: the
staple keeps reminding at zero stock, and the catalog entry keeps deduplicating
future scans and manual entries of the same thing.

`inventory_items.min_quantity` still exists and is no longer written. Left in
place rather than dropped — it is nullable, nothing reads it, and dropping a
column is the one change that cannot be walked back without data loss.

Restock reminders reuse `notification_log` rather than growing a parallel
mechanism, so they inherit its dedupe. The second unique index is deliberately
*not* partial: a cleaning row has `product_id` NULL and a restock row has
`task_id` NULL, so under the default `NULLS DISTINCT` each index only ever
constrains its own kind of row — and both stay usable as a PostgREST
`on_conflict` target, which a partial index would not be. `due_on` carries the
household-local date, so an empty staple nudges at most once per person per day
and stops by itself once stock is back above the threshold.

### A low staple writes itself onto the to-do list

The push is a nudge that is gone once dismissed; what you need at the shop is a
list, and there already is one. Any product with a `restock_min_quantity` — the
switch on the product screen — gets an open `X kaufen` to-do while it is at or
below that threshold, and loses it again when stock recovers. No second opt-in:
having asked to be reminded *is* the opt-in.

`todos.source` separates the two kinds of row. A `'restock'` row is the
generator's to manage; a `'manual'` one you wrote yourself is never touched,
even if it says exactly the same thing. `todos_restock_open_unique` is partial
on `(household_id, product_id) where source = 'restock' and not is_done`, which
is what stops an hourly cron from stacking up one to-do per run while still
letting a *new* one appear months after you ticked the last one off.

Both directions run in triggers on `inventory_items` and on
`products.restock_min_quantity`, not only in the cron. Reconciling once an hour
was the obvious first cut and it is wrong in the one moment that matters: you
scan the flour back in, look at the list, and it still says buy flour. The cron
still calls the same function afterwards as a safety net for anything that
changed by another route.

`created_by` stays NULL on a generated row — nobody wrote it, and putting one of
the two members' faces on it would be a small lie. The to-dos screen marks them
with a cart icon and links through to the product instead.

### Moving stock merges, and splits

`inventory_move()` is an RPC rather than an update on `location_id`, because
`inventory_items_lot_unique` is `(product_id, location_id, expires_on)` with
`NULLS NOT DISTINCT` — moving a lot into a location that already holds the same
product at the same expiry would hit a unique violation. That is not an error
case, it is the *normal* one: you are putting the rest of the flour where the
flour already lives. So the two lots merge.

Moving *part* of a lot ("drei von den zehn Dosen in den Keller") splits it,
carrying `expires_on`, `opened_at` and `note` onto the new lot — those describe
the goods, not the shelf. Asking for more than the lot holds raises instead of
clamping: with two phones on the same data, moving silently less than asked
would leave stock sitting where you now believe it is not.

The movement log distinguishes the two shapes, because `delta` is per *lot*: a
lot that merely changes shelf logs one row with `delta = 0` — nothing about that
lot's quantity changed — while stock crossing from one lot into another logs a
`-n`/`+n` pair. Move rows therefore always sum to zero.

Product name, brand and unit are editable on the product screen. Note there is
no uniqueness on product names, so renaming one product onto another's name
leaves two entries that look identical — the name matching in
`inventory_scan_in()` prevents duplicates being *created*, it cannot fuse two
that already exist.

### Manual entry deduplicates by name

`inventory_scan_in()` matches an existing product by `lower(btrim(name))` when
there is no barcode, so typing "Mehl" twice tops up one entry instead of making
two. Matching is limited to the barcode-less case on purpose: a scanned barcode
is authoritative, and two brands of Mehl sharing a name should stay two products.
The manual-add screen's typeahead is the visible half of the same guarantee —
picking a suggestion also passes that product's barcode through, so an explicit
choice is matched exactly rather than falling back to the name.

### Editing an expense

`update_expense()` re-runs `apply_expense_split()`, so items and shares are
rebuilt from scratch rather than patched, and the deferred balance trigger still
has the last word. It refuses a **settled** expense: `v_household_balances` only
counts open ones, so the edit would move no balance at all while the settlement
row went on claiming a transfer that no longer matched — a silent no-op with a
history that quietly stops adding up. The UI hides the entry point for a settled
expense; the RPC is the backstop for an older app version on the other phone.

The create and edit screens share one `ExpenseForm`. The split preview has to
agree with `apply_expense_split()` cent for cent, and two copies of the item
editor and shares validation would drift — you would only find out when the two
screens disagreed about who owes what.

### Realtime on the client

One websocket per household (`household:<uuid>`) carrying several `postgres_changes`
listeners, all filtered on `household_id`. Changes invalidate TanStack Query keys
rather than patching the cache: several screens read *views* whose row shape is not
the row shape of the table that changed, so patching would mean re-deriving `status`,
`days_until` and every balance on the client — a second implementation that can drift.
A prefix invalidation costs one small refetch and is always right. The interactions
that need to feel instant (ticking a chore, checking a to-do) are optimistic locally.

### Extension points, deliberately stubbed

- **Barcode lookup** — `lookup-barcode` tries providers in order and caches results
  (including misses) in `product_lookup_cache`. Ships with Open Food Facts and Open
  Products Facts enabled by default (free, no key) — food is well covered, non-food
  is a smaller catalog and misses fall through to manual entry. Both providers share
  one request builder since they run on the same platform (Product Opener) and return
  identical JSON; adding another source is one more object in `PROVIDERS`.
- **Receipt OCR** — `ocr-receipt` does the whole round-trip (sign a URL, run a provider,
  write `ocr_parsed`, set status) with a no-op provider. Nothing in the expense flow
  depends on it succeeding. Adding a real one means writing one object that satisfies
  `ReceiptOcrProvider`; the app already renders parsed lines as editable items.

---

## Scripts

| Command | What it does |
| --- | --- |
| `npm start` | Switch to the **dev** users, then start the Expo dev server |
| `npm run start:prod` | Switch to the **real** users, then start the Expo dev server |
| `npm run env:dev` / `env:prod` | Switch env profile only, without starting Metro |
| `npm run seed:users` | Create the active profile's two accounts + their household |
| `npm run android` / `ios` | Launch on a device/emulator |
| `npm run test:db` | Apply all migrations to a real Postgres and test the logic |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run gen:types` | Regenerate `src/lib/database.types.ts` from your linked project |

`src/lib/database.types.ts` is hand-written to match the migrations exactly. Once your
project is linked you can regenerate it — the shape is the same, just more verbose.

> If you edit it by hand, keep the row types as `type` aliases, **not** `interface`.
> Interfaces do not get TypeScript's implicit index signature, so they fail Supabase's
> `Record<string, unknown>` constraint and the client silently degrades every query
> result to `never`.

---

## Troubleshooting

**"EXPO_PUBLIC_SUPABASE_URL is not set"** — copy `.env.example` to `.env`, then restart
with `npx expo start --clear`. Env values are inlined at bundle time.

**Deleting something doesn't disappear on the other phone** — `REPLICA IDENTITY FULL`
is missing on that table. Re-run `20260729121200_realtime.sql`.

**"expense … is unbalanced"** — something inserted into `expenses` directly instead of
calling `create_expense()`. That is the constraint doing its job; see
[Money cannot go wrong](#money-cannot-go-wrong).

**Reminders never arrive** — check in this order: `system_heartbeat` has recent rows
(if not, the cron is not running — re-run `supabase/cron/schedule.sql`); you are on a
development build, not Expo Go; `push_tokens` has a row for you with `disabled_at`
null; the household's `reminder_hour` matches the local hour you are testing in, or
use `?force=true`.

**Receipt upload fails with a permission error** — the object path must start with the
household id. See [step 3](#3-verify-the-storage-bucket).

**`npm install` fails with ERESOLVE** — the Expo SDK pins `react`, and some transitive
dependency wants a newer `react-dom`. Fix it with `npx expo install react-dom` rather
than `--legacy-peer-deps`.
