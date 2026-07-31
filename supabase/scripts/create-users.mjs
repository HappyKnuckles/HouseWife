// One-time provisioning for whichever pair of accounts is currently active
// (see env-profiles/dev.env.example and env-profiles/prod.env.example — pick
// one with `npm run env:dev` / `npm run env:prod` before running this). The
// sign-in screen only ever calls signInWithPassword — there is no
// self-service sign-up — so something has to create the accounts first. This
// is that something. Same Supabase project either way; dev gets its own
// household ("Testhaushalt" by default), fully isolated by RLS from the real
// one, never the same rows.
//
// Uses the Admin API (auth.admin.createUser with email_confirm: true) rather
// than hand-writing SQL against auth.users: the Admin API is stable across
// Supabase versions, and email_confirm: true skips confirmation regardless of
// the project's "Confirm email" setting, which matters because a made-up
// address like a@haushalt.local can never receive a real confirmation mail.
//
// After creating the accounts, it signs in as each one and drives the exact
// same RPCs onboarding.tsx uses (create_household / create_invite /
// accept_invite), so the result is indistinguishable from two people signing
// up by hand. Safe to re-run — every step checks for existing state first.
//
// Needs the service_role key. That must never live in .env or .env.local (it
// is bundled into the app otherwise), so pass it as a one-off shell variable
// instead:
//
//   PowerShell:  $env:SUPABASE_SERVICE_ROLE_KEY = "..."
//                node --env-file=.env --env-file=.env.local supabase/scripts/create-users.mjs
//   bash:        SUPABASE_SERVICE_ROLE_KEY=... node --env-file=.env --env-file=.env.local supabase/scripts/create-users.mjs
//
// (.env has the shared Supabase URL/anon key; .env.local — written by
// switch-env.mjs — has the active profile's HOUSEHOLD_NAME and user pair.
// Needs Node 20.6+ for --env-file; later files override earlier ones.)

import { createClient } from '@supabase/supabase-js';

function need(name) {
  const value = process.env[name];
  if (!value) {
    console.error(`Missing ${name}. See the comment at the top of this script.`);
    process.exit(1);
  }
  return value;
}

const url = need('EXPO_PUBLIC_SUPABASE_URL');
const anonKey = need('EXPO_PUBLIC_SUPABASE_ANON_KEY');
const serviceKey = need('SUPABASE_SERVICE_ROLE_KEY');
const householdName = process.env.HOUSEHOLD_NAME || 'Zuhause';

const users = [
  {
    email: need('EXPO_PUBLIC_USER_A_EMAIL'),
    password: need('EXPO_PUBLIC_USER_A_PASSWORD'),
    name: process.env.EXPO_PUBLIC_USER_A_NAME || 'Ich',
  },
  {
    email: need('EXPO_PUBLIC_USER_B_EMAIL'),
    password: need('EXPO_PUBLIC_USER_B_PASSWORD'),
    name: process.env.EXPO_PUBLIC_USER_B_NAME || 'Partner:in',
  },
];

const admin = createClient(url, serviceKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

for (const u of users) {
  const { error } = await admin.auth.admin.createUser({
    email: u.email,
    password: u.password,
    email_confirm: true,
    user_metadata: { display_name: u.name },
  });

  if (error && !/already.*registered/i.test(error.message)) {
    throw error;
  }
  console.log(`${error ? 'Already exists' : 'Created'}: ${u.email}`);
}

const clientA = createClient(url, anonKey);
const { error: signInAErr } = await clientA.auth.signInWithPassword(users[0]);
if (signInAErr) throw signInAErr;

const {
  data: { user: userA },
} = await clientA.auth.getUser();
const { data: profileA, error: profileAErr } = await clientA
  .from('profiles')
  .select('household_id')
  .eq('id', userA.id)
  .single();
if (profileAErr) throw profileAErr;

if (profileA.household_id) {
  console.log('Household already set up for both users — nothing more to do.');
  process.exit(0);
}

const { error: createHouseholdErr } = await clientA.rpc('create_household', {
  p_name: 'Testhaushalt',
});
if (createHouseholdErr) throw createHouseholdErr;

const { data: code, error: inviteErr } = await clientA.rpc('create_invite');
if (inviteErr) throw inviteErr;

const clientB = createClient(url, anonKey);
const { error: signInBErr } = await clientB.auth.signInWithPassword(users[1]);
if (signInBErr) throw signInBErr;

const { error: acceptErr } = await clientB.rpc('accept_invite', { p_code: code });
if (acceptErr) throw acceptErr;

console.log('Household "Testhaushalt" created for both users, with the default Putzplan seeded.');
