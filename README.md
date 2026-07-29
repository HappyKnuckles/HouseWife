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
  migrations/        13 ordered SQL files — the whole schema, RLS, views, RPCs
  functions/
    household-tick/  hourly cron: cleaning reminders + keep-alive
    lookup-barcode/  barcode → product, pluggable providers (stub by default)
    ocr-receipt/     receipt OCR interface + no-op provider
  cron/schedule.sql  one-time pg_cron setup
  tests/             schema behaviour tests against a real Postgres
app/                 expo-router screens
src/
  lib/               typed Supabase client, realtime, notifications, formatting, theme
  features/          expenses · todos · cleaning · inventory · household · auth
docs/data-model.md   the design write-up
```

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

Open `supabase/cron/schedule.sql`, replace `<PROJECT_REF>` and `<CRON_SECRET>`
with your values, and run it in the **SQL Editor**. It enables `pg_cron` and
`pg_net` and schedules `household-tick` **hourly**.

Hourly rather than daily for two reasons: each household is reminded at its own
local `reminder_hour` without any UTC/DST arithmetic, and the keep-alive gets 24
chances a day instead of one.

### 7. Run it

```bash
cp .env.example .env      # then fill in URL + anon key
npx expo start
```

Sign up, create your household (you get a starter Putzplan), then **Mehr → Partner
einladen** to generate a 6-character code for your wife.

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
# 46 passed, 0 failed
```

**The cron:** the app shows it under **Mehr → Server-Status**. Or query it directly:

```sql
select ran_at, households_scanned, tasks_due, notifications_sent, duration_ms, error
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

`household-tick` does two jobs per run, in this order:

1. **Keep-alive**, always first and in its own try/catch. A read and a write through
   PostgREST. Supabase pauses free projects after ~7 idle days; a `pg_cron` job that
   only runs SQL never leaves the database process, so it is not something to bet
   uptime on. An HTTP round-trip from the function to the project's own API
   unambiguously is activity, and it happens whether or not any reminder is due.
2. **Reminders** for tasks that are due or overdue.

Duplicate suppression is a unique index on
`notification_log (task_id, profile_id, kind, due_on)`. The function inserts with
`ON CONFLICT DO NOTHING` *before* sending and only pushes rows that actually inserted,
so it can run every hour, crash mid-batch, or be re-triggered by hand and you still get
exactly one "Bad putzen" per task per due date per person.

Dead push tokens heal themselves: Expo's ticket often reports `DeviceNotRegistered`
immediately, and a later sweep checks delivery receipts and disables what is gone.

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
| `npm start` | Expo dev server |
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
