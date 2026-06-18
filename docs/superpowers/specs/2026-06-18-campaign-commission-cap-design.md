# Campaign Commission Cap — Design Spec

**Date:** 2026-06-18
**Status:** Approved (pending spec review)

## Problem

Today, every invitee who completes an event (checks out) generates a commission
(`rewards` row) for their inviting agent at the agent's tier rate. The agency has
no way to cap total commission payout for an event.

Admins need an **optional** control: *"only the first X invitees earn a commission
for this campaign."* Once X commissions are granted, further completions still
happen normally — they simply earn no reward.

## Semantics (decided)

- **Scope: per campaign (whole event).** The cap is a single total budget across
  all slots and all agents in the campaign — not per agent.
- **Ordering: first X to complete.** The first X invitees who actually check out
  (transition to `status = 'completed'`) each generate one commission. No-shows
  never consume a commission slot, so a fully-attended event pays out exactly X.
- **Optional.** `NULL` = no cap (current behaviour: every completion earns
  commission). This is the default for all existing campaigns — fully
  backwards-compatible.
- **Independent of `max_headcount`.** `max_headcount` caps *registrations*; this
  caps *commissions*. They are unrelated knobs.

## Approach

Rewards are born inside the existing `create_reward_on_completion()` trigger
(migration `20260618000001_rewards_on_completion.sql`), which fires
`AFTER UPDATE OF status` on `registrations` when a row becomes `completed`.

**Enforce the cap inside that same trigger.** Before inserting the reward, resolve
the campaign for the registration, and if `commission_cap` is set, count
commissions already granted in the campaign; skip the insert when the count has
reached the cap. This keeps registration / check-in / checkout flows completely
untouched, gives a single source of truth, and cannot be bypassed from the client.

Rejected alternative: enforcing in the Edge/app layer. The reward is created by a
DB trigger, so app-layer logic would be bypassable and race-prone.

### Concurrency

Counting "commissions granted so far in this campaign" walks
`rewards → attendance → registrations → slots → campaign`. To make this race-safe
under concurrent checkouts, the trigger takes a `SELECT … FOR UPDATE` lock on the
campaign row before counting, serializing reward grants for that one campaign so
two simultaneous checkouts cannot both slip past the Xth slot. Checkout is
OTP-gated and low-volume, so the lock is effectively free.

## Components

### 1. Database migration

New file: `supabase/migrations/20260618000002_campaign_commission_cap.sql`

```sql
-- Optional per-campaign commission cap: only the first N invitees to COMPLETE
-- (check out) earn a reward for their agent. NULL = no cap (every completion
-- earns commission, the prior behaviour). Independent of max_headcount, which
-- caps registrations rather than commissions.

ALTER TABLE campaigns ADD COLUMN commission_cap INTEGER NULL;
ALTER TABLE campaigns
  ADD CONSTRAINT campaigns_commission_cap_check
  CHECK (commission_cap IS NULL OR commission_cap > 0);

-- Replace the reward trigger function to honour the cap. The trigger itself
-- (trg_create_reward_on_completion) is unchanged and keeps pointing at this
-- function by name, so it does not need to be recreated.
CREATE OR REPLACE FUNCTION create_reward_on_completion()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_attendance_id uuid;
  v_amount numeric;
  v_campaign_id uuid;
  v_commission_cap integer;
  v_granted_count integer;
BEGIN
  IF NEW.status = 'completed' AND (OLD.status IS DISTINCT FROM 'completed') THEN
    SELECT id INTO v_attendance_id FROM attendance WHERE registration_id = NEW.id;
    IF v_attendance_id IS NULL THEN
      RETURN NEW;  -- no attendance row to attach the reward to
    END IF;

    SELECT t.reward_amount INTO v_amount
    FROM agents a
    JOIN tiers t ON t.id = a.tier_id
    WHERE a.id = NEW.agent_id;

    IF v_amount IS NULL THEN
      RETURN NEW;  -- agent has no tier / reward rate
    END IF;

    -- Resolve the campaign for this registration and lock it so concurrent
    -- checkouts cannot both slip past the Xth commission slot.
    SELECT c.id, c.commission_cap INTO v_campaign_id, v_commission_cap
    FROM slots s
    JOIN campaigns c ON c.id = s.campaign_id
    WHERE s.id = NEW.slot_id
    FOR UPDATE OF c;

    -- Commission budget cap: only the first N completed invitees in the campaign
    -- earn a reward. NULL = no cap.
    IF v_commission_cap IS NOT NULL THEN
      SELECT COUNT(*) INTO v_granted_count
      FROM rewards rw
      JOIN attendance att ON att.id = rw.attendance_id
      JOIN registrations r ON r.id = att.registration_id
      JOIN slots s ON s.id = r.slot_id
      WHERE s.campaign_id = v_campaign_id;

      IF v_granted_count >= v_commission_cap THEN
        RETURN NEW;  -- commission budget exhausted; completion still succeeds
      END IF;
    END IF;

    INSERT INTO rewards (agent_id, attendance_id, amount, capacity_type, status)
    VALUES (NEW.agent_id, v_attendance_id, v_amount, NEW.capacity_type, 'pending')
    ON CONFLICT (attendance_id) DO NOTHING;
  END IF;

  RETURN NEW;
END;
$$;
```

