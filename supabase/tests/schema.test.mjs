/**
 * Schema behaviour tests.
 *
 * Applies every migration to a real PostgreSQL (PGlite = Postgres compiled to
 * WASM, no Docker or Supabase project needed) and then exercises the parts of
 * the schema that carry actual logic: the balance invariant, the split rules,
 * RLS enforcement, recurrence and rotation, and the inventory scan flow.
 *
 *   npm run test:db
 *
 * Queries run as the `authenticated` role with request.jwt.claims set, so RLS
 * is genuinely in force — not bypassed by table ownership the way it would be
 * if these ran as the superuser.
 *
 * Note the `select * from fn(...)` calls: `select (fn(...)).*` would evaluate
 * the function once per output column. PostgREST uses the former, so this
 * matches how the app actually calls RPCs.
 */
import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';
import { readdirSync, readFileSync } from 'node:fs';

const DIR = new URL('../migrations/', import.meta.url);
const SKIP = ['20260729121100_storage.sql'];

const db = await PGlite.create({ extensions: { pgcrypto } });
for (const f of readdirSync(DIR).filter((f) => f.endsWith('.sql')).sort()) {
  if (!SKIP.includes(f)) await db.exec(readFileSync(new URL(f, DIR), 'utf8'));
}

const USER_A = '11111111-1111-1111-1111-111111111111';
const USER_B = '22222222-2222-2222-2222-222222222222';

let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => {
  if (cond) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name} ${extra}`); }
};
const section = (s) => console.log(`\n=== ${s} ===`);

// Act as a given user, with RLS enforced (role authenticated, not the owner).
async function as(uid, sql) {
  await db.exec(`set role postgres; set request.jwt.claims = '{"sub":"${uid}"}'; set role authenticated;`);
  return db.query(sql);
}
async function asExpectError(uid, sql) {
  try { await as(uid, sql); return null; }
  catch (e) { return e.message; }
}

section('signup → profile trigger');
await db.exec(`set role postgres;
  insert into auth.users (id, email, raw_user_meta_data)
  values ('${USER_A}', 'a@example.test', '{"display_name":"Alex"}'),
         ('${USER_B}', 'b@example.test', '{"display_name":"Robin"}');`);
let r = await db.query(`select display_name from public.profiles order by display_name`);
ok('both signups produced profiles', r.rows.length === 2, JSON.stringify(r.rows));
ok('display_name came from metadata', r.rows[0].display_name === 'Alex' && r.rows[1].display_name === 'Robin');

section('household creation + invite');
r = await as(USER_A, `select public.create_household('Zuhause') as id`);
const HH = r.rows[0].id;
ok('create_household returned an id', !!HH);

r = await as(USER_A, `select count(*)::int n from public.cleaning_tasks`);
ok('starter Putzplan seeded (8 tasks)', r.rows[0].n === 8, `got ${r.rows[0].n}`);

let err = await asExpectError(USER_A, `select public.create_household('Zweites')`);
ok('cannot create a second household', /already belong/.test(err ?? ''), err ?? 'no error');

// The second user cannot see the household before joining.
r = await as(USER_B, `select count(*)::int n from public.cleaning_tasks`);
ok('RLS: outsider sees no tasks', r.rows[0].n === 0, `got ${r.rows[0].n}`);

err = await asExpectError(USER_B, `update public.profiles set household_id = '${HH}' where id = '${USER_B}'`);
ok('RLS: cannot self-assign household_id', err !== null, 'update unexpectedly succeeded');

r = await as(USER_A, `select public.create_invite() as code`);
const CODE = r.rows[0].code;
ok('invite code has the right shape', /^[A-Z0-9]{6}$/.test(CODE), CODE);

err = await asExpectError(USER_B, `select public.accept_invite('ZZZZZZ')`);
ok('bogus invite code rejected', /invalid or expired/.test(err ?? ''), err ?? 'no error');

await as(USER_B, `select public.accept_invite('${CODE}')`);
r = await as(USER_B, `select count(*)::int n from public.cleaning_tasks`);
ok('RLS: member now sees the tasks', r.rows[0].n === 8, `got ${r.rows[0].n}`);

r = await as(USER_A, `select count(*)::int n from public.cleaning_tasks
                    where assignment_mode='rotating' and '${USER_B}' = any(rotation_order)`);
ok('joining added the member to every rotation', r.rows[0].n === 8, `got ${r.rows[0].n}`);

section('expense splitting + the balance invariant');
// 40.01 € split 50/50 → the odd cent goes to the payer.
r = await as(USER_A, `select * from public.create_expense('Wocheneinkauf', 4001)`);
const EXP = r.rows[0].id;
r = await as(USER_A, `select profile_id, share_cents::int c from public.expense_shares
                    where expense_id='${EXP}' order by share_cents desc`);
ok('equal split: shares sum to the total exactly',
   r.rows.reduce((a, x) => a + Number(x.c), 0) === 4001, JSON.stringify(r.rows));
ok('equal split: the odd cent goes to the payer',
   r.rows[0].profile_id === USER_A && Number(r.rows[0].c) === 2001, JSON.stringify(r.rows));

// The invariant itself: a raw insert without shares cannot commit. This is
// precisely why create_expense() has to exist.
err = await asExpectError(USER_A, `
  insert into public.expenses (household_id, paid_by, title, total_cents, created_by)
  values ('${HH}', '${USER_A}', 'Kaputt', 5000, '${USER_A}')`);
ok('raw insert without shares rejected at commit', /unbalanced/.test(err ?? ''), err ?? 'no error');

err = await asExpectError(USER_A, `update public.expenses set total_cents = 9999 where id='${EXP}'`);
ok('editing total without reshaping shares rejected', /unbalanced/.test(err ?? ''), err ?? 'no error');

// Per-item split: the beer is user A's alone, the rest is shared.
r = await as(USER_A, `select * from public.create_expense(
      'Getränkemarkt', 2000, '${USER_A}', 'items', now(), null, null,
      '[{"name":"Bier","total_cents":600,"paid_for":"${USER_A}"},
        {"name":"Wasser","total_cents":1400}]'::jsonb)`);
const EXP2 = r.rows[0].id;
r = await as(USER_A, `select profile_id, share_cents::int c from public.expense_shares
                    where expense_id='${EXP2}' order by share_cents desc`);
ok('item split: 6.00 € solo + 7.00 € of the shared 14.00 €',
   Number(r.rows.find(x => x.profile_id === USER_A).c) === 1300 &&
   Number(r.rows.find(x => x.profile_id === USER_B).c) === 700, JSON.stringify(r.rows));

// Custom ratio split.
r = await as(USER_A, `select * from public.create_expense(
      'Urlaubskasse', 10000, '${USER_A}', 'shares', now(), null, null, '[]'::jsonb,
      '[{"profile_id":"${USER_A}","share_cents":7000},
        {"profile_id":"${USER_B}","share_cents":3000}]'::jsonb)`);
r = await as(USER_A, `select share_cents::int c, share_ratio from public.expense_shares
                    where expense_id='${r.rows[0].id}' and profile_id='${USER_B}'`);
