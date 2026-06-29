# Post-Checkout Thank You Page — Design Specification

## Overview

Enhance the checkout success screen with configurable post-checkout content: a YouTube video/photo embed, a 1-5 star experience rating, and a Facebook follow button. All sections are admin-configurable per campaign with individual enable/disable toggles from the Campaign Detail page.

## Decisions

- **Scope:** Campaign-level configuration (not slot or global)
- **Storage:** JSONB column on existing `campaigns` table (no new tables for config)
- **Thank you message:** Fixed text, not customizable
- **Facebook:** Single FB page URL only (no multi-platform)
- **Video/Photo:** YouTube/external URL embed only (no file uploads)
- **Survey:** Simple 1-5 star rating only (no form builder)
- **Visibility:** Each section has an individual toggle; sections with toggles off or empty URLs are hidden
- **Admin UI location:** New card on Campaign Detail page, below the slots table

## Database Changes

### 1. `campaigns` table — new column

```sql
ALTER TABLE campaigns
  ADD COLUMN checkout_config JSONB NOT NULL DEFAULT '{}'::jsonb;
```

JSON structure (validated by Zod in the app):

```typescript
interface CheckoutConfig {
  fb_enabled: boolean;      // default false
  fb_url: string;           // Facebook page URL
  video_enabled: boolean;   // default false
  video_url: string;        // YouTube or external video URL
  rating_enabled: boolean;  // default false
}
```

No RLS changes needed — existing campaign policies cover this column.

### 2. `attendance` table — new column

```sql
ALTER TABLE attendance
  ADD COLUMN checkout_rating SMALLINT CHECK (checkout_rating >= 1 AND checkout_rating <= 5);
```

Nullable. One rating per attendance record. Existing attendance RLS policies cover this column.

## Data Flow

### Checkout success flow

1. Attendee submits OTP → `verify-checkout-otp` edge function
2. Edge function verifies OTP, records checkout, fetches `campaigns.checkout_config` via slot → campaign join
3. Returns `{ success: true, checkout_config: {...}, attendance_id: "..." }`
4. `CheckOut.tsx` stores config in state → renders thank you page with enabled sections

### Already-checked-out flow

1. Attendee submits identifier → `send-checkout-otp` detects already checked out
2. Returns `{ error: "already_checked_out", checkout_config: {...} }`
3. `CheckOut.tsx` renders thank you page (no OTP step needed)

### Rating submission flow

1. Attendee taps stars on thank you page
2. Frontend calls `submit-checkout-rating` edge function with `{ attendance_id, rating }`
3. Edge function validates and updates `attendance.checkout_rating`
4. Frontend shows confirmation (e.g., stars lock in, "Thank you!" text)

## Edge Functions

### `verify-checkout-otp` (modify)

- After successful verification, join slot → campaign to fetch `checkout_config`
- The current `checkout_with_otp` RPC returns only a boolean. After the RPC succeeds, query for the `attendance_id` separately by selecting from `attendance` where the registration matches (via `registrations.slot_id` + `nric` lookup)
- Join path for config: `registrations.slot_id` → `slots.campaign_id` → `campaigns.checkout_config`
- Include `checkout_config` and `attendance_id` in success response

### `send-checkout-otp` (modify — minor)

- When returning `already_checked_out` error, also include `checkout_config` and `attendance_id` from the campaign/attendance records so the thank you page can display all enabled sections including rating

### `submit-checkout-rating` (new)

- **Endpoint:** `POST /functions/v1/submit-checkout-rating`
- **Auth:** anon key (no user auth required). The `attendance_id` UUID serves as a capability token — it is only returned from the checkout flow and UUIDs are not guessable, so possession of the ID is sufficient authorization
- **Request body:** `{ attendance_id: string, rating: number }`
- **Validation:**
  - `attendance_id` must exist
  - `rating` must be integer 1-5
  - `checkout_rating` must be null (prevents double-submission)
- **Response:** `{ success: true }`
- **Error responses:** `invalid_rating`, `attendance_not_found`, `already_rated`

## Frontend Changes

### `CheckOut.tsx` (public-pages) — modify

Replace the static success screen (lines 354-376) with the thank you page layout:

**Section order (top to bottom):**

1. **Success Header** (always shown) — green checkmark, "Check-Out Successful!", fixed thank you message
2. **Video/Photo Embed** (if `video_enabled && video_url`) — YouTube iframe embed, 16:9 aspect ratio
3. **Star Rating** (if `rating_enabled`) — "How was your experience?" label, 5 tappable stars, calls `submit-checkout-rating` on selection, shows confirmation after submit
4. **Facebook Follow Button** (if `fb_enabled && fb_url`) — blue FB-branded button, opens URL in new tab

**New state:**
- `checkoutConfig: CheckoutConfig | null` — from verify/send response
- `attendanceId: string | null` — from verify response
- `ratingSubmitted: boolean` — locks stars after submission
- `selectedRating: number | null` — current star selection

### `CampaignDetail.tsx` (admin-portal) — modify

Add a "Post-Checkout Content" card section below the existing slots table:

- **Facebook row:** Toggle switch + URL text input
- **Video/Photo row:** Toggle switch + URL text input
- **Experience Rating row:** Toggle switch only + description text
- **Save Configuration button** in card footer

Card fetches existing config from `campaign.checkout_config` on load. Save button calls `useUpdateCheckoutConfig` mutation.

### New hook: `useCheckoutConfig.ts` (admin-portal)

- `useUpdateCheckoutConfig()` — mutation that updates `campaigns.checkout_config` JSONB column via Supabase client

### `shared-types` — modify

Add to `database.ts`:

```typescript
export interface CheckoutConfig {
  fb_enabled: boolean;
  fb_url: string;
  video_enabled: boolean;
  video_url: string;
  rating_enabled: boolean;
}
```

Extend `Campaign` interface with:

```typescript
checkout_config: CheckoutConfig;
```

Extend `Attendance` interface with:

```typescript
checkout_rating: number | null;
```

## Component Summary

| Component | App | Action | Description |
|-----------|-----|--------|-------------|
| `CheckOut.tsx` | public-pages | Modify | Replace static success screen with configurable thank you page |
| `CampaignDetail.tsx` | admin-portal | Modify | Add checkout config card below slots table |
| `useCheckoutConfig.ts` | admin-portal | New | Hook for updating checkout_config |
| `verify-checkout-otp` | edge function | Modify | Return checkout_config + attendance_id in success response |
| `send-checkout-otp` | edge function | Modify | Return checkout_config on already_checked_out |
| `submit-checkout-rating` | edge function | New | Accept and store star rating |
| Migration | supabase | New | Add checkout_config to campaigns, checkout_rating to attendance |
| `shared-types` | package | Modify | Add CheckoutConfig type, extend Campaign |
