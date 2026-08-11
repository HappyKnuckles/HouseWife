/**
 * The web half of the split described in `credentials.ts` — deliberately
 * empty.
 *
 * Nothing here reads `EXPO_PUBLIC_USER_*`, which is the entire point: Metro
 * only inlines what a bundle references, so the web build ends up with no
 * address and no password in it to find. The sign-in screen sees
 * `hasEmbeddedPasswords` false and renders a plain login form instead of a
 * picker.
 *
 * Resist the temptation to "just add the names back" for a nicer screen. The
 * names come with the addresses, and an address on a public URL is half of
 * every guess.
 */

export interface Person {
  name: string;
  email: string;
  password: string;
}

export const hasEmbeddedPasswords = false;

export const people: Person[] = [];
