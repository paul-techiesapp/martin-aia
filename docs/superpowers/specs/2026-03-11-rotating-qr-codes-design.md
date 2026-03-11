# Feature: Rotating QR Codes for Check-in/Out

**Date:** 2026-03-11
**Status:** Approved
**Scope:** Full-stack (Edge Functions, database, admin portal, public pages)

## Overview

Replace static QR codes with rotating, cryptographically signed QR codes that expire every 60 seconds. Prevents attendees from sharing QR code screenshots with people not physically at the venue.

## Requirements

- QR code content rotates every 60 seconds
- Signed timestamp approach (HMAC-SHA256) — stateless, no DB writes for rotation
- 90-second validation window (60s rotation + 30s grace period)
- Auto-switches between check-in and check-out mode based on slot time windows
- Venue display accessible via admin portal (authenticated) and public URL (token-protected)
- HMAC secret stays server-side only (Supabase Edge Functions)

## Design

### Venue Display

Two access points to the live rotating QR display:

1. **Admin portal:** `/venue-display/:slotId` — requires admin login
2. **Public display URL:** `/public/display/:slotId?token=<display-token>` — no auth, token-protected for venue devices (tablets/TVs)

Display shows:
- Campaign name, venue, date/time header
- Large QR code that auto-refreshes every 60 seconds
- Countdown timer showing seconds until next refresh
- Color-coded mode indicator (green = check-in, amber = check-out)

### QR Code Signing & Verification

**Two Supabase Edge Functions:**

#### `generate-qr-token`
- **Called by:** Display page every 60 seconds
- **Input:** `slot_id`, `mode` (checkin | checkout)
- **Process:** Generates HMAC-SHA256 signature over `slot_id + mode + timestamp` using server-side secret
- **Output:** Signed URL → `/public/checkin?slot={slotId}&ts={timestamp}&sig={hmac}` (or `/public/checkout` for checkout mode)

#### `verify-qr-token`
- **Called by:** Check-in/checkout page when attendee lands on it after scanning
- **Input:** `slot_id`, `mode`, `ts`, `sig` (from URL query params)
- **Validation:**
  1. Recompute HMAC from `slot_id + mode + ts` with same secret
  2. Compare against provided `sig`
  3. Check `ts` is within 90 seconds of current server time
- **If valid:** Proceed to normal PIN + NRIC entry flow
- **If expired/invalid:** Show "QR code expired, please scan the current code at the venue" message with a retry prompt

**Why 90-second window:** QR rotates every 60s, but a user may scan at second 58 and take time to load the page. The 30s grace period prevents false rejections.

### Display Tokens

For the public (unauthenticated) venue display URL:

- Admin generates a "display token" from the slot management page
- Stored in a new `display_tokens` table:
  - `id` (UUID, PK)
  - `slot_id` (FK → slots)
  - `token` (UUID, unique)
  - `created_at` (timestamp)
  - `expires_at` (timestamp, default: campaign end date)
- Tokens can be revoked (deleted) from admin portal
- RLS: Admin full access. Public (anon) can read to validate token on display page.

### Auto-Switch Logic

Uses existing slot configuration (`checkin_window_minutes`, `checkout_window_minutes`, `day_of_week`, `start_time`, `end_time`):

| Time Period | Display State |
|-------------|---------------|
| Before check-in window | "Event starts soon" waiting screen |
| During check-in window | Check-in QR (green theme) |
| Between check-in and check-out | "Event in progress" screen |
| During check-out window | Check-out QR (amber theme) |
| After check-out window | "Event ended" screen |

The display page calculates the current slot occurrence based on the slot's day-of-week + start/end time configuration, then determines which window is active.

### Changes to Existing Check-in/Check-out Pages

The existing `CheckIn.tsx` and `CheckOut.tsx` pages are updated to:

1. Check for `ts` and `sig` query params on page load
2. If present: call `verify-qr-token` Edge Function before showing the PIN + NRIC form
3. If absent (legacy static URL): show the form as-is for backward compatibility during transition
4. If verification fails: show expiration message with instructions to scan again

This ensures backward compatibility — old static QR codes still work until admins switch to the rotating system.

## Files Changed

| Area | File | Change |
|------|------|--------|
| **Edge Functions** | `supabase/functions/generate-qr-token/index.ts` | New — generates signed QR URL |
| **Edge Functions** | `supabase/functions/verify-qr-token/index.ts` | New — verifies HMAC + timestamp |
| **Database** | `supabase/migrations/YYYYMMDD_display_tokens.sql` | New — `display_tokens` table + RLS policies |
| **Admin Portal** | `apps/admin-portal/src/pages/VenueDisplay.tsx` | New — full-screen venue display page |
| **Admin Portal** | `apps/admin-portal/src/pages/PinCodes.tsx` | Add display token generation/management UI |
| **Admin Portal** | `apps/admin-portal/src/router.tsx` | Add `/venue-display/:slotId` route |
| **Public Pages** | `apps/public-pages/src/pages/Display.tsx` | New — public token-protected venue display |
| **Public Pages** | `apps/public-pages/src/pages/CheckIn.tsx` | Add QR token verification step |
| **Public Pages** | `apps/public-pages/src/pages/CheckOut.tsx` | Add QR token verification step |
| **Public Pages** | `apps/public-pages/src/router.tsx` | Add `/public/display/:slotId` route |
| **Environment** | Supabase Edge Function secrets | `QR_HMAC_SECRET` (server-side only) |

## Out of Scope

- Removing/deprecating static QR codes (kept for backward compatibility)
- Geolocation-based verification
- QR code scanning within the app (attendees use their phone's native camera)
- Rate limiting on Edge Functions (can be added later)
- Multiple QR codes displayed simultaneously (design uses auto-switch)
