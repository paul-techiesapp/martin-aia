// supabase/functions/_shared/phone-utils.ts

/**
 * Normalize phone number for OneWaySMS API.
 * Strips +, -, spaces. API requires digits only (e.g., 6591234567).
 */
export function normalizePhone(phone: string): string {
  return phone.replace(/[+\-\s]/g, '');
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