ok('custom shares stored with their ratio',
   Number(r.rows[0].c) === 3000 && Number(r.rows[0].share_ratio) === 0.3, JSON.stringify(r.rows));

err = await asExpectError(USER_A, `select public.create_expense(
      'Falsch', 10000, '${USER_A}', 'shares', now(), null, null, '[]'::jsonb,
      '[{"profile_id":"${USER_A}","share_cents":1}]'::jsonb)`);
ok('custom shares that do not add up are rejected', /sum to 1 cents/.test(err ?? ''), err ?? 'no error');

// Editing: apply_expense_split() re-runs, so shares are rebuilt to the new total.
r = await as(USER_A, `select * from public.update_expense('${EXP}', 'Wocheneinkauf XL', 5000)`);
ok('editing an open expense updates it', Number(r.rows[0].total_cents) === 5000, JSON.stringify(r.rows[0]));
r = await as(USER_A, `select coalesce(sum(share_cents),0)::int s from public.expense_shares
                    where expense_id='${EXP}'`);
ok('...and its shares are rebuilt to match the new total', Number(r.rows[0].s) === 5000, JSON.stringify(r.rows));
await as(USER_A, `select * from public.update_expense('${EXP}', 'Wocheneinkauf', 4001)`);

// Clear the extra expenses so the settle-up assertions below stay readable.
await as(USER_A, `delete from public.expenses where id <> '${EXP}'`);

r = await as(USER_A, `select profile_id, net_cents::int from public.v_household_balances order by net_cents desc`);
ok('balance: payer is owed 20.00 €', Number(r.rows[0].net_cents) === 2000, JSON.stringify(r.rows));
ok('balances sum to zero', r.rows.reduce((a, x) => a + Number(x.net_cents), 0) === 0);

section('cross-household integrity');
await db.exec(`set role postgres;
  insert into auth.users (id, email) values ('33333333-3333-3333-3333-333333333333','x@y.z');`);
err = await asExpectError(USER_A, `
  insert into public.expenses (household_id, paid_by, title, total_cents, created_by)
  values ('${HH}', '33333333-3333-3333-3333-333333333333', 'Fremd', 100, '${USER_A}')`);
ok('cannot name a non-member as payer', err !== null, 'insert unexpectedly succeeded');

section('settle up');
r = await as(USER_A, `select public.settle_up(null, 'transfer', 'Überwiesen') as id`);
ok('settle_up created a settlement', !!r.rows[0].id);
r = await as(USER_A, `select amount_cents::int a, from_profile, to_profile from public.settlements`);
ok('settlement is 20.00 € from the debtor to the payer',
   Number(r.rows[0].a) === 2000 && r.rows[0].from_profile === USER_B && r.rows[0].to_profile === USER_A,
   JSON.stringify(r.rows));
r = await as(USER_A, `select count(*)::int n from public.expenses where status='open'`);
ok('no open expenses left', r.rows[0].n === 0);
r = await as(USER_A, `select coalesce(sum(abs(net_cents)),0)::int s from public.v_household_balances`);
ok('balance is back to zero', Number(r.rows[0].s) === 0);

// Editing a settled expense would move no balance (the view only counts open
// ones) while the settlement went on claiming a transfer that no longer matches.
err = await asExpectError(USER_A, `select public.update_expense('${EXP}', 'Nachträglich', 9999)`);
ok('a settled expense cannot be edited', /settled expense cannot be edited/.test(err ?? ''), err ?? 'no error');

section('Putzplan: recurrence + rotation');
r = await as(USER_A, `select id, next_due_on, assigned_to, rotation_order,
                           (next_due_on = current_date) as is_today
                    from public.cleaning_tasks where name='Staubsaugen'`);
const VAC = r.rows[0];
ok('interval task starts due today', VAC.is_today === true, String(VAC.next_due_on));

r = await as(USER_A, `select next_due_on, extract(isodow from next_due_on)::int dow
                    from public.cleaning_tasks where name='Bad putzen'`);
ok('fixed Saturday task is scheduled on a Saturday', r.rows[0].dow === 6, JSON.stringify(r.rows[0]));

r = await as(USER_A, `select * from public.complete_cleaning_task('${VAC.id}')`);
const after = r.rows[0];
r = await as(USER_A, `select (next_due_on - current_date)::int d from public.cleaning_tasks where id='${VAC.id}'`);
ok('completing advanced the due date by 4 days', r.rows[0].d === 4, `${after.next_due_on} (${r.rows[0].d}d)`);
ok('completion rotated to the other member', after.assigned_to !== VAC.assigned_to,
   `${VAC.assigned_to} -> ${after.assigned_to}`);
ok('last_completed_by recorded', after.last_completed_by === USER_A);

r = await as(USER_A, `select count(*)::int n from public.cleaning_completions where task_id='${VAC.id}'`);
ok('exactly one completion row was written', r.rows[0].n === 1, `got ${r.rows[0].n}`);
r = await as(USER_A, `select id from public.cleaning_completions where task_id='${VAC.id}'`);
const undone = r.rows[0].id;
r = await as(USER_A, `select assigned_to, (next_due_on = current_date) as is_today
                    from public.undo_cleaning_completion('${undone}')`);
ok('undo restored the due date', r.rows[0].is_today === true, String(r.rows[0].next_due_on));
ok('undo restored the assignee', r.rows[0].assigned_to === VAC.assigned_to);

// A long-overdue fixed task must not stay in the past after being ticked.
await db.exec(`set role postgres; update public.cleaning_tasks
               set next_due_on = current_date - 30 where name='Fenster putzen';`);
r = await as(USER_A, `select id from public.cleaning_tasks where name='Fenster putzen'`);
r = await as(USER_A, `select (next_due_on > current_date) as future, next_due_on
                    from public.complete_cleaning_task('${r.rows[0].id}')`);
ok('overdue fixed task lands in the future', r.rows[0].future === true, String(r.rows[0].next_due_on));

section('agenda view');
await db.exec(`set role postgres; update public.cleaning_tasks
               set next_due_on = current_date - 2 where name='Müll rausbringen';`);
r = await as(USER_A, `select name, status, days_until from public.v_cleaning_agenda
                    where name in ('Müll rausbringen','Staubsaugen') order by name`);
ok('overdue task is flagged overdue', r.rows.find(x => x.name === 'Müll rausbringen').status === 'overdue',
   JSON.stringify(r.rows));

section('inventory scan flow');
r = await as(USER_A, `select id from public.storage_locations where name='Vorratsschrank'`);
const LOC = r.rows[0].id;
r = await as(USER_A, `select * from public.inventory_scan_in('4001686315101','Ritter Sport','${LOC}',2)`);
ok('scan created a stock row of 2', Number(r.rows[0].quantity) === 2, JSON.stringify(r.rows[0]));

r = await as(USER_A, `select * from public.inventory_scan_in('4001686315101','Ritter Sport','${LOC}',3)`);
ok('re-scanning the same barcode/location stacks to 5', Number(r.rows[0].quantity) === 5);
const ITEM = r.rows[0].id;

r = await as(USER_A, `select count(*)::int n from public.products where barcode='4001686315101'`);
ok('only one catalog entry per barcode', r.rows[0].n === 1);

