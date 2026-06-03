// apps/public-pages/src/lib/phone.ts
//
// Malaysian phone helpers.
//
// The system serves Malaysian numbers only, so the +60 country code is fixed
// and never typed by the user. The phone inputs render a static "+60" prefix
// and the user enters just the local part (e.g. "12-345 6789"). On submit we
// canonicalise to E.164 "+60XXXXXXXXX" so that:
//   1. the value stored at registration and the value sent at checkout always
//      match (the OTP lookup compares them), and
//   2. OneWaySMS receives the country code it needs to deliver.

const MY_DIAL_CODE = '60';

/**
 * Canonical E.164 form for a Malaysian number: "+60XXXXXXXXX".
 *
 * Accepts whatever the user typed/pasted — plain local digits ("0123456789"),
 * local without the trunk zero ("123456789"), or a full number with the
 * country code ("+60 12-345 6789") — and always returns the same canonical form.
 * Returns "" for empty input.
 */
export function toMalaysianE164(local: string): string {
  let digits = (local || '').replace(/\D/g, '');
  // Strip a pasted "60" country code first...
  if (digits.startsWith(MY_DIAL_CODE)) {
    digits = digits.slice(MY_DIAL_CODE.length);
  }
  // ...then any national trunk "0" prefix.
  digits = digits.replace(/^0+/, '');
  return digits ? `+${MY_DIAL_CODE}${digits}` : '';
}
