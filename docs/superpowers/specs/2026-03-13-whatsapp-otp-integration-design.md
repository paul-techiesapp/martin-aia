# WhatsApp OTP Integration via OneWaySMS API

**Date:** 2026-03-13
**Status:** Draft
**Builds on:** [Shareable Links & Registration Redesign](2026-03-11-shareable-links-redesign.md) (Approved)

## Overview

Integrate WhatsApp OTP delivery via the OneWaySMS WBA API into the check-out flow as part of the full shareable links redesign. This replaces PIN-based checkout with a proper OTP system — fresh 6-digit codes generated on demand, delivered via WhatsApp, with 5-minute expiry.

### Parent Spec Supersessions

This spec supersedes or modifies the following items from the [parent spec](2026-03-11-shareable-links-redesign.md):

| Parent Spec Item | Change |
|------------------|--------|
| `whatsapp_send_log` table retained (migration step 10) | **Dropped.** Rate limiting uses `otp_codes.created_at` directly. Migration step 10 is removed. |
| Edge Function named `send-whatsapp-otp` | **Renamed** to `send-checkout-otp` (canonical name) |
| Edge Function named `verify-otp` | **Renamed** to `verify-checkout-otp` (canonical name) |
| `otp_codes` includes `updated_at` column | **Removed.** OTP records are write-once (insert → mark used). No updates needed. |
| Migration step 3: Create `otp_codes` before `invitations` rename | **Reordered.** `otp_codes` creation moves to after `registrations` rename (FK dependency on `registrations`). |

## Decisions Made

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Integration scope | Full redesign (not standalone) | OTP is part of the shareable links migration |
| OTP logic location | Edge Functions handle everything | Simplest approach, follows existing pattern |
| Credential storage | Supabase Edge Function secrets | Existing env var pattern |
| Phone normalization | At send time only | Less disruptive, users enter naturally |
| Rate limiting | 3 per phone per slot per hour + 60s cooldown | Prevents spam, protects API credits |
| Previous OTP handling | Invalidate on new request | Only latest code works, standard pattern |
| Check-in identifier | Either NRIC or Phone | Flexible, user picks what they remember |

## OneWaySMS WBA API Integration

### API Details

| Property | Value |
|----------|-------|
| Provider | OneWaySMS WhatsApp Business API |
| Send URL | `https://wba-api.onewaysms.com/api.aspx` |
| Transaction Status URL | `https://wba-api.onewaysms.com/apichecktransaction.aspx` |
| Check Balance URL | `https://wba-api.onewaysms.com/apicheckbalance.aspx` |
| Template ID | 2374 |
| Template Name | `otp_checkout` |
| Template Message | `{{1}} is your verification code. For your security, do not share this code. This code expires in 5 minutes.` |
| Template Type | Authentication (OTP) |

### API Call Format

```
GET https://wba-api.onewaysms.com/api.aspx
  ?apiusername={ONEWAYSMS_API_USERNAME}
  &apipassword={ONEWAYSMS_API_PASSWORD}
  &mobile={normalizedPhone}
  &message=*T2374|{otpCode}
```

**Phone normalization:** Strip `+`, `-`, spaces at send time. Database stores original format.
- `+65 9123-4567` → `6591234567`
- `+6591234567` → `6591234567`

### Response Handling

| Body Value | Meaning | Action |
|------------|---------|--------|
| > 0 | Success (MT ID) | Log MT ID, return success |
| -1 | Invalid credentials | Log alert, return 502 |
| -2 | Empty mobile number | Log error, return 400 |
| -3 | Empty message | Log error, return 500 |
| -4 | Invalid flow (24h window) | Log, return 502 |
| -5 | Invalid template | Log alert, return 500 |
| -6 | Template param mismatch | Log alert, return 500 |
| -7 | IP not whitelisted | Log alert, return 502 |

### Environment Variables (Edge Function Secrets)

```
ONEWAYSMS_API_USERNAME=<set-in-supabase-secrets>
ONEWAYSMS_API_PASSWORD=<set-in-supabase-secrets>
ONEWAYSMS_TEMPLATE_ID=2374
WHATSAPP_PROVIDER=onewaysms
```