r = await as(USER_A, `select * from public.inventory_scan_in('4001686315101','Ritter Sport',null,1)`);
ok('a different location is a separate lot', Number(r.rows[0].quantity) === 1);

r = await as(USER_A, `select total_quantity::int q from public.v_inventory_totals where barcode='4001686315101'`);
ok('totals view sums across locations', Number(r.rows[0].q) === 6, JSON.stringify(r.rows));

r = await as(USER_A, `select * from public.inventory_adjust('${ITEM}', -99, 'consume')`);
ok('adjust clamps at zero instead of failing', Number(r.rows[0].quantity) === 0);

r = await as(USER_A, `select count(*)::int n from public.inventory_items where id='${ITEM}'`);
ok('an emptied lot is deleted, not kept at 0', r.rows[0].n === 0, `got ${r.rows[0].n}`);

r = await as(USER_A, `select count(*)::int n from public.products where barcode='4001686315101'`);
ok('emptying a lot leaves the catalog entry intact', r.rows[0].n === 1, `got ${r.rows[0].n}`);

r = await as(USER_A, `select count(*)::int n from public.inventory_movements`);
ok('every stock change was logged', r.rows[0].n === 4, `got ${r.rows[0].n}`);

r = await as(USER_A, `select path from public.v_location_paths where name='Vorratsschrank'`);
ok('location path renders the hierarchy', r.rows[0].path === 'Küche › Vorratsschrank', r.rows[0].path);

section('inventory: name deduplication + staples');
// Barcode-less entry twice, with different casing and padding each time.
await as(USER_A, `select * from public.inventory_scan_in(null, 'Mehl', '${LOC}', 1)`);
await as(USER_A, `select * from public.inventory_scan_in(null, '  mehl  ', '${LOC}', 2)`);

r = await as(USER_A, `select count(*)::int n from public.products where lower(name)='mehl'`);
ok('typing the same name twice reuses one catalog entry', r.rows[0].n === 1, `got ${r.rows[0].n}`);

r = await as(USER_A, `select total_quantity::int q from public.v_inventory_totals where lower(name)='mehl'`);
ok('...and its quantities add up', Number(r.rows[0].q) === 3, JSON.stringify(r.rows));

// A scanned product must not be merged into by name: same text, real barcode.
await as(USER_A, `select * from public.inventory_scan_in('4009900484169', 'Mehl', '${LOC}', 1)`);
r = await as(USER_A, `select count(*)::int n from public.products where lower(name)='mehl'`);
ok('a scanned barcode still gets its own entry despite the same name',
   r.rows[0].n === 2, `got ${r.rows[0].n}`);

r = await as(USER_A, `select is_low, restock_min_quantity from public.v_inventory_totals
                    where lower(name)='mehl' and barcode is null`);
ok('a product without a threshold is never low', r.rows[0].is_low === false, JSON.stringify(r.rows[0]));

await db.exec(`set role postgres;
  update public.products set restock_min_quantity = 5 where lower(name)='mehl' and barcode is null;`);
r = await as(USER_A, `select is_low from public.v_inventory_totals
                    where lower(name)='mehl' and barcode is null`);
ok('3 on hand against a threshold of 5 reads as low', r.rows[0].is_low === true, JSON.stringify(r.rows[0]));

await db.exec(`set role postgres;
  update public.products set restock_min_quantity = 1 where lower(name)='mehl' and barcode is null;`);
r = await as(USER_A, `select is_low from public.v_inventory_totals
                    where lower(name)='mehl' and barcode is null`);
ok('...and not low once the threshold is below stock', r.rows[0].is_low === false, JSON.stringify(r.rows[0]));

// The case the whole redesign exists for: a staple emptied to zero keeps its
// threshold, because the threshold lives on the product, not the deleted lot.
r = await as(USER_A, `select i.id from public.inventory_items i
                    join public.products p on p.id = i.product_id
                    where lower(p.name)='mehl' and p.barcode is null`);
await as(USER_A, `select * from public.inventory_adjust('${r.rows[0].id}', -99, 'consume')`);
r = await as(USER_A, `select total_quantity::int q, is_low from public.v_inventory_totals
                    where lower(name)='mehl' and barcode is null`);
ok('an emptied staple still reports low so it can be reminded about',
   Number(r.rows[0].q) === 0 && r.rows[0].is_low === true, JSON.stringify(r.rows[0]));

section('inventory: moving stock between locations');
r = await as(USER_A, `select id from public.storage_locations where name='Kühlschrank'`);
const FRIDGE = r.rows[0].id;

await as(USER_A, `select * from public.inventory_scan_in(null, 'Butter', '${LOC}', 2)`);
r = await as(USER_A, `select i.id from public.inventory_items i
                    join public.products p on p.id = i.product_id where p.name='Butter'`);
const BUTTER = r.rows[0].id;

r = await as(USER_A, `select location_id from public.inventory_move('${BUTTER}', '${FRIDGE}')`);
ok('moving relocates the lot', r.rows[0].location_id === FRIDGE, JSON.stringify(r.rows[0]));

r = await as(USER_A, `select count(*)::int n from public.inventory_movements
                    where reason='move' and to_location_id='${FRIDGE}'`);
ok('the move was logged', r.rows[0].n === 1, `got ${r.rows[0].n}`);

// The case a plain UPDATE would fail on: the destination already holds this
// product at the same expiry, so the lot-uniqueness index would reject it.
await as(USER_A, `select * from public.inventory_scan_in(null, 'Butter', '${LOC}', 3)`);
r = await as(USER_A, `select i.id from public.inventory_items i
                    join public.products p on p.id = i.product_id
                    where p.name='Butter' and i.location_id='${LOC}'`);
r = await as(USER_A, `select quantity::int q from public.inventory_move('${r.rows[0].id}', '${FRIDGE}')`);
ok('moving onto an existing lot merges instead of failing', Number(r.rows[0].q) === 5, JSON.stringify(r.rows[0]));

r = await as(USER_A, `select count(*)::int n from public.inventory_items i
                    join public.products p on p.id = i.product_id where p.name='Butter'`);
ok('...and leaves exactly one lot behind', r.rows[0].n === 1, `got ${r.rows[0].n}`);

err = await asExpectError(USER_B, `select public.inventory_move('${BUTTER}', '00000000-0000-0000-0000-000000000000')`);
ok('cannot move stock to a location outside the household', err !== null, 'move unexpectedly succeeded');

// Partial moves. All 5 Butter sit in the fridge at this point.
r = await as(USER_A, `select i.id from public.inventory_items i
                    join public.products p on p.id = i.product_id where p.name='Butter'`);
const BUTTER_LOT = r.rows[0].id;

r = await as(USER_A, `select id, location_id, quantity::int q
                    from public.inventory_move('${BUTTER_LOT}', '${LOC}', 2)`);
ok('a partial move returns the lot the stock arrived in',
   r.rows[0].location_id === LOC && Number(r.rows[0].q) === 2, JSON.stringify(r.rows[0]));
ok('...which is a different lot than the one it came from',
   r.rows[0].id !== BUTTER_LOT, 'the source lot was reused');

