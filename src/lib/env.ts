/**
 * Environment access with a loud, early failure.
 *
 * A missing EXPO_PUBLIC_SUPABASE_URL otherwise surfaces as an opaque network
 * error somewhere deep in a query, which is a miserable way to learn you forgot
 * to copy .env.example.
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

export const env = {
  supabaseUrl: required('EXPO_PUBLIC_SUPABASE_URL', process.env.EXPO_PUBLIC_SUPABASE_URL),
  supabaseAnonKey: required('EXPO_PUBLIC_SUPABASE_ANON_KEY', process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY),
  /** Optional: push notifications are simply disabled without it. */
  easProjectId: process.env.EXPO_PUBLIC_EAS_PROJECT_ID,

  // The two household members — names, addresses and passwords alike — live in
  // `credentials.ts`, which exists in a native and a web variant. They cannot
  // be read here: `EXPO_PUBLIC_*` is inlined into whatever bundle references
  // it, so anything this file touches ends up in the web build, and the web
  // build is a public URL.
};
