/**
 * Who the two accounts are, and how to sign in as them — native builds only.
 *
 * This is the whole reason the file is split by platform. Metro inlines every
 * `process.env.EXPO_PUBLIC_*` it can see into the bundle being built, and it
 * does that per *module*, not per code path: a `Platform.OS === 'web'` guard
 * around the read would not have helped, because the string still has to be
 * there for the branch that never runs. So the reads live here, and web
 * resolves `credentials.web.ts` instead — a file that names no account and no
 * password, and therefore cannot leak either.
 *
 * Why the difference is legitimate rather than lazy:
 *
 *   native — this ships inside an .ipa/.apk installed on two phones.
 *            Extractable in principle, the way every client secret is, and the
 *            payoff is the thing that makes the app pleasant: you open it and
 *            you are already in.
 *   web    — this would ship to anyone who loads the URL. So the web build
 *            gets none of it and asks for an address and a password like any
 *            other login, and Supabase decides.
 *
 * The addresses matter as much as the passwords here. Shipping them would hand
 * over half of every guess and turn "log in" into "guess one password for a
 * username you were given".
 *
 * `expo export --platform web` picking the wrong variant is not a subtle bug,
 * so it is worth checking after a change: grep the exported bundle for one of
 * the addresses and expect nothing.
 */

function required(name: string, value: string | undefined): string {
  if (!value) {
    throw new Error(
      `${name} is not set. Copy .env.example to .env and fill it in, ` +
        `then restart the dev server with: npx expo start --clear`,
    );
  }
  return value;
}

export interface Person {
  name: string;
  email: string;
  password: string;
}

/**
 * Whether this build can sign someone in without being told anything — which
 * is what the sign-in screen branches on, rather than checking Platform.OS
 * itself. The capability is the fact that matters there; which platform
 * happens to have it is this file's business.
 */
export const hasEmbeddedPasswords = true;

/**
 * The two fixed household members — which two depends on the active env
 * profile (npm run env:dev / env:prod), provisioned once via
 * supabase/scripts/create-users.mjs. There is no sign-up: on a phone, signing
 * in is picking which of these you are.
 */
export const people: Person[] = [
  {
    name: process.env.EXPO_PUBLIC_USER_A_NAME || 'Ich',
    email: required('EXPO_PUBLIC_USER_A_EMAIL', process.env.EXPO_PUBLIC_USER_A_EMAIL),
    password: required('EXPO_PUBLIC_USER_A_PASSWORD', process.env.EXPO_PUBLIC_USER_A_PASSWORD),
  },
  {
    name: process.env.EXPO_PUBLIC_USER_B_NAME || 'Partner:in',
    email: required('EXPO_PUBLIC_USER_B_EMAIL', process.env.EXPO_PUBLIC_USER_B_EMAIL),
    password: required('EXPO_PUBLIC_USER_B_PASSWORD', process.env.EXPO_PUBLIC_USER_B_PASSWORD),
  },
];
