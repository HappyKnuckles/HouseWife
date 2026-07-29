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

const NICO = '11111111-1111-1111-1111-111111111111';
const WIFE = '22222222-2222-2222-2222-222222222222';

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
  values ('${NICO}', 'nico@example.com', '{"display_name":"Nico"}'),
         ('${WIFE}', 'wife@example.com', '{"display_name":"Marie"}');`);
let r = await db.query(`select display_name from public.profiles order by display_name`);
ok('both signups produced profiles', r.rows.length === 2, JSON.stringify(r.rows));
ok('display_name came from metadata', r.rows[0].display_name === 'Marie' && r.rows[1].display_name === 'Nico');

section('household creation + invite');
r = await as(NICO, `select public.create_household('Zuhause') as id`);
const HH = r.rows[0].id;
ok('create_household returned an id', !!HH);

r = await as(NICO, `select count(*)::int n from public.cleaning_tasks`);
ok('starter Putzplan seeded (8 tasks)', r.rows[0].n === 8, `got ${r.rows[0].n}`);

let err = await asExpectError(NICO, `select public.create_household('Zweites')`);
ok('cannot create a second household', /already belong/.test(err ?? ''), err ?? 'no error');

// Wife cannot see the household before joining.
r = await as(WIFE, `select count(*)::int n from public.cleaning_tasks`);
ok('RLS: outsider sees no tasks', r.rows[0].n === 0, `got ${r.rows[0].n}`);

err = await asExpectError(WIFE, `update public.profiles set household_id = '${HH}' where id = '${WIFE}'`);
ok('RLS: cannot self-assign household_id', err !== null, 'update unexpectedly succeeded');

r = await as(NICO, `select public.create_invite() as code`);
const CODE = r.rows[0].code;
ok('invite code has the right shape', /^[A-Z0-9]{6}$/.test(CODE), CODE);

err = await asExpectError(WIFE, `select public.accept_invite('ZZZZZZ')`);
ok('bogus invite code rejected', /invalid or expired/.test(err ?? ''), err ?? 'no error');

await as(WIFE, `select public.accept_invite('${CODE}')`);
r = await as(WIFE, `select count(*)::int n from public.cleaning_tasks`);
ok('RLS: member now sees the tasks', r.rows[0].n === 8, `got ${r.rows[0].n}`);

r = await as(NICO, `select count(*)::int n from public.cleaning_tasks
                    where assignment_mode='rotating' and '${WIFE}' = any(rotation_order)`);
ok('joining added the member to every rotation', r.rows[0].n === 8, `got ${r.rows[0].n}`);

section('expense splitting + the balance invariant');
// 40.01 € split 50/50 → the odd cent goes to the payer.
r = await as(NICO, `select * from public.create_expense('Wocheneinkauf', 4001)`);
const EXP = r.rows[0].id;
r = await as(NICO, `select profile_id, share_cents::int c from public.expense_shares
                    where expense_id='${EXP}' order by share_cents desc`);
ok('equal split: shares sum to the total exactly',
   r.rows.reduce((a, x) => a + Number(x.c), 0) === 4001, JSON.stringify(r.rows));
ok('equal split: the odd cent goes to the payer',
   r.rows[0].profile_id === NICO && Number(r.rows[0].c) === 2001, JSON.stringify(r.rows));

// The invariant itself: a raw insert without shares cannot commit. This is
// precisely why create_expense() has to exist.
err = await asExpectError(NICO, `
  insert into public.expenses (household_id, paid_by, title, total_cents, created_by)
  values ('${HH}', '${NICO}', 'Kaputt', 5000, '${NICO}')`);
ok('raw insert without shares rejected at commit', /unbalanced/.test(err ?? ''), err ?? 'no error');

err = await asExpectError(NICO, `update public.expenses set total_cents = 9999 where id='${EXP}'`);
ok('editing total without reshaping shares rejected', /unbalanced/.test(err ?? ''), err ?? 'no error');

// Per-item split: the beer is Nico's alone, the rest is shared.
r = await as(NICO, `select * from public.create_expense(
      'Getränkemarkt', 2000, '${NICO}', 'items', now(), null, null,
      '[{"name":"Bier","total_cents":600,"paid_for":"${NICO}"},
        {"name":"Wasser","total_cents":1400}]'::jsonb)`);
const EXP2 = r.rows[0].id;
r = await as(NICO, `select profile_id, share_cents::int c from public.expense_shares
                    where expense_id='${EXP2}' order by share_cents desc`);
