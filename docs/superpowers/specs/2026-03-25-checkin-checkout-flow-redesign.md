# Check-In / Check-Out Flow Redesign

**Date:** 2026-03-25
**Status:** Approved
**Approach:** Minimal Surgery (in-place modifications)

## Overview

Simplify and clarify the attendance cycle: admin-driven check-in via QR scanner, customer self-checkout with dual-identifier OTP verification, manual checkout QR activation.

## Workflow

1. Customer arrives at event with invitation card (PDF or printed) containing QR code
2. Admin/operator scans the invitation card QR using CheckInScanner — customer is checked in
3. Customer participates in the event
4. Admin clicks "Start Checkout" on Venue Display — checkout QR appears on projected screen
5. Customer scans checkout QR, enters NRIC + (email or phone), receives WhatsApp OTP
6. Customer enters OTP — checkout completes atomically
7. Attendance record with `is_full_attendance = true` becomes eligible for commission (processed manually by admin)

## Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Check-in method | Admin scanner only | Removes customer self-check-in complexity; admin controls the gate |
| Checkout identifier | NRIC (required) + email or phone | Dual verification improves identity confidence |
| Checkout QR timing | Manual admin toggle | Avoids complex phase-timing logic; works for any event schedule |
| OTP delivery | Always WhatsApp to registered phone | Consistent channel regardless of which identifier is used |
| Reward creation | Manual admin process | No automatic reward generation on checkout |

## Changes

### 1. Delete: Public CheckIn Page

**File:** `apps/public-pages/src/pages/CheckIn.tsx`
- Delete entirely. Customer self-check-in is replaced by admin-only scanner.

**File:** `apps/public-pages/src/router.tsx`
- Remove `/public/checkin` route definition and `CheckIn` component import.

### 2. Modify: VenueDisplay — Manual Checkout Toggle

**File:** `apps/admin-portal/src/pages/VenueDisplay.tsx`

**Remove:**
- `getPhase()` function and `SlotPhase` type
- `getQrMode()` function
- All phase-based `setInterval` timers (phase transition, countdown)
- Phase-dependent color/label logic

**Add:**
- `isCheckoutActive` boolean state (default: `false`)
- "Start Checkout" button — sets `isCheckoutActive = true`, triggers QR generation
- "Stop Checkout" button — sets `isCheckoutActive = false`, hides QR
- Event info display (campaign name, venue, time) always visible

**Keep:**
- QR signing via `generate-qr-token` edge function with `mode: 'checkout'`
- Static URL fallback (`/public/checkout?slot={slotId}`)
- 60-second QR refresh interval (HMAC token rotation)
- Countdown display while QR is active

### 3. Modify: Checkout Form — Dual Identifier

**File:** `apps/public-pages/src/pages/CheckOut.tsx`

**Step 1 form layout (top to bottom):**
1. NRIC field — always visible, always required (not inside tabs)
2. Tabs: "Email" | "Phone" — selects the second identifier type
3. Second identifier field — email or phone based on active tab
4. Submit button

**Step 1 implementation changes:**
- Update zod schemas to validate two fields:
  - `nric`: string, min 9 chars (always required)
  - `identifier`: email format or phone min 8 chars (depends on active tab)
- Form submits `{ slot_id, nric, identifier }` to `send-checkout-otp`
- Add `identifier_mismatch` error handler: display "The email/phone does not match the registration for this NRIC."
- Update description text: "Enter your NRIC and email or phone to receive an OTP"
- Update helper text: "OTP will be sent via WhatsApp to your registered phone number."

**Step 2 (OTP entry):**
- Request body changes to `{ slot_id, nric, identifier, code }` for `verify-checkout-otp`
- Add `identifier_mismatch` error handler (same message as step 1)
- OTP input and verification UX unchanged

### 4. Modify: send-checkout-otp Edge Function

**File:** `supabase/functions/send-checkout-otp/index.ts`

**Request body changes:**
- Accept `{ slot_id, nric, identifier }` instead of `{ slot_id, identifier }`
- `nric` is required

**Lookup logic changes:**
- Primary lookup: find registration by `slot_id + invitee_nric`
- Cross-check: verify `identifier` matches either `invitee_email` or `invitee_phone` on the found record
- If NRIC not found: return `registration_not_found`
- If second identifier doesn't match: return new error `identifier_mismatch`

**No changes to:**
- OTP generation logic
- WhatsApp delivery (still sends to registration's `invitee_phone`)
- Rate limiting
- Cooldown logic

### 5. Modify: verify-checkout-otp Edge Function

**File:** `supabase/functions/verify-checkout-otp/index.ts`

**Request body changes:**
- Accept `{ slot_id, nric, identifier, code }` instead of `{ slot_id, identifier, code }`

**Lookup logic changes:**
- Primary lookup by `slot_id + invitee_nric` (instead of trying NRIC then phone)
- Cross-check second identifier matches record
- Rest of OTP verification unchanged — still calls `checkout_with_otp` RPC

## Unchanged Components

| Component | Reason |
|-----------|--------|
| `CheckInScanner.tsx` | Already implements admin QR scan check-in as designed |
| `pdfGenerator.ts` | Invitation card QR (`CHECKIN:{registrationId}`) unchanged |
| `generate-qr-token` / `verify-qr-token` | QR signing still used for checkout URLs |
| `checkout_with_otp` RPC | Atomic OTP verify + checkout logic unchanged |
| `rewards` table / RLS | Manual admin process, no changes needed |
| Database schema | No migration needed — `invitee_nric`, `invitee_email`, `invitee_phone` columns already exist on registrations |

## Error Handling

### Checkout form errors
| Scenario | Error code | User message |
|----------|-----------|--------------|
| NRIC not found for slot | `registration_not_found` | "No registered attendee found for this NRIC." |
| Second identifier doesn't match | `identifier_mismatch` | "The email/phone does not match the registration for this NRIC." |
| Not checked in | `not_checked_in` | "You have not checked in yet. Please check in first." |
| Already checked out | `already_checked_out` | Redirect to success screen |
| Invalid/expired OTP | `invalid_otp` | "Invalid or expired OTP. Please try again." |
| Rate limit | `rate_limit_exceeded` | "Too many attempts. Please try again later." |

## Testing Considerations

- Verify admin scanner still works end-to-end (scan QR → attendance created → status = attended)
- Verify checkout with email + NRIC combination
- Verify checkout with phone + NRIC combination
- Verify mismatched second identifier is rejected
- Verify OTP still sent to registered WhatsApp phone regardless of identifier type
- Verify VenueDisplay manual toggle shows/hides QR correctly
- Verify QR refresh continues working on 60s interval
- Verify `/public/checkin` route returns 404 after removal
- Verify full cycle: check-in → checkout → `is_full_attendance = true`
