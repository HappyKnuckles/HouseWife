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

  /**
   * The two fixed household members — which two depends on which env-profile
   * is active (npm run env:dev / env:prod, see .env.example), provisioned
   * once via supabase/scripts/create-users.mjs. There is no sign-up screen —
   * the sign-in screen is just a "who are you" picker between these two.
   */
  userA: {
    name: process.env.EXPO_PUBLIC_USER_A_NAME || 'Ich',
    email: required('EXPO_PUBLIC_USER_A_EMAIL', process.env.EXPO_PUBLIC_USER_A_EMAIL),
    password: required('EXPO_PUBLIC_USER_A_PASSWORD', process.env.EXPO_PUBLIC_USER_A_PASSWORD),
  },
  userB: {
    name: process.env.EXPO_PUBLIC_USER_B_NAME || 'Partner:in',
    email: required('EXPO_PUBLIC_USER_B_EMAIL', process.env.EXPO_PUBLIC_USER_B_EMAIL),
    password: required('EXPO_PUBLIC_USER_B_PASSWORD', process.env.EXPO_PUBLIC_USER_B_PASSWORD),
  },
};