ok('item split: 6.00 € solo + 7.00 € of the shared 14.00 €',
   Number(r.rows.find(x => x.profile_id === NICO).c) === 1300 &&
   Number(r.rows.find(x => x.profile_id === WIFE).c) === 700, JSON.stringify(r.rows));

// Custom ratio split.
r = await as(NICO, `select * from public.create_expense(
      'Urlaubskasse', 10000, '${NICO}', 'shares', now(), null, null, '[]'::jsonb,
      '[{"profile_id":"${NICO}","share_cents":7000},
        {"profile_id":"${WIFE}","share_cents":3000}]'::jsonb)`);
r = await as(NICO, `select share_cents::int c, share_ratio from public.expense_shares
                    where expense_id='${r.rows[0].id}' and profile_id='${WIFE}'`);
ok('custom shares stored with their ratio',
   Number(r.rows[0].c) === 3000 && Number(r.rows[0].share_ratio) === 0.3, JSON.stringify(r.rows));

err = await asExpectError(NICO, `select public.create_expense(
      'Falsch', 10000, '${NICO}', 'shares', now(), null, null, '[]'::jsonb,
      '[{"profile_id":"${NICO}","share_cents":1}]'::jsonb)`);
ok('custom shares that do not add up are rejected', /sum to 1 cents/.test(err ?? ''), err ?? 'no error');

// Clear the extra expenses so the settle-up assertions below stay readable.
await as(NICO, `delete from public.expenses where id <> '${EXP}'`);

r = await as(NICO, `select profile_id, net_cents::int from public.v_household_balances order by net_cents desc`);
ok('balance: payer is owed 20.00 €', Number(r.rows[0].net_cents) === 2000, JSON.stringify(r.rows));
ok('balances sum to zero', r.rows.reduce((a, x) => a + Number(x.net_cents), 0) === 0);

section('cross-household integrity');
await db.exec(`set role postgres;
  insert into auth.users (id, email) values ('33333333-3333-3333-3333-333333333333','x@y.z');`);
err = await asExpectError(NICO, `
  insert into public.expenses (household_id, paid_by, title, total_cents, created_by)
  values ('${HH}', '33333333-3333-3333-3333-333333333333', 'Fremd', 100, '${NICO}')`);
ok('cannot name a non-member as payer', err !== null, 'insert unexpectedly succeeded');

section('settle up');
r = await as(NICO, `select public.settle_up(null, 'transfer', 'Überwiesen') as id`);
ok('settle_up created a settlement', !!r.rows[0].id);
r = await as(NICO, `select amount_cents::int a, from_profile, to_profile from public.settlements`);
ok('settlement is 20.00 € from the debtor to the payer',
   Number(r.rows[0].a) === 2000 && r.rows[0].from_profile === WIFE && r.rows[0].to_profile === NICO,
   JSON.stringify(r.rows));
r = await as(NICO, `select count(*)::int n from public.expenses where status='open'`);
ok('no open expenses left', r.rows[0].n === 0);
r = await as(NICO, `select coalesce(sum(abs(net_cents)),0)::int s from public.v_household_balances`);
ok('balance is back to zero', Number(r.rows[0].s) === 0);

section('Putzplan: recurrence + rotation');
r = await as(NICO, `select id, next_due_on, assigned_to, rotation_order,
                           (next_due_on = current_date) as is_today
                    from public.cleaning_tasks where name='Staubsaugen'`);
const VAC = r.rows[0];
ok('interval task starts due today', VAC.is_today === true, String(VAC.next_due_on));

r = await as(NICO, `select next_due_on, extract(isodow from next_due_on)::int dow
                    from public.cleaning_tasks where name='Bad putzen'`);
ok('fixed Saturday task is scheduled on a Saturday', r.rows[0].dow === 6, JSON.stringify(r.rows[0]));

r = await as(NICO, `select * from public.complete_cleaning_task('${VAC.id}')`);
const after = r.rows[0];
r = await as(NICO, `select (next_due_on - current_date)::int d from public.cleaning_tasks where id='${VAC.id}'`);
ok('completing advanced the due date by 4 days', r.rows[0].d === 4, `${after.next_due_on} (${r.rows[0].d}d)`);
ok('completion rotated to the other member', after.assigned_to !== VAC.assigned_to,
   `${VAC.assigned_to} -> ${after.assigned_to}`);