r = await as(USER_A, `select location_id, quantity::int q from public.inventory_items i
                    join public.products p on p.id = i.product_id
                    where p.name='Butter' order by q`);
ok('the source lot keeps the remainder',
   r.rows.length === 2 && Number(r.rows[0].q) === 2 && Number(r.rows[1].q) === 3,
   JSON.stringify(r.rows));

r = await as(USER_A, `select coalesce(sum(delta),0)::int s from public.inventory_movements
                    where reason='move'`);
ok('move deltas cancel out, so the log never invents or loses stock',
   Number(r.rows[0].s) === 0, `got ${r.rows[0].s}`);

// Moving the remainder back merges rather than leaving two lots behind.
r = await as(USER_A, `select i.id from public.inventory_items i
                    join public.products p on p.id = i.product_id
                    where p.name='Butter' and i.location_id='${FRIDGE}'`);
r = await as(USER_A, `select quantity::int q from public.inventory_move('${r.rows[0].id}', '${LOC}', 1)`);
ok('a partial move onto an existing lot merges into it', Number(r.rows[0].q) === 3, JSON.stringify(r.rows[0]));

r = await as(USER_A, `select count(*)::int n from public.inventory_items i
                    join public.products p on p.id = i.product_id where p.name='Butter'`);
ok('...and still leaves exactly two lots', r.rows[0].n === 2, `got ${r.rows[0].n}`);

err = await asExpectError(USER_A, `select public.inventory_move('${BUTTER_LOT}', '${LOC}', 99)`);
ok('cannot move more than the lot holds', err !== null, 'over-move unexpectedly succeeded');

err = await asExpectError(USER_A, `select public.inventory_move('${BUTTER_LOT}', '${LOC}', 0)`);
ok('cannot move nothing', err !== null, 'zero move unexpectedly succeeded');

section('todos');
r = await as(USER_A, `insert into public.todos (household_id, title, created_by)
                    values ('${HH}','Milch kaufen','${USER_A}') returning id, is_done, done_at`);
const TODO = r.rows[0].id;
ok('new todo is open with no done_at', r.rows[0].is_done === false && r.rows[0].done_at === null);
r = await as(USER_B, `update public.todos set is_done = true where id='${TODO}' returning done_at, done_by`);
ok('checking off stamps done_at/done_by automatically',
   r.rows[0].done_at !== null && r.rows[0].done_by === USER_B, JSON.stringify(r.rows[0]));
r = await as(USER_B, `update public.todos set is_done = false where id='${TODO}' returning done_at, done_by`);
ok('unchecking clears them again', r.rows[0].done_at === null && r.rows[0].done_by === null);

section('restock → Einkaufsliste');
// Only the cron ever calls this — it is revoked from `authenticated`, the same
// way generate_due_recurring_expenses() is, so the tests drive it as the cron
// does rather than as a member.
const runRestock = async () => {
  await db.exec(`set role service_role;`);
  const out = await db.query(`select public.generate_restock_todos() as n`);
  await db.exec(`set role postgres;`);
  return Number(out.rows[0].n);
};

err = await asExpectError(USER_A, `select public.generate_restock_todos()`);
ok('a member cannot run the generator by hand', err !== null, 'execute was not revoked');

// The staples section left "Mehl" (no barcode) at 0 with a threshold of 1, and
// the trigger from 0021 already wrote the to-do at that moment — no cron run
// needed, which is the whole point.
r = await as(USER_A, `select title, source, product_id, created_by from public.todos
                    where source='restock' and household_id='${HH}'`);
ok('a low staple writes itself onto the list',
   r.rows.length === 1 && r.rows[0].title === 'Mehl' && r.rows[0].product_id !== null,
   JSON.stringify(r.rows));
// The list is the verb: "Mehl kaufen" on the Einkaufsliste says it twice.
ok('...titled with just the product name', r.rows[0].title === 'Mehl', r.rows[0].title);
// Nobody wrote it, and the trigger that runs the generator fires inside the
// transaction of whoever used the stock up — so this must not be them.
ok('...and credited to nobody', r.rows[0].created_by === null, JSON.stringify(r.rows[0]));

ok('the hourly reconcile then finds nothing left to do', (await runRestock()) === 0);

// The dedupe: an hourly cron must not pile up one to-do per run.
await runRestock();
await runRestock();
r = await as(USER_A, `select count(*)::int n from public.todos where source='restock'`);
ok('running again does not duplicate it', r.rows[0].n === 1, `got ${r.rows[0].n}`);

// Restocking clears it again — a shopping list that lies gets ignored — and
// without waiting for the cron: the trigger has to do it, because the list is
// wrong exactly while you are looking at it.
await as(USER_A, `select * from public.inventory_scan_in(null, 'Mehl', '${LOC}', 10)`);
r = await as(USER_A, `select count(*)::int n from public.todos where source='restock' and not is_done`);
ok('scanning stock back in clears the to-do immediately', r.rows[0].n === 0, `got ${r.rows[0].n}`);

// ...and emptying it again brings the to-do back on the spot, including via the
// delete inventory_adjust() does when the last lot hits zero.
r = await as(USER_A, `select i.id from public.inventory_items i
                    join public.products p on p.id = i.product_id
                    where lower(p.name)='mehl' and p.barcode is null`);
await as(USER_A, `select * from public.inventory_adjust('${r.rows[0].id}', -99, 'consume')`);
r = await as(USER_A, `select count(*)::int n from public.todos where source='restock' and not is_done`);
ok('emptying the last lot writes the to-do back immediately', r.rows[0].n === 1, `got ${r.rows[0].n}`);

// Turning the reminder off should take the to-do with it.
await as(USER_A, `update public.products set restock_min_quantity = null
                  where lower(name)='mehl' and barcode is null`);
r = await as(USER_A, `select count(*)::int n from public.todos where source='restock' and not is_done`);
ok('switching the reminder off removes the to-do', r.rows[0].n === 0, `got ${r.rows[0].n}`);

await as(USER_A, `update public.products set restock_min_quantity = 1
                  where lower(name)='mehl' and barcode is null`);
r = await as(USER_A, `select count(*)::int n from public.todos where source='restock' and not is_done`);
ok('...and switching it back on restores it', r.rows[0].n === 1, `got ${r.rows[0].n}`);

// Back to the state the rest of this section expects.
await as(USER_A, `select * from public.inventory_scan_in(null, 'Mehl', '${LOC}', 10)`);
await runRestock();
r = await as(USER_A, `select count(*)::int n from public.todos where source='restock' and not is_done`);
ok('the hourly reconcile agrees with the triggers', r.rows[0].n === 0, `got ${r.rows[0].n}`);

// A hand-written to-do for the same thing is none of the generator's business.
await as(USER_A, `insert into public.todos (household_id, title) values ('${HH}', 'Mehl')`);
await runRestock();
r = await as(USER_A, `select count(*)::int n from public.todos where title='Mehl' and source='manual'`);
ok('a manual to-do with the same title is left alone', r.rows[0].n === 1, `got ${r.rows[0].n}`);

