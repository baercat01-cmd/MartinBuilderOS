/**
 * Extracts a human-readable message from a PostgREST / Supabase error object.
 */
export function formatPostgrestError(error: unknown): string {
  if (!error || typeof error !== 'object') return String(error ?? 'Unknown error');
  const e = error as Record<string, unknown>;
  // PostgREST errors
  if (typeof e.message === 'string' && e.message) return e.message;
  // Supabase client wraps errors differently in some versions
  if (typeof e.error_description === 'string' && e.error_description) return e.error_description;
  if (typeof e.details === 'string' && e.details) return e.details;
  if (typeof e.hint === 'string' && e.hint) return e.hint;
  return 'An unknown error occurred';
}
