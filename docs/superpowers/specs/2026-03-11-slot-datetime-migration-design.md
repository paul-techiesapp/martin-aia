# Slot DateTime Migration Design

## Overview

Replace the recurring `day_of_week` + `start_time`/`end_time` slot model with specific `start_at`/`end_at` TIMESTAMPTZ columns. Each slot becomes a concrete event occurrence rather than a recurring weekly pattern.

## Motivation

The current slot model uses `day_of_week INTEGER` (0-6) combined with `TIME` columns, creating recurring weekly patterns within a campaign's date range. This is limiting — admins need to schedule events on specific dates and times, not abstract weekly patterns.

## Design Decisions

- **Full replacement** — `day_of_week`, `start_time`, `end_time` are removed entirely, not deprecated
- **TIMESTAMPTZ** — timezone-aware datetime for correctness across regions
- **Campaign dates stay date-only** — campaigns remain organizational containers with `start_date DATE` and `end_date DATE`
- **Fresh migration** — existing slot data (test-only) is dropped, no data migration needed
- **Minute-based windows preserved** — `checkin_window_minutes` and `checkout_window_minutes` continue as integer offsets from `start_at` and `end_at`

## Database Schema Changes

### Slots Table

**Remove:**
```sql
day_of_week INTEGER NOT NULL          -- (0-6, 0=Sunday)
start_time  TIME NOT NULL
end_time    TIME NOT NULL
CONSTRAINT slots_time_check CHECK (end_time > start_time)
```

**Add:**
```sql
start_at    TIMESTAMPTZ NOT NULL
end_at      TIMESTAMPTZ NOT NULL
CONSTRAINT slots_datetime_check CHECK (end_at > start_at)
CONSTRAINT slots_unique_start UNIQUE (campaign_id, start_at)
```

**Unchanged columns:** `id`, `campaign_id`, `is_active`, `checkin_window_minutes`, `checkout_window_minutes`, `max_capacity`, `created_at`, `updated_at`

### Timezone Strategy

All `start_at`/`end_at` values are stored in UTC (PostgreSQL TIMESTAMPTZ default). The admin portal converts to the browser's local timezone for display and input. Campaign `start_date`/`end_date` remain as DATE (no timezone concern — they are date-only boundaries).

### Migration Strategy

1. Delete all existing rows from `slots` (and cascade to `invitations`, `attendance`, `pin_codes`, `rewards` if necessary)
2. Drop `day_of_week`, `start_time`, `end_time` columns and related constraints
3. Add `start_at TIMESTAMPTZ NOT NULL` and `end_at TIMESTAMPTZ NOT NULL`
4. Add new constraints

### Check-in/Check-out Window Logic

- Check-in opens at: `start_at - interval 'N minutes'` (where N = `checkin_window_minutes`)
- Check-out closes at: `end_at + interval 'M minutes'` (where M = `checkout_window_minutes`)

## Shared Types Changes

### `packages/shared-types/src/database.ts` — Slot Interface

**Remove:**
```typescript
day_of_week: number;
start_time: string;
end_time: string;
```

**Add:**
```typescript
start_at: string;   // ISO 8601 datetime string
end_at: string;     // ISO 8601 datetime string
```

No changes to Campaign, Attendance, or enum types.

## Admin Portal Changes

### Slot Creation UI (`apps/admin-portal/src/pages/CampaignDetail.tsx`)

**Remove** the existing `day_of_week` dropdown from the slot creation form. Replace with:

**Single slot creation (one-at-a-time):**
- Date picker for selecting a specific date
- Two time inputs (`<input type="time">`) for start and end time
- Frontend combines date + times into ISO 8601 datetime string before submitting
- Validation: selected date must fall within campaign's `start_date`–`end_date` range
- Validation: end time must be after start time
- Validation: no duplicate `start_at` for same campaign (enforced by DB unique constraint)

**Bulk generation:**
- Day-of-week dropdown (Monday, Tuesday, etc.)
- Start time + end time inputs
- "Generate" button creates individual slots for every matching weekday within the campaign date range
- Preview list shown before confirming — admin can deselect unwanted dates
- Each generated slot is a normal row with `start_at`/`end_at`

### Slot Display

- **Old format:** "Monday 10:00 – 13:00"
- **New format:** "15 Mar 2026, 10:00 – 13:00"
- Sorted by `start_at` ascending

### Edit/Delete

- Admin can edit any individual slot's date and times
- Admin can delete individual slots
- No cascade concerns — references via `slot_id` FK still work

## Impact on Other Apps

### Public Pages (`apps/public-pages`)

- **`src/lib/slot-time.ts` — Complete rewrite required.** This utility calculates `SlotPhase` (waiting/checkin/active/checkout/ended) based on `day_of_week`, `start_time`, and `end_time`. Must be rewritten to compare current time against `start_at`/`end_at` TIMESTAMPTZ values directly — this is simpler since no day-of-week matching is needed anymore.
- **CheckIn/CheckOut pages:** Update slot time display and phase validation to use `start_at`/`end_at`
- **QR code display/verification:** Update any slot time display strings
- **Registration flow:** Update slot info display for new members

### Agent Portal (`apps/agent-portal`)

- Update slot display from "Monday 10:00–13:00" to "15 Mar 2026, 10:00–13:00"

### Edge Functions

- `generate-qr-token` / `verify-qr-token`: Use slot IDs, not time columns directly. Update any time references if present.
- `send-whatsapp-pin`: No slot time dependencies.
- `send-email-reminders` — **Rewrite required.** Currently derives next occurrence from `day_of_week` and formats email subjects using `DAYS[slot.day_of_week]`. With TIMESTAMPTZ columns, the `getNextOccurrence()` helper is no longer needed — use `start_at` directly. Update email subject/body formatting to use the actual date (e.g., "15 Mar 2026" instead of "Monday").

### Admin Portal Hooks

- `apps/admin-portal/src/hooks/useSlots.ts` — Update ordering query from `.order('day_of_week').order('start_time')` to `.order('start_at', { ascending: true })`.

### RLS Policies

No changes needed — policies filter by `campaign_id` and roles, not by time columns.

## Touch Points Summary

| Area | Change | Scope |
|------|--------|-------|
| Database migration | Drop 3 columns, add 2 columns, update constraints | Medium |
| `shared-types` Slot interface | Replace 3 fields with 2 | Small |
| Admin portal — CampaignDetail | Remove day_of_week dropdown, add date picker, bulk generation UI | Large |
| Admin portal — useSlots hook | Update ordering query | Small |
| Public pages — `slot-time.ts` | **Complete rewrite** of phase calculation logic | Medium |
| Public pages — CheckIn/CheckOut | Update time display and phase validation | Medium |
| Agent portal — slot display | Update time display | Small |
| Edge fn — `send-email-reminders` | **Rewrite** date formatting and remove `getNextOccurrence()` | Medium |
| Edge fn — QR token functions | Minor: update any slot time references | Small |
