/**
 * Whatever landed in a catch block, as a sentence a person can read.
 *
 * The case this exists for is PostgrestError. supabase-js does not reject with
 * an `Error` — it hands back a plain object `{ message, details, hint, code }`
 * — so the `err instanceof Error ? err.message : String(err)` that every call
 * site used to write rendered every single database failure as the string
 * "[object Object]". A missing column and a violated constraint looked
 * identical, and neither told you anything.
 *
 * `code` is kept because it is the part that is actually diagnosable: 42P01 is
 * "that table does not exist" (usually: migrations not pushed yet), 23505 is a
 * unique violation, 42501 is RLS saying no.
 */
export function errorMessage(error: unknown): string {
  if (error === null || error === undefined) return 'Unbekannter Fehler.';
  if (typeof error === 'string') return error;
  if (error instanceof Error) return error.message;

  if (typeof error === 'object') {
    const { message, details, hint, code } = error as Record<string, unknown>;
    const parts = [message, details, hint].filter(
      (part): part is string => typeof part === 'string' && part.trim().length > 0,
    );

    if (parts.length > 0) {
      const suffix = typeof code === 'string' && code ? ` (${code})` : '';
      return `${[...new Set(parts)].join(' — ')}${suffix}`;
    }
  }

  return String(error);
}
