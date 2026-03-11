# Feature: WhatsApp PIN Verification (Checkout Only)

**Date:** 2026-03-11
**Status:** Approved
**Scope:** Edge Function + public-pages checkout page

## Overview

Replace the current single-step checkout (PIN + NRIC together) with a 2-step flow where the attendee enters their NRIC first, then receives their PIN via WhatsApp to their registered phone number. This verifies the person checking out is the actual attendee. Check-in flow remains unchanged.

## Requirements

- Checkout becomes a 2-step process: NRIC entry → PIN delivery via WhatsApp → PIN entry
- PIN sent to the phone number the attendee registered with (stored in `invitee_phone` on invitations table)
- WhatsApp delivery via OneWaySMS API (credentials to be provided by client later)
- Abstracted service layer with mock sender for development/testing
- Resend capability with rate limiting (max 3 sends per checkout attempt)
- Check-in flow is NOT changed

## Design

### Prerequisite: Check-in Must Happen First

The attendee must have already checked in before they can check out. The user journey is:

1. **Check-in** (unchanged): Scan check-in QR → enter PIN + NRIC → status set to `ATTENDED`, PIN linked to NRIC
2. **Event happens**
3. **Check-out** (this feature): Scan check-out QR → 2-step WhatsApp flow below

This means at checkout time, the invitation status is always `ATTENDED` and the PIN is already linked to the NRIC.

### Checkout Flow Change

**Current flow:**
```
Scan QR → Enter PIN + NRIC → Checkout complete
```

**New flow:**
```
Scan QR → Step 1: Enter NRIC → System sends PIN via WhatsApp → Step 2: Enter PIN → Checkout complete
```

### Step 1: NRIC Entry

- Attendee scans checkout QR code, lands on checkout page
- Enters NRIC only (no PIN field visible yet)
- Clicks "Send PIN to WhatsApp"
- System calls `send-whatsapp-pin` Edge Function:
  1. Looks up invitation by NRIC + slot_id (status must be `ATTENDED`)
  2. Finds linked PIN code from `pin_codes` table (where `linked_nric` matches)
  3. Finds registered phone number from `invitee_phone` on invitations table
  4. Sends PIN via WhatsApp to that phone number
  5. Returns masked phone number for UI confirmation (`+65 •••• 4567`)
- On success: transitions to Step 2
- On failure: shows error (e.g., "No check-in record found for this NRIC")

### Step 2: PIN Entry

- Shows "PIN sent to WhatsApp" confirmation with masked phone number
- Attendee enters the 6-digit PIN they received
- Clicks "Complete Check Out"
- Existing checkout validation logic runs: PIN matches linked NRIC, attendance record exists, not already checked out
- On success: updates attendance with `checkout_time`, sets `is_full_attendance = true`, updates invitation status to `COMPLETED`
- Resend button available (rate limited to 3 sends per NRIC per slot)

### Edge Function: `send-whatsapp-pin`

**Input:**
```typescript
{ slot_id: string, nric: string }
```

**Process:**
1. Query `invitations` where `invitee_nric = nric` and slot's campaign matches, status = `ATTENDED`
2. Query `pin_codes` where `linked_nric = nric` and `slot_id` matches
3. Get `invitee_phone` from the invitation record
4. Send WhatsApp message: "Your checkout PIN is: {pin_code}. Enter this on the checkout page to complete your check-out."
5. Return `{ success: true, masked_phone: "+65 •••• 4567" }`

**Error cases:**
- NRIC not found / not checked in → 404 "No check-in record found"
- No linked PIN → 404 "No PIN linked to this NRIC"
- Rate limit exceeded → 429 "Too many attempts, please wait"
- WhatsApp send failure → 500 "Failed to send, please try again"

**Rate limiting:** Uses `whatsapp_send_log` table (Edge Functions are stateless, so in-memory tracking won't work across invocations).

Algorithm: On each send request, query `whatsapp_send_log` for count of records where `slot_id = X` AND `nric = Y` AND `sent_at > now() - interval '1 hour'`. If count >= 3, return 429. Otherwise, insert a new log record and proceed with send.

**Idempotency:** Multiple sends for the same NRIC + slot always resend the same PIN (the one linked to that NRIC at check-in). No new PIN is generated.

**Phone validation:** Before sending, validate that `invitee_phone` is present and non-empty. If missing, return error "No phone number registered". Phone masking shows last 4 digits regardless of format.

### Service Layer Architecture

Abstracted WhatsApp service to allow easy provider swapping:

```typescript
interface WhatsAppService {
  sendMessage(phone: string, message: string): Promise<{ success: boolean }>;
}

class MockWhatsAppService implements WhatsAppService {
  // Logs to console — used until OneWaySMS credentials arrive
}

class OneWaySmsService implements WhatsAppService {
  // Actual OneWaySMS API integration — implemented when credentials provided
}
```

Service selection via environment variable: `WHATSAPP_PROVIDER=mock|onewaysms` (defaults to `mock` until credentials arrive)

Additional env vars for OneWaySMS (configured later):
- `ONEWAYSMS_API_KEY`
- `ONEWAYSMS_API_SECRET`
- `ONEWAYSMS_SENDER_ID` (if required)

### UI Design

**Step 1 (NRIC entry):**
- Step indicator (1 of 2) at top
- Single NRIC input field
- Explanatory text: "Your PIN code will be sent to the WhatsApp number you registered with."
- "Send PIN to WhatsApp" button

**Step 2 (PIN entry):**
- Step indicator (2 of 2, step 1 marked complete)
- Green confirmation banner: "PIN sent to WhatsApp" with masked phone number
- 6-digit PIN input field
- "Complete Check Out" button (amber themed, matching checkout color)
- "Resend PIN" secondary button (enabled immediately, shows remaining attempts count, disabled after 3 sends)

## Files Changed

| Area | File | Change |
|------|------|--------|
| **Edge Function** | `supabase/functions/send-whatsapp-pin/index.ts` | New — orchestrates PIN lookup and WhatsApp delivery |
| **Edge Function** | `supabase/functions/send-whatsapp-pin/whatsapp-service.ts` | New — abstracted WhatsApp service interface + mock + OneWaySMS implementations |
| **Database** | `supabase/migrations/YYYYMMDD_whatsapp_send_log.sql` | New — `whatsapp_send_log` table for rate limiting (slot_id, nric, sent_at) |
| **Public Pages** | `apps/public-pages/src/pages/CheckOut.tsx` | Rewrite to 2-step flow with NRIC-first, then PIN entry |
| **Environment** | Supabase Edge Function secrets | `WHATSAPP_PROVIDER`, `ONEWAYSMS_API_KEY`, `ONEWAYSMS_API_SECRET` |

## Out of Scope

- Changes to the check-in flow (remains PIN + NRIC single step)
- WhatsApp delivery for check-in PINs
- SMS fallback if WhatsApp fails
- Actual OneWaySMS integration (stubbed with mock until credentials arrive)
- WhatsApp template message approval (may be needed for production — client responsibility)
- Admin portal UI for monitoring WhatsApp sends
