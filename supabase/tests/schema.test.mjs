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

section('restock to-dos');
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
r = await as(USER_A, `select title, source, product_id from public.todos
                    where source='restock' and household_id='${HH}'`);
ok('a low staple writes itself onto the list',
   r.rows.length === 1 && r.rows[0].title === 'Mehl kaufen' && r.rows[0].product_id !== null,
   JSON.stringify(r.rows));

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
await as(USER_A, `insert into public.todos (household_id, title, created_by)
                  values ('${HH}', 'Mehl kaufen', '${USER_A}')`);
await runRestock();
r = await as(USER_A, `select count(*)::int n from public.todos where title='Mehl kaufen' and source='manual'`);
ok('a manual to-do with the same title is left alone', r.rows[0].n === 1, `got ${r.rows[0].n}`);

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

section('recurring expenses');
await db.exec(`set role postgres;
  insert into public.recurring_expenses
    (household_id, name, category, amount_cents, paid_by, recurrence_unit, day_of_month, next_due_on, created_by)
  values
    ('${HH}', 'Miete', 'Miete', 85000, '${USER_A}', 'month', 1, current_date - 5, '${USER_A}'),
    ('${HH}', 'Zu früh', 'Sonstiges', 1000, '${USER_A}', 'month', 1, current_date + 30, '${USER_A}'),
    ('${HH}', 'Pausiert', 'Sonstiges', 2000, '${USER_A}', 'month', 1, current_date - 5, '${USER_A}');
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

