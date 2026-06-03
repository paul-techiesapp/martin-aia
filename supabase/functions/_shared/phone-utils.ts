// supabase/functions/_shared/phone-utils.ts

/**
 * Normalize phone number for OneWaySMS API.
 * Strips +, -, spaces. API requires digits only (e.g., 6591234567).
 */
export function normalizePhone(phone: string): string {
  return phone.replace(/[+\-\s]/g, '');
}

/**
 * Canonical digits-only MSISDN for a Malaysian number (e.g., "60123456789").
 *
 * Accepts any of the formats the frontend or legacy data may hold — local
 * digits ("0123456789"), local without the trunk zero ("123456789"), or a
 * full number with the +60 country code — and always returns the same form.
 */
export function toMalaysianMsisdn(phone: string): string {
  let digits = (phone || '').replace(/\D/g, '');
  if (digits.startsWith('60')) return digits;
  digits = digits.replace(/^0+/, '');
  return digits ? `60${digits}` : '';
}

/**
 * Compare two phone numbers by their canonical Malaysian MSISDN, so that a
 * checkout identifier matches the stored registration regardless of how either
 * was formatted (+60 prefix, trunk zero, spaces, dashes).
 */
export function phonesMatch(a?: string | null, b?: string | null): boolean {
  if (!a || !b) return false;
  return toMalaysianMsisdn(a) === toMalaysianMsisdn(b);
}

/**
 * Mask phone number for display (e.g., "+65 •••• 1234").
 */
export function maskPhone(phone: string): string {
  const cleaned = phone.replace(/[^0-9]/g, '');
  if (cleaned.length < 4) return '••••';
  const countryCode = cleaned.length > 8 ? cleaned.slice(0, cleaned.length - 8) : '';
  const lastFour = cleaned.slice(-4);
  return countryCode ? `+${countryCode} •••• ${lastFour}` : `•••• ${lastFour}`;
}
