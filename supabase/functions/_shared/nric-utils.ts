// supabase/functions/_shared/nric-utils.ts

/**
 * Canonical form of an NRIC / MyKad number for format-agnostic comparison.
 *
 * Registration stores NRIC exactly as typed, so the same person may appear as
 * "810315-14-5701", "810315145701", or even "931231 -12-5173" (stray space).
 * Strip every non-alphanumeric character and upper-case so all of those reduce
 * to one value. Upper-casing also keeps Singaporean NRICs (e.g. "S1234567A")
 * stable regardless of letter case.
 */
export function normalizeNric(nric?: string | null): string {
  return (nric || '').replace(/[^a-zA-Z0-9]/g, '').toUpperCase();
}

/**
 * Compare two NRICs by their canonical form, so a checkout identifier matches
 * the stored registration regardless of dashes, spaces, or letter case. Mirrors
 * phonesMatch() in phone-utils.ts. Empty/blank values never match.
 */
export function nricsMatch(a?: string | null, b?: string | null): boolean {
  const na = normalizeNric(a);
  return na.length > 0 && na === normalizeNric(b);
}