> **Note:** Real credentials must only be stored in Supabase Edge Function secrets and Render environment variables, never in committed files.

`WHATSAPP_PROVIDER` controls provider selection:
- `onewaysms` → real API calls
- `mock` or unset → console logging (local dev)

## Database Schema

### New table: `otp_codes`

```sql
CREATE TABLE otp_codes (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  registration_id uuid NOT NULL REFERENCES registrations(id) ON DELETE CASCADE,
  slot_id         uuid NOT NULL REFERENCES slots(id) ON DELETE CASCADE,
  phone           text NOT NULL,
  code            text NOT NULL,
  expires_at      timestamptz NOT NULL,
  is_used         boolean NOT NULL DEFAULT false,
  created_at      timestamptz NOT NULL DEFAULT now()
);

-- For OTP verification lookup (includes expires_at for index-only scan)
CREATE INDEX idx_otp_codes_verification
  ON otp_codes(registration_id, code, is_used, expires_at);

-- For rate limiting queries
CREATE INDEX idx_otp_codes_rate_limit
  ON otp_codes(phone, slot_id, created_at);
```

**RLS:** No direct public access. All operations go through Edge Functions using the service role key.

### Removed table: `whatsapp_send_log`

Rate limiting now queries `otp_codes.created_at` directly. The `whatsapp_send_log` table is no longer needed.

### Other schema changes

All other schema changes (agent_links, invitations → registrations, attendance modifications, pin_codes removal) are defined in the [shareable links redesign spec](2026-03-11-shareable-links-redesign.md) and remain unchanged.

## Edge Functions

### `send-checkout-otp` (replaces `send-whatsapp-pin`)

**Endpoint:** `POST /functions/v1/send-checkout-otp`
**Input:**
```json
{
  "slot_id": "uuid",
  "identifier": "string"  // NRIC or phone number
}
```

**Flow:**

1. **Look up registration** by `slot_id` + identifier
   - Try NRIC match first: `WHERE slot_id = $1 AND invitee_nric = $2`
   - If no match, try phone: `WHERE slot_id = $1 AND invitee_phone = $2`
2. **Validate status:** Registration must be `'attended'` (already checked in)
3. **Validate attendance:** Must have `checkout_time IS NULL` (not yet checked out)
4. **Rate limit check:** `SELECT COUNT(*) FROM otp_codes WHERE phone = $1 AND slot_id = $2 AND created_at > NOW() - INTERVAL '1 hour'`. If >= 3, reject with 429.
5. **Cooldown check:** `SELECT created_at FROM otp_codes WHERE phone = $1 AND slot_id = $2 ORDER BY created_at DESC LIMIT 1`. If `created_at > NOW() - INTERVAL '60 seconds'`, reject with 429 and `retry_after` seconds.
6. **Invalidate previous OTPs:** `UPDATE otp_codes SET expires_at = NOW() WHERE registration_id = $1 AND is_used = false AND expires_at > NOW()`
7. **Generate OTP:** 6 cryptographically random digits
8. **Insert OTP record:** `INSERT INTO otp_codes (registration_id, slot_id, phone, code, expires_at) VALUES ($1, $2, $3, $4, NOW() + INTERVAL '5 minutes')`

> **Note on transaction boundaries:** Steps 6-8 are NOT wrapped in a DB transaction because step 10 is an external network call. There is a brief window (milliseconds) between step 6 (invalidation) and step 8 (insert) where no valid OTP exists. This is acceptable — a concurrent verify during this window returns "invalid OTP" and the user retries. Do NOT hold a DB transaction open across the API call.

9. **Normalize phone:** Strip `+`, `-`, spaces from registration's `invitee_phone`
10. **Call OneWaySMS API:** `GET` with template message `*T2374|{code}`
11. **Check response:** HTTP 200 + body > 0 = success
12. **On send failure:** Delete the OTP record inserted at step 8 so it does not count against the rate limit. Return 502 with provider error code.
13. **Return:**
```json
{
  "success": true,
  "masked_phone": "+65 •••• 1234"
}
```