// created_by is stamped from auth.uid() rather than sent by the client, the
// same way done_by is — so "wer hat das aufgeschrieben" cannot be faked.
r = await as(USER_A, `select created_by from public.todos where title='Mehl' and source='manual'`);
ok('a hand-written row is credited to its author', r.rows[0].created_by === USER_A, JSON.stringify(r.rows[0]));

// A ticked-off restock to-do is history and must not block the next one.
await db.exec(`set role postgres;
  update public.products set restock_min_quantity = 20 where lower(name)='mehl' and barcode is null;`);
await runRestock();
r = await as(USER_A, `select id from public.todos where source='restock' and not is_done`);
ok('it comes back when stock drops below the threshold again', r.rows.length === 1, JSON.stringify(r.rows));
await as(USER_A, `update public.todos set is_done = true where id='${r.rows[0].id}'`);
await runRestock();
r = await as(USER_A, `select count(*)::int n from public.todos where source='restock'`);
ok('ticking it off lets the next one be created', r.rows[0].n === 2, `got ${r.rows[0].n}`);

// The whole point of migration 0024: generated rows belong to the shopping
// list, hand-written ones to whichever list they were written on.
r = await as(USER_A, `select count(*)::int n from public.todos
                    where source='restock' and list <> 'shopping'`);
ok('every generated row lands on the Einkaufsliste', r.rows[0].n === 0, `got ${r.rows[0].n}`);

r = await as(USER_A, `select list from public.todos where id='${TODO}'`);
ok('a hand-written to-do stays on the to-do list', r.rows[0].list === 'todo', JSON.stringify(r.rows[0]));

err = await asExpectError(USER_A, `update public.todos set list='todo'
                                   where source='restock' and not is_done`);
ok('a restock row cannot be moved off the Einkaufsliste', err !== null, 'the check let it through');

section('inventory: Vorräte vs. Ausstattung');
// Everything created before 0032 — and everything created without saying — is
// a Vorrat, so the whole section above kept meaning what it meant.
r = await as(USER_A, `select count(*)::int n from public.products where kind <> 'consumable'`);
ok('every pre-existing product is a Vorrat', r.rows[0].n === 0, `got ${r.rows[0].n}`);

await as(USER_A, `select * from public.inventory_scan_in(
                    null, 'Akkuschrauber', '${LOC}', 1, 'piece', null, null, null, null, null, 'equipment')`);
r = await as(USER_A, `select id, kind, default_location_id from public.products where name='Akkuschrauber'`);
const DRILL = r.rows[0].id;
ok('p_kind creates an Ausstattung entry', r.rows[0].kind === 'equipment', JSON.stringify(r.rows[0]));
ok('...and the Ort it was added at becomes its fester Platz',
   r.rows[0].default_location_id === LOC, JSON.stringify(r.rows[0]));

// The reason the split exists at all: a tool must never reach the Einkaufsliste
// through the low-stock path.
err = await asExpectError(USER_A, `update public.products set restock_min_quantity = 1 where id='${DRILL}'`);
ok('Ausstattung cannot be given a Nachkauf-Grenze', err !== null, 'the check let it through');

r = await as(USER_A, `select is_low, is_misplaced from public.v_inventory_totals where product_id='${DRILL}'`);
ok('an item at its fester Platz is not misplaced',
   r.rows[0].is_low === false && r.rows[0].is_misplaced === false, JSON.stringify(r.rows[0]));

r = await as(USER_A, `select id from public.inventory_items where product_id='${DRILL}'`);
await as(USER_A, `select * from public.inventory_move('${r.rows[0].id}', '${FRIDGE}')`);
r = await as(USER_A, `select is_misplaced from public.v_inventory_totals where product_id='${DRILL}'`);
ok('moving it somewhere else flags it as misplaced', r.rows[0].is_misplaced === true, JSON.stringify(r.rows[0]));

// "Noch kein Platz vereinbart" is not the same as "am falschen Platz" — a tool
// nobody has assigned a home to must not nag.
await as(USER_A, `update public.products set default_location_id = null where id='${DRILL}'`);
r = await as(USER_A, `select is_misplaced from public.v_inventory_totals where product_id='${DRILL}'`);
ok('without a fester Platz nothing is misplaced', r.rows[0].is_misplaced === false, JSON.stringify(r.rows[0]));

// A named kind narrows the name match, so the two "Batterien" stay two things.
await as(USER_A, `select * from public.inventory_scan_in(
                    null, 'Batterien', '${LOC}', 4, 'piece', null, null, null, null, null, 'consumable')`);
await as(USER_A, `select * from public.inventory_scan_in(
                    null, 'Batterien', '${LOC}', 1, 'piece', null, null, null, null, null, 'equipment')`);
r = await as(USER_A, `select kind from public.products where name='Batterien' order by kind`);
ok('the same name in both kinds stays two catalog entries',
   r.rows.length === 2 && r.rows[0].kind === 'consumable' && r.rows[1].kind === 'equipment',
   JSON.stringify(r.rows));

// ...but a caller that cannot classify (the Einkauf checkout booking in a
// hand-written row) must still land on something rather than fork a third.
await as(USER_A, `select * from public.inventory_scan_in(null, 'Akkuschrauber', '${LOC}', 1)`);
r = await as(USER_A, `select count(*)::int n from public.products where name='Akkuschrauber'`);
ok('an unclassified add still matches an existing Ausstattung', r.rows[0].n === 1, `got ${r.rows[0].n}`);

// Reclassifying a staple has to take its Einkaufsliste row with it. "Mehl" is
// still low with a threshold of 20 from the section above.
r = await as(USER_A, `select id from public.products where lower(name)='mehl' and barcode is null`);
const FLOUR = r.rows[0].id;
r = await as(USER_A, `select count(*)::int n from public.todos
                    where source='restock' and not is_done and product_id='${FLOUR}'`);
ok('the staple is on the Einkaufsliste to begin with', r.rows[0].n === 1, `got ${r.rows[0].n}`);

await as(USER_A, `update public.products set kind='equipment', restock_min_quantity=null where id='${FLOUR}'`);
r = await as(USER_A, `select count(*)::int n from public.todos
                    where source='restock' and not is_done and product_id='${FLOUR}'`);
ok('switching it to Ausstattung clears its Einkaufsliste row', r.rows[0].n === 0, `got ${r.rows[0].n}`);

r = await as(USER_A, `select is_low from public.v_inventory_totals where product_id='${FLOUR}'`);
ok('...and it can no longer read as low', r.rows[0].is_low === false, JSON.stringify(r.rows[0]));

// Put it back so the sections below still see the Vorrat they were written for.
await as(USER_A, `update public.products set kind='consumable' where id='${FLOUR}'`);

section('inventory: angebrochene Packungen');
await as(USER_A, `select * from public.inventory_scan_in(null, 'Zucker', '${LOC}', 2)`);
r = await as(USER_A, `select i.id from public.inventory_items i
                    join public.products p on p.id = i.product_id where p.name='Zucker'`);
const SUGAR = r.rows[0].id;

r = await as(USER_A, `select quantity::float q, (opened_at is not null) as opened
                    from public.inventory_set_quantity('${SUGAR}', 1.5, true)`);
