import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2';

/**
 * Service-role client for Edge Functions.
 *
 * The service role bypasses RLS, which is exactly right here: household-tick
 * has to read every household's tasks in order to remind anyone at all. The
 * key never leaves the server — it is injected by the Supabase runtime.
 *
 * Every call made through this client goes out over PostgREST, which is also
 * what makes it count as project API activity for the keep-alive.
 */
export function serviceClient(): SupabaseClient {
  const url = Deno.env.get('SUPABASE_URL');
  const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

  if (!url || !key) {
    throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set');
  }

  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

/**
 * Shared secret check for functions deployed with --no-verify-jwt.
 *
 * The cron job cannot present a user JWT, so JWT verification is turned off and
 * replaced with this. Returns a Response when the caller should be rejected.
 */
export function rejectUnauthorized(req: Request): Response | null {
  const expected = Deno.env.get('CRON_SECRET');

  if (!expected) {
    return new Response(
      JSON.stringify({ error: 'CRON_SECRET is not configured on this project' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } },
    );
  }

  if (req.headers.get('x-cron-secret') !== expected) {
    return new Response(JSON.stringify({ error: 'unauthorized' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  return null;
}
