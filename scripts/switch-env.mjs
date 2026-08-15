// Picks which pair of users the app signs in as: copies env-profiles/<profile>.env
// over .env.local, which Expo always merges on top of .env — for `expo start`,
// `eas build` (local or cloud) and `expo export` alike. Deliberately NOT done via
// NODE_ENV / .env.development /.env.production: Expo's own docs warn that
// `expo export`, `eas build` and `eas update` all force NODE_ENV=production
// regardless of build profile, which would silently load the wrong file for a
// "development" EAS build. Overwriting .env.local by hand sidesteps that.
//
// `dev` and `prod` differ only in *who signs in* — both point at the same
// Supabase project, isolated by RLS. `local` is the odd one out: it also
// redirects the app at the Docker stack `supabase start` runs, which is the
// only profile where a migration that is not on the real project yet exists.
// Its URL and keys are read from `supabase status` at switch time rather than
// stored in the profile, so they cannot go stale against the container.
//
// Usage: node scripts/switch-env.mjs dev|prod|local

import { execFileSync } from 'node:child_process';
import { appendFileSync, copyFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const PROFILES = ['dev', 'prod', 'local'];
const profile = process.argv[2];

if (!PROFILES.includes(profile)) {
  console.error(`Usage: node scripts/switch-env.mjs <${PROFILES.join('|')}>`);
  process.exit(1);
}

const source = path.join(root, 'env-profiles', `${profile}.env`);
const dest = path.join(root, '.env.local');

if (!existsSync(source)) {
  console.error(
    `${source} does not exist. Copy env-profiles/${profile}.env.example to ` +
      `env-profiles/${profile}.env and fill it in first.`,
  );
  process.exit(1);
}

copyFileSync(source, dest);

if (profile === 'local') {
  // `supabase status -o env` prints KEY="value" lines. The key *names* have
  // changed across CLI releases (ANON_KEY became PUBLISHABLE_KEY, SERVICE_ROLE_KEY
  // became SECRET_KEY when the new API key system landed), so accept either
  // rather than pinning one CLI version.
  let raw;
  try {
    raw = execFileSync('npx', ['supabase', 'status', '-o', 'env'], {
      cwd: root,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      shell: process.platform === 'win32',
    });
  } catch {
    console.error(
      'Could not read `supabase status`. Is the local stack running?\n' +
        '  npm run db:local     # starts it, applies migrations and seeds the users',
    );
    process.exit(1);
  }

  const status = Object.fromEntries(
    raw
      .split('\n')
      .map((line) => line.match(/^([A-Z0-9_]+)="?(.*?)"?$/))
      .filter(Boolean)
      .map((m) => [m[1], m[2]]),
  );

  const url = status.API_URL;
  const anonKey = status.ANON_KEY || status.PUBLISHABLE_KEY;
  const serviceKey = status.SERVICE_ROLE_KEY || status.SECRET_KEY;

  if (!url || !anonKey || !serviceKey) {
    console.error(
      'Could not find API_URL / anon key / service_role key in `supabase status -o env`.\n' +
        `Got: ${Object.keys(status).join(', ') || '(nothing)'}`,
    );
    process.exit(1);
  }

  // Appended, so they win over the same names in .env — Expo merges .env.local
  // on top, and node --env-file applies later files last for the seed script.
  //
  // The service_role key is safe to write here *only* because it is the local
  // container's: it grants nothing beyond 127.0.0.1. Never do this for dev/prod.
  // It has no EXPO_PUBLIC_ prefix either, so Expo does not bundle it.
  appendFileSync(
    dest,
    [
      '',
      '# --- injected by switch-env.mjs from `supabase status` (local stack only) ---',
      `EXPO_PUBLIC_SUPABASE_URL=${url}`,
      `EXPO_PUBLIC_SUPABASE_ANON_KEY=${anonKey}`,
      `SUPABASE_SERVICE_ROLE_KEY=${serviceKey}`,
      '',
    ].join('\n'),
  );

  console.log(`Active profile: local (app pointed at ${url})`);
  console.log(
    'A phone on the same Wi-Fi cannot reach 127.0.0.1 — for a real device, replace\n' +
      'the host in EXPO_PUBLIC_SUPABASE_URL in .env.local with your machine\'s LAN IP.',
  );
} else {
  console.log(`Active profile: ${profile} (.env.local now mirrors env-profiles/${profile}.env)`);
}

console.log('Restart Metro for this to take effect: npx expo start --clear');