ok('a lot can hold half a pack, marked as opened',
   Number(r.rows[0].q) === 1.5 && r.rows[0].opened === true, JSON.stringify(r.rows[0]));

r = await as(USER_A, `select delta::float d, reason from public.inventory_movements
                    where item_id='${SUGAR}' order by created_at desc limit 1`);
ok('...and it is logged as a correction, not as consumption',
   Number(r.rows[0].d) === -0.5 && r.rows[0].reason === 'correction', JSON.stringify(r.rows[0]));

// The reason fractions exist at all: a threshold of ½ must not fire while a
// whole pack is still in the cupboard, and must fire once it is broken into.
await as(USER_A, `update public.products set restock_min_quantity = 0.5 where name='Zucker'`);
await as(USER_A, `select * from public.inventory_set_quantity('${SUGAR}', 1)`);
r = await as(USER_A, `select is_low from public.v_inventory_totals where name='Zucker'`);
ok('one whole pack against a ½ threshold is not low', r.rows[0].is_low === false, JSON.stringify(r.rows[0]));

r = await as(USER_A, `select * from public.inventory_set_quantity('${SUGAR}', 0.5, true)`);
r = await as(USER_A, `select is_low, total_quantity::float q from public.v_inventory_totals where name='Zucker'`);
ok('...half a pack is', r.rows[0].is_low === true && Number(r.rows[0].q) === 0.5, JSON.stringify(r.rows[0]));

r = await as(USER_A, `select title, list from public.todos
                    where source='restock' and not is_done and title like 'Zucker%'`);
ok('...and it writes itself onto the Einkaufsliste straight away',
   r.rows.length === 1 && r.rows[0].list === 'shopping', JSON.stringify(r.rows));

// Setting a lot to zero is the same "an empty lot is not inventory" rule
// inventory_adjust() has followed since migration 0015.
await as(USER_A, `select * from public.inventory_set_quantity('${SUGAR}', 0)`);
r = await as(USER_A, `select count(*)::int n from public.inventory_items where id='${SUGAR}'`);
ok('setting a lot to zero removes it', r.rows[0].n === 0, `got ${r.rows[0].n}`);

err = await asExpectError(USER_A, `select public.inventory_set_quantity('${SUGAR}', 1)`);
ok('a lot that is gone cannot be set', err !== null, 'it unexpectedly succeeded');

r = await as(USER_A, `select i.id from public.inventory_items i
                    join public.products p on p.id = i.product_id where p.name='Butter' limit 1`);
err = await asExpectError(USER_A, `select public.inventory_set_quantity('${r.rows[0].id}', -1)`);
ok('a negative amount is rejected', err !== null, 'negative stock was accepted');

section('Einkaufshistorie');
// Three purchases, ten days apart, with the middle one spelled differently and
// padded — done_at is passed explicitly, which the stamp trigger preserves.
await as(USER_A, `insert into public.todos (household_id, list, title, is_done, done_at, done_by)
                  values ('${HH}', 'shopping', 'Kaffee',  true, now() - interval '30 days', '${USER_A}'),
                         ('${HH}', 'shopping', ' kaffee', true, now() - interval '20 days', '${USER_B}'),
                         ('${HH}', 'shopping', 'Kaffee',  true, now() - interval '10 days', '${USER_A}')`);

r = await as(USER_A, `select name, times_bought, avg_interval_days::float i,
                             days_since_bought d, is_due
                      from public.v_shopping_suggestions where item_key = 'kaffee'`);
ok('spelling variants collapse into one suggestion', r.rows[0].times_bought === 3, JSON.stringify(r.rows));
ok('...with the most recent spelling as the label', r.rows[0].name === 'Kaffee', r.rows[0].name);
ok('...and the rhythm between purchases', Number(r.rows[0].i) === 10, JSON.stringify(r.rows[0]));
ok('...so it reads as due again', r.rows[0].is_due === true && r.rows[0].d === 10, JSON.stringify(r.rows[0]));

// One purchase is not a rhythm, however long ago it was.
await as(USER_A, `insert into public.todos (household_id, list, title, is_done, done_at, done_by)
                  values ('${HH}', 'shopping', 'Wachsmalstifte', true, now() - interval '400 days', '${USER_A}')`);
r = await as(USER_A, `select times_bought, avg_interval_days, is_due
                      from public.v_shopping_suggestions where item_key = 'wachsmalstifte'`);
ok('a one-off never becomes a suggestion to repeat',
   r.rows[0].times_bought === 1 && r.rows[0].avg_interval_days === null && r.rows[0].is_due === false,
   JSON.stringify(r.rows[0]));

// The receipt side of the same name: prices come from expense_items, which the
// list itself never records.
await as(USER_A, `select * from public.create_expense('Rewe', 449, '${USER_A}', 'items', now(), null,
      'Lebensmittel', '[{"name":" KAFFEE ","total_cents":449}]'::jsonb)`);
r = await as(USER_A, `select last_price_cents::int p, times_paid
                      from public.v_shopping_suggestions where item_key = 'kaffee'`);
ok('the receipt history joins onto the same item',
   Number(r.rows[0].p) === 449 && r.rows[0].times_paid === 1, JSON.stringify(r.rows[0]));

// The whole point of soft-clearing: tidying the screen must not cost the memory.
await as(USER_A, `update public.todos set cleared_at = now()
                  where list = 'shopping' and is_done and cleared_at is null`);
r = await as(USER_A, `select times_bought from public.v_shopping_suggestions where item_key = 'kaffee'`);
ok('clearing the list keeps the history', r.rows[0].times_bought === 3, JSON.stringify(r.rows));

section('Einkauf → Inventar');
r = await as(USER_A, `select id, default_location_id from public.products where name = 'Zucker'`);
const SUGAR_PRODUCT = r.rows[0].id;
const SUGAR_HOME = r.rows[0].default_location_id;

// Zucker was emptied in the open-packs section, so it is on the Einkaufsliste
// right now. Buying it is what should end that.
r = await as(USER_A, `select count(*)::int n from public.todos
                      where source = 'restock' and not is_done and title = 'Zucker'`);
ok('an empty staple is on the list before the shop', r.rows[0].n === 1, `got ${r.rows[0].n}`);

r = await as(USER_A, `select quantity::float q, location_id
                      from public.inventory_add_stock('${SUGAR_PRODUCT}', 2)`);
ok('buying it books the stock back in', Number(r.rows[0].q) === 2, JSON.stringify(r.rows[0]));
// Nobody unpacking shopping should have to answer "welches Regal" for the
// sugar that has lived in the same cupboard for a year.
ok('...into the place it normally lives',
   r.rows[0].location_id === SUGAR_HOME && SUGAR_HOME !== null,
   `${r.rows[0].location_id} vs ${SUGAR_HOME}`);

r = await as(USER_A, `select delta::float d, reason from public.inventory_movements
                      where product_id = '${SUGAR_PRODUCT}' order by created_at desc limit 1`);
ok('...logged as stock coming in',
   Number(r.rows[0].d) === 2 && r.rows[0].reason === 'scan_in', JSON.stringify(r.rows[0]));

