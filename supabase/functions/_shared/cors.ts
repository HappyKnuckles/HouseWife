/**
 * CORS for the browser-callable functions.
 *
 * Only needed because the app also runs on web (`npx expo start --web`). A
 * native build issues a plain POST with no preflight, so this never mattered
 * until the first browser call — which then fails at the *preflight*, before
 * any of the function's own logic runs, with a message that says nothing about
 * the function itself.
 *
 * `*` for the origin is deliberate and safe here: every one of these functions
 * still resolves the caller's JWT and returns 401 without a valid one, so the
 * header grants no access on its own. It also has to be `*` in practice — the
 * dev server's origin is whatever port Metro picked, and a shipped build has
 * no fixed origin at all.
 *
 * `apikey` and `x-client-info` are in the allow-list because supabase-js sends
 * both on every functions.invoke() call; omitting either fails the preflight
 * even though the request itself would have been fine.
 */
export const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Max-Age': '86400',
};

/**
 * Answers the preflight. Returns null for every other method, so the caller
 * reads as: `const pre = handlePreflight(req); if (pre) return pre;`
 *
 * 204 rather than 200: a preflight response has no body, and some proxies are
 * fussy about a 200 that carries none.
 */
export function handlePreflight(req: Request): Response | null {
  if (req.method !== 'OPTIONS') return null;
  return new Response(null, { status: 204, headers: corsHeaders });
}

/** JSON response helper that always carries the CORS headers. */
export function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}
