# Shareable Links & Registration Redesign

**Date:** 2026-03-11
**Status:** Approved

## Overview

Redesign the invitation system from pre-created one-time-use tokens to shareable links per agent/partner per slot, remove PIN codes, and update check-in/check-out to use rotating QR + WhatsApp OTP.

## Changes Summary

| Aspect | Current | New |
|--------|---------|-----|
| Invitation model | Pre-create N tokens, 1 link per person | 1 shareable link per agent/partner per slot |
| Registration | Look up token → fill form | Look up link owner → fill form → create record |
| Capacity type | Manual per invitation | Automatic: agent link → `agent`, partner link → `business_partner` |
| PIN codes | Generated per slot | **Removed** |
| Check-in | PIN or QR | Rotating QR only |
| Check-out | PIN or QR | Rotating QR + WhatsApp OTP |
| Commission tracking | Via invitation.agent_id | Via link owner (agent or partner) |
| Capacity limits | Tier's `invitation_limit_per_slot` | Same limit, enforced at registration time (server-side) |
| Duplicate scope | Per invitation token | Per slot (same person can register for different slots) |

## Database Schema

### New table: `agent_links`

```sql
agent_links
├── id              UUID (PK)
├── agent_id        UUID (FK → agents) — the unit who owns this link
├── slot_id         UUID (FK → slots) — which datetime slot
├── partner_id      UUID (FK → partners, nullable) — if owned by a partner
├── link_code       UUID (unique) — the shareable code in the URL
├── is_active       BOOLEAN (default true) — for revocation
├── created_at      TIMESTAMPTZ
└── updated_at      TIMESTAMPTZ

-- PostgreSQL NULL != NULL in UNIQUE, so use partial unique indexes:
CREATE UNIQUE INDEX agent_links_unique_agent_slot
  ON agent_links(agent_id, slot_id) WHERE partner_id IS NULL;
CREATE UNIQUE INDEX agent_links_unique_partner_slot
  ON agent_links(agent_id, slot_id, partner_id) WHERE partner_id IS NOT NULL;
```

- `partner_id` is NULL → link belongs to the agent directly
- `partner_id` is set → link belongs to that partner (under the agent)
- `capacity_type` is derived: NULL partner = `'agent'`, non-NULL partner = `'business_partner'`

### Modified table: `registrations` (renamed from `invitations`)

```sql
registrations (was: invitations)
├── id                  UUID (PK)
├── agent_link_id       UUID (FK → agent_links) — which link they came from
├── agent_id            UUID (FK → agents) — denormalized for easy queries
├── slot_id             UUID (FK → slots) — denormalized for easy queries
├── capacity_type       ENUM('agent', 'business_partner') — auto-set based on agent_link
├── status              ENUM('registered', 'attended', 'completed', 'expired')
├── invitee_name        TEXT
├── invitee_nric        TEXT
├── invitee_phone       TEXT
├── invitee_email       TEXT
├── invitee_occupation  TEXT
├── registered_at       TIMESTAMPTZ
├── created_at          TIMESTAMPTZ
└── updated_at          TIMESTAMPTZ
```