**Error responses:**

| Condition | HTTP Status | Error |
|-----------|------------|-------|
| Registration not found | 404 | `registration_not_found` |
| Not checked in | 400 | `not_checked_in` |
| Already checked out | 400 | `already_checked_out` |
| Rate limit exceeded | 429 | `rate_limit_exceeded` |
| Cooldown active | 429 | `cooldown_active` (+ `retry_after` seconds) |
| WhatsApp send failed | 502 | `whatsapp_send_failed` (+ provider error code) |

### `verify-checkout-otp` (new)

**Endpoint:** `POST /functions/v1/verify-checkout-otp`
**Input:**
```json
{
  "slot_id": "uuid",
  "identifier": "string",
  "code": "string"
}
```

**Flow:**

1. **Look up registration** by `slot_id` + identifier (same logic as send)
2. **Validate status:** Registration must be `'attended'`. If not → 400 `not_checked_in`
3. **Validate not already checked out:** `SELECT checkout_time FROM attendance WHERE registration_id = $1`. If no row found → 400 `not_checked_in`. If `checkout_time IS NOT NULL` → 400 `already_checked_out`
4. **Find valid OTP with row lock:** `SELECT * FROM otp_codes WHERE registration_id = $1 AND code = $2 AND is_used = false AND expires_at > NOW() FOR UPDATE`
5. **Not found** → 400 "Invalid or expired OTP"
6. **Atomic checkout (in a single transaction):**
   - **Mark OTP as used:** `UPDATE otp_codes SET is_used = true WHERE id = $1`
   - **Update attendance:** `UPDATE attendance SET checkout_time = NOW(), is_full_attendance = true WHERE registration_id = $1`
   - **Update registration status:** `UPDATE registrations SET status = 'completed' WHERE id = $1`
7. **Return:**
```json
{
  "success": true
}
```

**Error responses:**

| Condition | HTTP Status | Error |
|-----------|------------|-------|
| Registration not found | 404 | `registration_not_found` |
| Invalid or expired OTP | 400 | `invalid_otp` |
| Not checked in | 400 | `not_checked_in` |
| Already checked out | 400 | `already_checked_out` |

### Unchanged Edge Functions

- `verify-qr-token` — works as-is (slot_id based)
- `generate-qr-token` — works as-is

### Removed Edge Function

- `send-whatsapp-pin` — replaced by `send-checkout-otp`

### WhatsApp Service Layer

Replace existing `whatsapp-service.ts` with a new shared utility for `send-checkout-otp`. The current implementation targets a different API endpoint (`gateway.onewaysms.com` SMS gateway with JSON POST) and is incompatible with the WBA WhatsApp API (`wba-api.onewaysms.com` with GET query parameters):

```typescript
// Shared: supabase/functions/_shared/whatsapp-service.ts

interface SendResult {
  success: boolean;
  mt_id?: string;       // OneWaySMS transaction ID (body > 0)
  error_code?: number;  // Negative error code
  error_message?: string;
}

// MockWhatsAppService — logs to console (local dev)
// OneWaySmsService — calls WBA API with template format

function createWhatsAppService(): WhatsAppService {
  // WHATSAPP_PROVIDER env var: 'onewaysms' | 'mock'
}

function normalizePhone(phone: string): string {
  // Strip +, -, spaces → '6591234567'
}
```

## Public Pages UI

### Check-in Page (`CheckIn.tsx` — rewrite)

**Route:** `/checkin?slot={id}&ts={ts}&sig={sig}`

**Flow:**
1. Verify QR token (existing `verify-qr-token` call)
2. Show identifier form: toggle between NRIC / Phone input
3. On submit: look up registration by `slot_id` + identifier → create attendance record
4. Success screen with attendee name confirmation

**Key changes from current:**
- No PIN field
- Toggle selector: "Identify by NRIC" / "Identify by Phone"
- No legacy PIN-only fallback

### Check-out Page (`CheckOut.tsx` — rewrite)