r = await as(USER_A, `select count(*)::int n from public.todos
                      where source = 'restock' and not is_done and title = 'Zucker'`);
ok('...and the Einkaufsliste entry disappears by itself', r.rows[0].n === 0, `got ${r.rows[0].n}`);

err = await asExpectError(USER_A, `select public.inventory_add_stock(
        '00000000-0000-0000-0000-000000000000', 1)`);
ok('a product from nowhere cannot be stocked', err !== null, 'it unexpectedly succeeded');

err = await asExpectError(USER_A, `select public.inventory_add_stock('${SUGAR_PRODUCT}', 0)`);
ok('nor can nothing be stocked', err !== null, 'zero quantity was accepted');

// The link back to the money, and what happens when the money is deleted.
r = await as(USER_A, `select id from public.expenses where title = 'Rewe'`);
const REWE = r.rows[0].id;
await as(USER_A, `update public.todos set expense_id = '${REWE}'
                  where list = 'shopping' and lower(btrim(title)) = 'kaffee'`);
await as(USER_A, `delete from public.expenses where id = '${REWE}'`);
r = await as(USER_A, `select count(*)::int n from public.todos
                      where lower(btrim(title)) = 'kaffee' and expense_id is null`);
ok('deleting the expense keeps the purchases, minus the link', r.rows[0].n === 3, `got ${r.rows[0].n}`);

section('events');
await as(USER_A, `insert into public.events (household_id, kind, title, starts_on, repeat_yearly, created_by)
                  values ('${HH}', 'anniversary', 'Zusammen', current_date - 800, true, '${USER_A}')`);
await as(USER_A, `insert into public.events (household_id, title, place, starts_on, starts_at, created_by)
                  values ('${HH}', 'Marie kommt vorbei', 'bei uns', current_date + 3, '18:30', '${USER_A}')`);

r = await as(USER_A, `select title, days_until, days_since_start, years, next_on::text
                    from public.v_event_agenda where kind='anniversary'`);
ok('an anniversary counts the days since it started',
   r.rows[0].days_since_start === 800, JSON.stringify(r.rows[0]));
ok('...and its next occurrence is in the future',
   r.rows[0].days_until >= 0 && r.rows[0].days_until <= 366, JSON.stringify(r.rows[0]));
ok('...on its third year', r.rows[0].years === 3, JSON.stringify(r.rows[0]));

r = await as(USER_A, `select days_until from public.v_event_agenda where title='Marie kommt vorbei'`);
ok('a one-off event counts down to its date', r.rows[0].days_until === 3, JSON.stringify(r.rows[0]));

// 29 February: the next occurrence has to land on a day that exists.
r = await as(USER_A, `select public.event_next_occurrence('2024-02-29', true, '2027-01-10')::text as d`);
ok('a 29 February anniversary clamps to the 28th in a common year',
   r.rows[0].d === '2027-02-28', r.rows[0].d);
r = await as(USER_A, `select public.event_next_occurrence('2024-02-29', true, '2028-01-10')::text as d`);
ok('...and is itself again in a leap year', r.rows[0].d === '2028-02-29', r.rows[0].d);

// A yearly date already past this year rolls to next year.
r = await as(USER_A, `select public.event_next_occurrence('2000-01-05', true, '2026-07-31')::text as d`);
ok('a yearly date that has passed rolls forward', r.rows[0].d === '2027-01-05', r.rows[0].d);

err = await asExpectError(USER_A, `insert into public.events (household_id, kind, title, starts_on)
                                  values ('${HH}', 'anniversary', 'Einmalig', current_date)`);
ok('an anniversary must repeat', err !== null, 'non-repeating anniversary accepted');

err = await asExpectError(USER_A, `insert into public.events (household_id, title, starts_on, ends_on)
                                  values ('${HH}', 'Rückwärts', current_date, current_date - 1)`);
ok('an event cannot end before it starts', err !== null, 'inverted range accepted');

r = await as(USER_B, `select count(*)::int n from public.v_event_agenda`);
ok('both members see the same events', r.rows[0].n === 2, `got ${r.rows[0].n}`);

section('locations: renaming and re-parenting');
r = await as(USER_A, `select id from public.storage_locations where name='Küche'`);
const KITCHEN = r.rows[0].id;
r = await as(USER_A, `select id from public.storage_locations where name='Vorratsschrank'`);
const PANTRY = r.rows[0].id;

r = await as(USER_A, `select name, kind from public.update_location('${PANTRY}', 'Speisekammer', 'pantry')`);
ok('a location can be renamed and given a free-text kind',
   r.rows[0].name === 'Speisekammer' && r.rows[0].kind === 'pantry', JSON.stringify(r.rows[0]));

r = await as(USER_A, `select path from public.v_location_paths where id='${PANTRY}'`);
ok('the path picks the new name up', r.rows[0].path === 'Küche › Speisekammer', r.rows[0].path);

// The move that would hang v_location_paths for good.
err = await asExpectError(USER_A, `select public.update_location('${KITCHEN}', null, null, '${PANTRY}')`);
ok('a location cannot be moved under its own child', err !== null, 'cycle was allowed');

err = await asExpectError(USER_A, `select public.update_location('${KITCHEN}', null, null, '${KITCHEN}')`);
ok('...nor under itself', err !== null, 'self-parent was allowed');

r = await as(USER_A, `select parent_id from public.update_location('${PANTRY}', null, null, null, true)`);
ok('clearing the parent detaches it', r.rows[0].parent_id === null, JSON.stringify(r.rows[0]));

r = await as(USER_A, `select path from public.v_location_paths where id='${PANTRY}'`);
ok('...and the path shortens accordingly', r.rows[0].path === 'Speisekammer', r.rows[0].path);

section('house rules');
for (const text of ['Schuhe aus', 'Müll raus am Dienstag', 'Spülmaschine ausräumen']) {
  await as(USER_A, `insert into public.house_rules (household_id, text, position, created_by)
                    values ('${HH}', '${text}', (
                      select coalesce(max(position), 0) + 1 from public.house_rules where household_id='${HH}'
                    ), '${USER_A}')`);
}

r = await as(USER_B, `select text from public.house_rules where household_id='${HH}' order by position`);
ok('both members see the same ordered list',
   r.rows.map((x) => x.text).join(' | ') === 'Schuhe aus | Müll raus am Dienstag | Spülmaschine ausräumen',
   JSON.stringify(r.rows));

r = await as(USER_A, `select id from public.house_rules where text='Spülmaschine ausräumen'`);
const RULE = r.rows[0].id;

await as(USER_B, `select public.house_rules_move('${RULE}', 'up')`);
r = await as(USER_A, `select text from public.house_rules where household_id='${HH}' order by position`);
ok('moving a rule up swaps it with its neighbour',
   r.rows.map((x) => x.text).join(' | ') === 'Schuhe aus | Spülmaschine ausräumen | Müll raus am Dienstag',
   JSON.stringify(r.rows));

