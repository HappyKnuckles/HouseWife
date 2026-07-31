// Picks which pair of users the app signs in as: copies env-profiles/<profile>.env
// over .env.local, which Expo always merges on top of .env — for `expo start`,
// `eas build` (local or cloud) and `expo export` alike. Deliberately NOT done via
// NODE_ENV / .env.development /.env.production: Expo's own docs warn that
// `expo export`, `eas build` and `eas update` all force NODE_ENV=production
// regardless of build profile, which would silently load the wrong file for a
// "development" EAS build. Overwriting .env.local by hand sidesteps that.
//
// Usage: node scripts/switch-env.mjs dev|prod

import { copyFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const profile = process.argv[2];

if (profile !== 'dev' && profile !== 'prod') {
  console.error('Usage: node scripts/switch-env.mjs <dev|prod>');
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
console.log(`Active profile: ${profile} (.env.local now mirrors env-profiles/${profile}.env)`);
console.log('Restart Metro for this to take effect: npx expo start --clear');