**Route:** `/checkout?slot={id}&ts={ts}&sig={sig}`

**Step 1: Identify**
1. Verify QR token
2. Show identifier form (same toggle as check-in)
3. On submit: call `send-checkout-otp`
4. Receive masked phone → transition to Step 2

**Step 2: Verify OTP**
1. Display: "OTP sent to +65 •••• 1234"
2. 6-digit OTP input field (numeric, auto-focus)
3. 5-minute countdown timer showing remaining time
4. "Resend OTP" button:
   - Disabled for 60 seconds after send (shows countdown)
   - Max 3 resends total (tracked client-side, enforced server-side)
   - On click: calls `send-checkout-otp` again
5. On submit: call `verify-checkout-otp`
6. Success screen with checkout confirmation

**Error handling:**
- Invalid/expired OTP → inline error message, allow retry
- Rate limit exceeded → "Too many attempts, please try again later"
- Cooldown active → "Resend" button stays disabled with second countdown
- Already checked out → show "Already checked out" with success styling

### Registration Page (`Register.tsx` — rewrite)

- Look up by `link_code` from `agent_links` (not `unique_token`)
- Same form fields: name, NRIC, phone, email, occupation
- Calls `register_attendee` RPC for atomic registration with capacity check
- Per-slot uniqueness (same person can register for different slots)

### Display Page (`Display.tsx` — minimal changes)

- No changes to rotating QR logic
- Phase detection and QR generation work as-is

## Migration Strategy

### Deployment Order

This is a breaking change requiring coordinated deployment:

1. **Maintenance mode** — brief window
2. **Database migration** — single migration file, ordered (FK-dependency aware):
   a. Create `registration_status` enum
   b. Create `agent_links` table
   c. Modify `attendance`: drop `pin_code_id` column and FK
   d. Rename `invitations` → `registrations` with schema changes (must happen before `otp_codes` and attendance FK update)
   e. Create `otp_codes` table (depends on `registrations` existing for FK)
   f. Modify `attendance`: rename `invitation_id` → `registration_id`, update FK
   g. Drop `pin_codes` table
   h. Drop `whatsapp_send_log` table (superseded by `otp_codes` for rate limiting)
   i. Rename `campaigns.invitation_type` → `registration_type`
   j. Drop old `invitation_status` enum
   k. Create RLS policies for new/modified tables
   l. Create `register_attendee` RPC function
   m. Rewrite `deactivate_partner_and_release` RPC
3. **Deploy Edge Functions**
   a. Deploy `send-checkout-otp` and `verify-checkout-otp`
   b. Set secrets: `ONEWAYSMS_API_USERNAME`, `ONEWAYSMS_API_PASSWORD`, `ONEWAYSMS_TEMPLATE_ID`, `WHATSAPP_PROVIDER=onewaysms`
   c. Remove `send-whatsapp-pin`
4. **Deploy frontends** — all three portals
5. **Verify** with test accounts
6. **Remove maintenance mode**

### Data Migration

- Existing `invitations` with status `'registered'` or `'attended'` → migrate to `registrations`
- Existing `attendance` records → update FK references
- `pin_codes` data can be dropped (no migration needed)
- `whatsapp_send_log` data can be dropped

## Testing Strategy

### Local Development

- `WHATSAPP_PROVIDER=mock` — OTP logged to console
- Test full flow: register → check-in → request OTP → verify OTP → check-out

### Pre-Production Verification

1. Verify OneWaySMS API connectivity with test phone number
2. Verify template `2374` sends correctly with OTP parameter
3. Verify rate limiting (3 sends per hour, 60s cooldown)
4. Verify OTP expiry (code invalid after 5 minutes)
5. Verify previous OTP invalidation on new request
6. Verify phone normalization handles various input formats

### Edge Cases

- User requests OTP, doesn't use it, requests again → previous invalidated, new one works
- User enters expired OTP → clear error message
- User hits rate limit → clear message with guidance
- WhatsApp delivery fails → 502 with actionable error
- User enters NRIC at check-in, phone at check-out → both work (lookup by either)