// Already first: a no-op rather than an error, so holding the button does not
// start throwing once the top is reached.
r = await as(USER_A, `select id from public.house_rules where text='Schuhe aus'`);
await as(USER_A, `select public.house_rules_move('${r.rows[0].id}', 'up')`);
r = await as(USER_A, `select text from public.house_rules where household_id='${HH}' order by position limit 1`);
ok('moving the first rule up changes nothing', r.rows[0].text === 'Schuhe aus', JSON.stringify(r.rows[0]));

// Equal positions cannot come from the app, but two clients inserting in the
// same moment can produce them — the swap must still make progress.
await db.exec(`set role postgres;
  update public.house_rules set position = 1 where household_id='${HH}';`);
r = await as(USER_A, `select id, text from public.house_rules where household_id='${HH}' order by created_at offset 1 limit 1`);
await as(USER_A, `select public.house_rules_move('${r.rows[0].id}', 'up')`);
const MOVED = r.rows[0].text;
r = await as(USER_A, `select text from public.house_rules where household_id='${HH}' order by position, created_at limit 1`);
ok('a tie on position still reorders', r.rows[0].text === MOVED, JSON.stringify(r.rows[0]));

err = await asExpectError(USER_A, `select public.house_rules_move('${RULE}', 'sideways')`);
ok('an unknown direction is rejected', err !== null, 'bad direction unexpectedly accepted');

err = await asExpectError(USER_A, `insert into public.house_rules (household_id, text)
                                  values ('00000000-0000-0000-0000-000000000000', 'Fremde Regel')`);
ok('a rule cannot be written into another household', err !== null, 'RLS let a foreign insert through');

section('dog commands');
await as(USER_A, `insert into public.dog_commands (household_id, command, description, created_by)
                  values ('${HH}', 'Sitz', 'Hintern auf den Boden, bleibt bis „Okay“.', '${USER_A}')`);

r = await as(USER_B, `select id, command, description from public.dog_commands where household_id='${HH}'`);
ok('both members see the same commands',
   r.rows.length === 1 && r.rows[0].command === 'Sitz' && !!r.rows[0].description,
   JSON.stringify(r.rows));
const COMMAND = r.rows[0].id;

// Either of them may correct the other's wording — that is the entire point of
// keeping this in one shared place.
await as(USER_B, `update public.dog_commands set description='Hintern auf den Boden.' where id='${COMMAND}'`);
r = await as(USER_A, `select description, (updated_at > created_at) as touched
                    from public.dog_commands where id='${COMMAND}'`);
ok('either member can edit, and updated_at is stamped',
   r.rows[0].description === 'Hintern auf den Boden.' && r.rows[0].touched === true,
   JSON.stringify(r.rows[0]));

err = await asExpectError(USER_A, `insert into public.dog_commands (household_id, command)
                                   values ('${HH}', '   ')`);
ok('a blank command is rejected', err !== null, 'whitespace was accepted as a command');

err = await asExpectError(USER_A, `insert into public.dog_commands (household_id, command)
                                   values ('00000000-0000-0000-0000-000000000000', 'Fremd')`);
ok('a command cannot be written into another household', err !== null, 'RLS let a foreign insert through');

await as(USER_B, `delete from public.dog_commands where id='${COMMAND}'`);
r = await as(USER_A, `select count(*)::int n from public.dog_commands`);
ok('deleting removes it for both', r.rows[0].n === 0, `got ${r.rows[0].n}`);

section('recurring expenses');
await db.exec(`set role postgres;
  insert into public.recurring_expenses
    (household_id, name, category, amount_cents, paid_by, recurrence_unit, day_of_month, next_due_on, created_by)
  values
    -- The 1st of *this* month, not current_date - 5: a template due five days
    -- ago advances to the next 1st, which on the 2nd or 3rd of a month is still
    -- in the past — so the "re-running generates nothing" assertion below would
    -- fail for the first few days of every month. Anchoring on the 1st makes
    -- the fixture due today-or-earlier and its successor always in the future.
    ('${HH}', 'Miete', 'Miete', 85000, '${USER_A}', 'month', 1, date_trunc('month', current_date)::date, '${USER_A}'),
    ('${HH}', 'Zu früh', 'Sonstiges', 1000, '${USER_A}', 'month', 1, current_date + 30, '${USER_A}'),
    ('${HH}', 'Pausiert', 'Sonstiges', 2000, '${USER_A}', 'month', 1, date_trunc('month', current_date)::date, '${USER_A}');
  update public.recurring_expenses set is_active = false where name = 'Pausiert';`);

// next_due_on as text: PGlite hydrates dates into JS Date objects, which do
// not survive being interpolated back into SQL.
r = await db.query(`select id, next_due_on::text from public.recurring_expenses where name='Miete'`);
const RENT = r.rows[0];

await db.exec(`set role service_role;`);
r = await db.query(`select public.generate_due_recurring_expenses() as n`);
ok('generator only materialises the one due, active template', r.rows[0].n === 1, `got ${r.rows[0].n}`);

await db.exec(`set role postgres;`);
r = await db.query(`select title, total_cents::int t, category from public.expenses where title='Miete'`);
ok('generated expense matches the template',
   r.rows[0].t === 85000 && r.rows[0].category === 'Miete', JSON.stringify(r.rows[0]));

r = await db.query(`select share_cents::int c from public.expense_shares es
                    join public.expenses e on e.id = es.expense_id where e.title='Miete'`);
ok('generated expense split equally (no remainder on 850.00 €)',
   r.rows.length === 2 && r.rows.every((x) => Number(x.c) === 42500), JSON.stringify(r.rows));

r = await db.query(`select (next_due_on > '${RENT.next_due_on}'::date) as advanced,
                           extract(day from next_due_on)::int as dom, next_due_on::text
                    from public.recurring_expenses where id='${RENT.id}'`);
ok('template advanced to the 1st of a later month',
   r.rows[0].advanced === true && r.rows[0].dom === 1,
   `${RENT.next_due_on} -> ${r.rows[0].next_due_on}`);

await db.exec(`set role service_role;`);
r = await db.query(`select public.generate_due_recurring_expenses() as n`);
ok('re-running immediately generates nothing new', r.rows[0].n === 0, `got ${r.rows[0].n}`);
await db.exec(`set role postgres;`);

r = await as(USER_A, `select category, total_cents::int t from public.v_expense_category_month
                    where household_id='${HH}' and category='Miete'`);
ok('category/month view picks up the generated rent expense',
   r.rows.length === 1 && Number(r.rows[0].t) === 85000, JSON.stringify(r.rows));

await as(USER_A, `select * from public.create_expense('Markt1', 310, '${USER_A}', 'items', now(), null, null,
      '[{"name":"Milch","total_cents":150},{"name":" MILCH ","total_cents":160}]'::jsonb)`);
await as(USER_A, `select * from public.create_expense('Markt2', 140, '${USER_A}', 'items', now(), null, null,
      '[{"name":"milch","total_cents":140}]'::jsonb)`);

r = await as(USER_A, `select purchase_count, total_cents::int t from public.v_item_purchase_frequency
                    where household_id='${HH}' and item_name='milch'`);
ok('item frequency view normalises case/whitespace and sums 3 purchases',
   r.rows[0].purchase_count === 3 && Number(r.rows[0].t) === 450, JSON.stringify(r.rows));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