Changes from current `invitations`:
- **Removed**: `unique_token` (no longer needed)
- **Removed**: `claimed_by_partner_id` (replaced by agent_link's partner_id)
- **Added**: `agent_link_id` (tracks which link brought them)
- **Removed status**: `'pending'` (records only exist after registration)
- **Denormalized**: `agent_id`, `slot_id` from agent_link for query performance
- **Uniqueness**: `invitee_nric` and `invitee_phone` unique per slot (not globally)

### New table: `otp_codes`

```sql
otp_codes
├── id              UUID (PK)
├── registration_id UUID (FK → registrations) — which registrant
├── slot_id         UUID (FK → slots) — which slot (for lookup)
├── phone           TEXT — phone number OTP was sent to
├── code            TEXT — 6-digit OTP
├── expires_at      TIMESTAMPTZ — created_at + 5 minutes
├── is_used         BOOLEAN (default false)
├── created_at      TIMESTAMPTZ
└── updated_at      TIMESTAMPTZ
```

Used for WhatsApp OTP verification at check-out. TTL enforced by checking `expires_at` at verification time. Stale records can be cleaned up periodically. Rate limiting uses existing `whatsapp_send_log` table.

### Removed table: `pin_codes`

Entirely dropped. WhatsApp OTP replaces PIN-based verification.

### Modified table: `attendance`

```sql
attendance
├── id                UUID (PK)
├── registration_id   UUID UNIQUE (FK → registrations) — was invitation_id
├── checkin_time      TIMESTAMPTZ
├── checkout_time     TIMESTAMPTZ (nullable)
├── is_full_attendance BOOLEAN
├── created_at        TIMESTAMPTZ
└── updated_at        TIMESTAMPTZ
```

Changes from current:
- **Renamed**: `invitation_id` → `registration_id` (FK now references `registrations`)
- **Removed**: `pin_code_id` column (PIN codes no longer exist)
- Existing unique constraint and index updated to use `registration_id`

### Enum type changes

- **`invitation_status`** → **`registration_status`**: Create new enum with values `('registered', 'attended', 'completed', 'expired')`. Remove `'pending'` (records only exist after registration). Migrate column, drop old enum.
- **`invitation_type`** on `campaigns` table: Rename to `registration_type` for consistency. Values stay the same.
- **`capacity_type`**: No changes.

### Unchanged tables

- `campaigns` — rename `invitation_type` column to `registration_type` (enum values unchanged)
- `slots`, `agents`, `tiers`, `partners` — no changes
- `rewards` — no schema changes. Reward creation is triggered by application logic at check-out (step 9 in check-out flow) when `is_full_attendance` is set to true. The agent_id for the reward is taken from the registration record.
- `display_tokens` — stays (used for rotating QR)

### NRIC/Phone uniqueness

Current uniqueness is **global** (partial unique index across all invitations). New uniqueness is **per slot**:

```sql
CREATE UNIQUE INDEX registrations_unique_nric_per_slot
  ON registrations(slot_id, invitee_nric) WHERE invitee_nric IS NOT NULL;
CREATE UNIQUE INDEX registrations_unique_phone_per_slot
  ON registrations(slot_id, invitee_phone) WHERE invitee_phone IS NOT NULL;
```

This allows the same person to register for different slots.

## Link Generation & Sharing Flow

### URL Format

```
https://martin-public-pages.onrender.com/register/{link_code}
```

Same base path as current, but `link_code` maps to an `agent_link` instead of a one-time invitation token.

### Agent Flow

1. Agent logs into Agent Portal
2. Browses campaigns → sees available datetime slots
3. Picks a slot → system auto-creates `agent_link` record (agent_id + slot_id + partner_id=NULL → generates link_code UUID)
4. Agent sees their unique URL + copy button
5. Agent shares to anyone via WhatsApp/SMS/etc.
6. Dashboard shows: "5/10 registered" (live count vs tier limit)

### Partner Flow

1. Partner logs into Agent Portal (partner role)
2. Browses same campaigns/slots as their parent agent
3. Picks a slot → system auto-creates `agent_link` record (agent_id=parent + slot_id + partner_id=self → generates link_code UUID)
4. Partner sees their unique URL + copy button
5. Partner shares to anyone
6. Dashboard shows: "3/10 registered" (counts toward shared agent pool)

### Capacity Enforcement

- Tier defines `invitation_limit_per_slot` (e.g., 10)
- The limit is shared across the agent AND all their partners for a given slot
- At registration time: `COUNT registrations WHERE agent_id = X AND slot_id = Y` must be < limit
- **Enforced server-side** via database function (not just client-side)
- Capacity check always uses the **agent's** tier, even when registering through a partner's link (partners don't have their own tier)
- If an agent's tier changes mid-campaign, the **current** tier limit applies at registration time (no historical snapshotting)

### Link Lifecycle

- Link is created when agent/partner first selects a slot (lazy generation)
- Link can be deactivated (`is_active = false`) by the agent or admin
- Deactivated links show "This link is no longer active" on the registration page
- Link code never changes once created (stable URL for sharing)

## Registration Flow (Public Pages)

### When someone clicks the link

1. `GET /register/{link_code}`
2. Look up `agent_link` by `link_code`
   - Not found or `is_active = false` → "Link is no longer active"
   - Found → fetch slot + campaign details
3. Check slot timing
   - Slot's `start_at` is in the past → "Registration closed"
   - Slot is upcoming → show registration form
4. Check capacity
   - COUNT registrations for this agent_id + slot_id >= tier limit → "Registration is full"
   - Under limit → allow registration
5. Show registration form with event details (campaign name, venue, date/time)
6. Fields: Name, NRIC, Phone, Email, Occupation

### On form submission

1. Validate required fields
2. Duplicate checks (server-side):
   - NRIC already registered for this slot → "Already registered"
   - Phone already registered for this slot → "Already registered"
3. Re-check capacity (race condition protection) using `SELECT ... FOR UPDATE`
4. Create registration record with:
   - `agent_link_id` from lookup
   - `agent_id`, `slot_id` denormalized from agent_link
   - `capacity_type`: `partner_id IS NULL ? 'agent' : 'business_partner'`
   - `status`: `'registered'`
   - `registered_at`: `NOW()`
5. Success page: "You're registered for [Campaign] on [Date/Time]"

### Duplicate scope

NRIC and phone uniqueness is checked **per slot**. Same person can register for different time slots within the same campaign.

## Check-in & Check-out Flow

### Check-in (Rotating QR)

1. Admin venue display shows rotating QR code per slot (existing `display_tokens` system — unchanged)
2. Registered person scans QR at venue
3. QR contains: `slot_id + timestamp + HMAC signature` (existing format)
4. System verifies QR signature + time validity (90s window)
5. Person identifies themselves: enters NRIC or Phone on check-in page
6. Look up registration `WHERE slot_id = X AND (invitee_nric = input OR invitee_phone = input) AND status = 'registered'`
7. Match found → create attendance record: `{ registration_id, checkin_time: NOW(), is_full_attendance: false }`
8. Registration status → `'attended'`

### Check-out (Rotating QR + WhatsApp OTP)

1. Person scans rotating QR again
2. System verifies QR signature + time validity
3. Person enters NRIC or Phone
4. Look up attendance `WHERE registration.invitee_nric = input AND checkin_time IS NOT NULL AND checkout_time IS NULL`
5. Match found → trigger WhatsApp OTP to registered phone number
6. Person enters OTP code on check-out page
7. OTP verified → update attendance: `{ checkout_time: NOW(), is_full_attendance: true }`
8. Registration status → `'completed'`
9. Reward record created automatically

### Why OTP at check-out only

- Check-in: QR proves physical presence, low friction to enter venue
- Check-out: OTP confirms identity + prevents someone checking out on behalf of another. Full attendance triggers rewards — this is the money moment.

## Portal UI Changes

### Agent Portal

**Dashboard (agent role):**
- Replace "Invitations" stats with "Registrations" stats
- Show: Total registrations, Attended, Completed across all slots
- "Active Partners" stat remains

**Dashboard (partner role):**
- Replace invitation claim stats with registration stats
- Show: Registrations via my links, Attended, Completed

**Campaigns page (replaces Invitations page):**
1. Agent sees list of campaigns with available slots
2. Expands a campaign → sees datetime slots
3. Per slot: "Get My Link" button → generates agent_link, shows URL + copy button
4. Registration count: "5/10 registered"
5. Table of registrants (name, phone, status)

**Partner portal sidebar:**
- Dashboard (partner stats)
- My Links (browse slots, get links, see registrations)
- Profile

**Removed pages:**
- `Invitations.tsx` (replaced by campaign slot link flow)
- `AvailableInvitations.tsx` (partners no longer "claim" from pool)
- `MyClaimedInvitations.tsx` (partners see their own link registrations)

### Admin Portal

- Campaign Detail: slot management stays, replace "invitation count" with "registration count", add registration view per slot with agent/partner attribution
- Remove PIN code management page
- PDF Export: pull from `registrations` table, include agent/partner attribution column

### Public Pages

- Register: same form, different lookup (link_code → agent_link)
- Check-in: QR scan → NRIC/Phone identification (no PIN option)
- Check-out: QR scan → NRIC/Phone → WhatsApp OTP
- Display: rotating QR stays, remove PIN display

## Edge Functions & Backend

### Modified Edge Functions

- **`send-email-reminders`**: Query `registrations` instead of `invitations`, join through `agent_links` → `slots` → `campaigns`
- **`generate-qr-token`**: No changes (works with slot_id only)
- **`verify-qr-token`**: Change lookup from `invitations` to `registrations`
- **`send-whatsapp-pin` → `send-whatsapp-otp`**: Repurpose for time-limited OTP at check-out. Flow: generate 6-digit OTP → insert into `otp_codes` table (expires_at = NOW() + 5 min) → send via WhatsApp → log in `whatsapp_send_log` for rate limiting. New **`verify-otp`** edge function: look up `otp_codes` by registration_id + code, check `expires_at > NOW()` and `is_used = false`, mark as used.
- **`deactivate-partner`**: Complete rewrite of `deactivate_partner_and_release` RPC. Instead of releasing claimed invitations, set `agent_links.is_active = false` for all partner's links. Existing registrations through those links remain valid.
- **`create-partner`**: No changes needed

### New Database Function (RPC)

**`register_attendee(link_code, name, nric, phone, email, occupation)`:**
1. Look up agent_link by link_code (validate active)
2. Get agent's tier → `invitation_limit_per_slot`
3. COUNT registrations WHERE agent_id + slot_id (`FOR UPDATE` for atomicity)
4. If count >= limit → error "Registration full"
5. Check NRIC/phone duplicates for this slot
6. INSERT registration record
7. Return success

Database function (not edge function) for atomicity with `SELECT ... FOR UPDATE`.

### RLS Policy Updates

**`agent_links` table:**
- Admin: full access
- Agents: CRUD own links (`agent_id = get_agent_id()`)
- Partners: CRUD own links (`partner_id = get_partner_id()` AND `agent_id = get_partner_agent_id()`)
- Anon: SELECT active links (for registration page lookup)

**`registrations` table:**
- Admin: full access
- Agents: read own registrations (`agent_id = get_agent_id()`)
- Partners: read registrations through their links (`agent_link_id` in own links)
- Anon: insert via `register_attendee` RPC, update for attendance flow

## Migration Order

The migration must be carefully ordered due to FK dependencies:

1. Create new enum `registration_status` with values `('registered', 'attended', 'completed', 'expired')`
2. Create `agent_links` table with partial unique indexes
3. Create `otp_codes` table with composite index on `(registration_id, code)`
4. Modify `attendance`: drop `pin_code_id` column and its FK/NOT NULL constraint
5. Rename `invitations` → `registrations` (must happen BEFORE attendance FK update): drop `unique_token`, `claimed_by_partner_id` columns; add `agent_link_id` column; switch status column to new enum; replace global NRIC/phone unique indexes with per-slot unique indexes
6. Modify `attendance`: rename `invitation_id` → `registration_id`, update FK to reference `registrations` (now exists), rename unique constraint and index to `idx_attendance_registration`
7. Drop `pin_codes` table (safe now — `attendance` no longer references it)
8. Rename `campaigns.invitation_type` → `campaigns.registration_type`
9. Drop old `invitation_status` enum
10. Update `whatsapp_send_log`: add `phone` column, update index to support rate limiting by phone (checkout flow may identify by phone only; the lookup resolves the registration record to get both NRIC and phone before logging)
11. Rewrite all RLS policies for `registrations` and `attendance`
12. Rewrite `deactivate_partner_and_release` RPC function
13. Create `register_attendee` RPC function