No backfill is needed — the column starts `NULL` everywhere and the cap only ever
gates *future* reward creation.

### 2. Shared types

`packages/shared-types/src/database.ts` — add to the `Campaign` interface:

```typescript
export interface Campaign {
  // ...existing fields...
  max_headcount: number | null;
  commission_cap: number | null;
}
```

### 3. Admin campaign form

`apps/admin-portal/src/pages/campaigns/CampaignForm.tsx` — mirror the existing
`max_headcount` field exactly:

- Zod schema: add `commission_cap` with the same `z.preprocess(... nullable())`
  pattern used for `max_headcount`.
- `defaultValues`: `commission_cap: null`.
- Edit `useEffect` (`form.reset`): add `commission_cap: campaign.commission_cap`.
- `onSubmit` payload: include `commission_cap: data.commission_cap || null`
  (the payload already spreads `...data`).
- New `FormField` directly after the `max_headcount` field:
  - **Label:** `Commission Cap (first X invitees)`
  - **Placeholder:** `Leave empty for no cap`
  - **Description:** `Only the first X invitees who complete the event earn a commission for their agent. Leave empty so every completion earns commission.`
  - Same numeric `Input` with `value={field.value ?? ''}` and the
    `onChange` that maps `''` → `null` else `parseInt(val)`.

### 4. Campaign detail

`apps/admin-portal/src/pages/campaigns/CampaignDetail.tsx` — add a "Commission Cap"
info card next to the existing "Headcount" card (same `Card` markup):

```tsx
<Card>
  <CardHeader className="pb-2">
    <CardTitle className="text-sm font-medium text-muted-foreground">
      Commission Cap
    </CardTitle>
  </CardHeader>
  <CardContent>
    <p className="font-semibold text-foreground">
      {campaign.commission_cap ? `${campaign.commission_cap} invitees` : 'No cap'}
    </p>
  </CardContent>
</Card>
```

Bump the info-card grid column count to fit the extra card.

## Edge cases / rules

- **Lowering the cap below already-granted count** does not claw back existing
  rewards. The cap only gates future reward creation.
- **A completion that hits the cap still completes successfully** and still creates
  its `attendance` row — only the `rewards` insert is skipped.
- **Existing campaigns** get `commission_cap = NULL` (no cap) — no behaviour change.
- **Agents without a tier** still earn nothing (unchanged), and such a completion
  does **not** consume a commission slot (the function returns before the cap
  check when `v_amount IS NULL`).

## Out of scope (YAGNI)

- A live "N of X commissions granted" counter on the campaign detail page.
- A per-agent commission cap variant.
- Retroactive reward removal when the cap is lowered.

Each is easy to add later if wanted.

## Testing

- **Migration applies** cleanly and the constraint rejects `0` / negatives.
- **No cap (NULL):** every completion creates a reward (regression — current
  behaviour preserved).
- **Cap = N:** the (N+1)th completion in the campaign creates no reward, while the
  registration still reaches `completed` with an `attendance` row.
- **No-show does not consume a slot:** registrations that never complete do not
  count toward N.
- **Typecheck + lint** pass across all packages.
```