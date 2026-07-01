# Campaign-Level Headcount Limit

**Date:** 2026-03-30
**Status:** Draft

## Summary

Move attendance limiting from per-agent-per-slot (via `tiers.invitation_limit_per_slot`) to an optional campaign-level headcount cap (`campaigns.max_headcount`). When set, the total number of registrations across all slots in the campaign cannot exceed this value. When null, attendance is unlimited.

## Current State

- `tiers` table has `invitation_limit_per_slot INTEGER NOT NULL` — limits how many attendees a single agent can register per slot
- `register_attendee()` PL/pgSQL function enforces this by counting registrations per agent+slot and comparing against the tier limit
- There is no global event-level capacity limit

## Changes

### 1. Database Migration

**Add to `campaigns`:**
```sql
ALTER TABLE campaigns ADD COLUMN max_headcount INTEGER NULL;
-- NULL = unlimited, positive integer = hard cap
ALTER TABLE campaigns ADD CONSTRAINT campaigns_max_headcount_check CHECK (max_headcount IS NULL OR max_headcount > 0);
```

**Remove from `tiers`:**
```sql
ALTER TABLE tiers DROP COLUMN invitation_limit_per_slot;
```

**Update `register_attendee()` function:**
- Remove: tier lookup, per-agent-per-slot count check against `v_tier.invitation_limit_per_slot`
- Add: campaign lookup, total registration count across all slots in the campaign vs `campaigns.max_headcount`
- When `max_headcount IS NULL`, skip the capacity check entirely (unlimited)
- Concurrency safety: use existing row-level locking pattern

### 2. Shared Types (`packages/shared-types`)

**`Campaign` interface — add:**
```typescript
max_headcount: number | null;
```

**`Tier` interface — remove:**
```typescript
invitation_limit_per_slot: number; // DELETE THIS LINE
```

### 3. Admin Portal

**Campaign form (`CampaignDetail.tsx` or campaign creation):**
- Add optional number input "Max Headcount"
- Helper text: "Leave empty for unlimited"
- Show current registration count vs max headcount on campaign detail view (e.g., "45 / 100 registered" or "45 registered (unlimited)")

**Tier form (`TierList.tsx`):**
- Remove `invitation_limit_per_slot` field from create/edit form
- Remove "X per slot" display from tier table

### 4. Agent Portal

**Files affected:**
- `Dashboard.tsx` — remove display of `tier.invitation_limit_per_slot`
- `Campaigns.tsx` — remove `maxPerSlot` logic that uses `tier.invitation_limit_per_slot`
- `MyLinks.tsx` — remove `maxPerSlot` variable and any capacity display based on tier limit

### 5. Public Pages

- Registration error message "Registration full" remains unchanged — it's now triggered by campaign headcount instead of tier limit
- No UI changes needed

### 6. Seed Data

- `seed.sql` and `seed-demo.sql` — remove `invitation_limit_per_slot` from tier inserts, add `max_headcount` to campaign inserts where appropriate

## Enforcement Logic (Updated `register_attendee()`)

```sql
-- Get campaign for headcount check
SELECT c.* INTO v_campaign
FROM campaigns c
JOIN slots s ON s.campaign_id = c.id
WHERE s.id = v_link.slot_id;

-- Campaign headcount check (only if max_headcount is set)
IF v_campaign.max_headcount IS NOT NULL THEN
  SELECT COUNT(*) INTO v_count
  FROM registrations r
  JOIN slots s ON s.id = r.slot_id
  WHERE s.campaign_id = v_campaign.id;

  IF v_count >= v_campaign.max_headcount THEN
    RAISE EXCEPTION 'Registration full' USING ERRCODE = 'P0002';
  END IF;
END IF;
```

## Files to Modify

| File | Change |
|------|--------|
| New migration SQL | Add `max_headcount` to campaigns, drop `invitation_limit_per_slot` from tiers, update `register_attendee()` |
| `packages/shared-types/src/database.ts` | Update `Campaign` and `Tier` interfaces |
| `apps/admin-portal/src/pages/tiers/TierList.tsx` | Remove invitation limit field |
| `apps/admin-portal/src/pages/campaigns/CampaignDetail.tsx` | Add max headcount input and display |
| `apps/agent-portal/src/pages/Dashboard.tsx` | Remove tier limit display |
| `apps/agent-portal/src/pages/Campaigns.tsx` | Remove maxPerSlot logic |
| `apps/agent-portal/src/pages/MyLinks.tsx` | Remove maxPerSlot logic |
| `supabase/seed.sql` | Update tier/campaign data |
| `supabase/seed-demo.sql` | Update tier/campaign data |

## Out of Scope

- Per-slot headcount limits (not requested)
- Waitlist functionality when headcount is reached
- Real-time capacity display on public registration pages