ok('last_completed_by recorded', after.last_completed_by === NICO);

r = await as(NICO, `select count(*)::int n from public.cleaning_completions where task_id='${VAC.id}'`);
ok('exactly one completion row was written', r.rows[0].n === 1, `got ${r.rows[0].n}`);
r = await as(NICO, `select id from public.cleaning_completions where task_id='${VAC.id}'`);
const undone = r.rows[0].id;
r = await as(NICO, `select assigned_to, (next_due_on = current_date) as is_today
                    from public.undo_cleaning_completion('${undone}')`);
ok('undo restored the due date', r.rows[0].is_today === true, String(r.rows[0].next_due_on));
ok('undo restored the assignee', r.rows[0].assigned_to === VAC.assigned_to);

// A long-overdue fixed task must not stay in the past after being ticked.
await db.exec(`set role postgres; update public.cleaning_tasks
               set next_due_on = current_date - 30 where name='Fenster putzen';`);
r = await as(NICO, `select id from public.cleaning_tasks where name='Fenster putzen'`);
r = await as(NICO, `select (next_due_on > current_date) as future, next_due_on
                    from public.complete_cleaning_task('${r.rows[0].id}')`);
ok('overdue fixed task lands in the future', r.rows[0].future === true, String(r.rows[0].next_due_on));

section('agenda view');
await db.exec(`set role postgres; update public.cleaning_tasks
               set next_due_on = current_date - 2 where name='Müll rausbringen';`);
r = await as(NICO, `select name, status, days_until from public.v_cleaning_agenda
                    where name in ('Müll rausbringen','Staubsaugen') order by name`);
ok('overdue task is flagged overdue', r.rows.find(x => x.name === 'Müll rausbringen').status === 'overdue',
   JSON.stringify(r.rows));

section('inventory scan flow');
r = await as(NICO, `select id from public.storage_locations where name='Vorratsschrank'`);
const LOC = r.rows[0].id;
r = await as(NICO, `select * from public.inventory_scan_in('4001686315101','Ritter Sport','${LOC}',2)`);
ok('scan created a stock row of 2', Number(r.rows[0].quantity) === 2, JSON.stringify(r.rows[0]));

r = await as(NICO, `select * from public.inventory_scan_in('4001686315101','Ritter Sport','${LOC}',3)`);
ok('re-scanning the same barcode/location stacks to 5', Number(r.rows[0].quantity) === 5);
const ITEM = r.rows[0].id;

r = await as(NICO, `select count(*)::int n from public.products where barcode='4001686315101'`);
ok('only one catalog entry per barcode', r.rows[0].n === 1);

r = await as(NICO, `select * from public.inventory_scan_in('4001686315101','Ritter Sport',null,1)`);
ok('a different location is a separate lot', Number(r.rows[0].quantity) === 1);

r = await as(NICO, `select total_quantity::int q from public.v_inventory_totals where barcode='4001686315101'`);
ok('totals view sums across locations', Number(r.rows[0].q) === 6, JSON.stringify(r.rows));

r = await as(NICO, `select * from public.inventory_adjust('${ITEM}', -99, 'consume')`);
ok('adjust clamps at zero instead of failing', Number(r.rows[0].quantity) === 0);

r = await as(NICO, `select count(*)::int n from public.inventory_movements`);
ok('every stock change was logged', r.rows[0].n === 4, `got ${r.rows[0].n}`);

r = await as(NICO, `select path from public.v_location_paths where name='Vorratsschrank'`);
ok('location path renders the hierarchy', r.rows[0].path === 'Küche › Vorratsschrank', r.rows[0].path);

section('todos');
r = await as(NICO, `insert into public.todos (household_id, title, created_by)
                    values ('${HH}','Milch kaufen','${NICO}') returning id, is_done, done_at`);
const TODO = r.rows[0].id;
ok('new todo is open with no done_at', r.rows[0].is_done === false && r.rows[0].done_at === null);
r = await as(WIFE, `update public.todos set is_done = true where id='${TODO}' returning done_at, done_by`);
ok('checking off stamps done_at/done_by automatically',
   r.rows[0].done_at !== null && r.rows[0].done_by === WIFE, JSON.stringify(r.rows[0]));
r = await as(WIFE, `update public.todos set is_done = false where id='${TODO}' returning done_at, done_by`);
ok('unchecking clears them again', r.rows[0].done_at === null && r.rows[0].done_by === null);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

