# Campaign Commission Cap Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an optional per-campaign "commission cap" so only the first X invitees who complete an event generate a commission for their agent.

**Architecture:** A nullable `commission_cap` column on `campaigns`. The existing `create_reward_on_completion()` trigger (fires when a registration becomes `completed`) is extended: before inserting a reward, it resolves the campaign, locks its row, and — if a cap is set — counts commissions already granted in the campaign and skips the insert once the cap is reached. The admin campaign form and detail page expose the field, mirroring the existing `max_headcount` field exactly.

**Tech Stack:** PostgreSQL (Supabase), TypeScript, React, TanStack Query, react-hook-form + zod, shadcn/ui

**Spec:** `docs/superpowers/specs/2026-06-18-campaign-commission-cap-design.md`

## Global Constraints

- `commission_cap` is **nullable**; `NULL` = no cap (every completion earns commission — current behaviour). DB CHECK: `commission_cap IS NULL OR commission_cap > 0`.
- The cap is **per campaign** (total across all slots/agents) and counts the **first X to complete** (check out). No-shows never consume a slot.
- Hitting the cap **must not** block registration, check-in, or checkout — it only skips the `rewards` insert.
- Lowering the cap later **does not** claw back rewards already granted (the trigger only ever gates new inserts).
- This repo has **no automated DB test harness** (no pgTAP / SQL test runner); migrations are verified by applying locally + functional checks, matching the precedent `campaign-headcount-limit` plan. Frontend is gated by `pnpm -r typecheck` and `pnpm lint`.
- Current column names (verified): `attendance.registration_id`, `registrations.slot_id`, `campaigns.registration_type`.
- Do not auto-commit to `main`. Work happens on a feature branch (Task 0). Do not deploy to production without explicit user approval (Task 6 is user-gated).

---

### Task 0: Create feature branch

**Files:** None (git only)

- [ ] **Step 1: Create and switch to a feature branch**

```bash
git checkout -b feat/campaign-commission-cap
```

- [ ] **Step 2: Confirm clean starting point**

Run: `git status`
Expected: on branch `feat/campaign-commission-cap`; the two design/plan docs may show as untracked — that is fine.

---

### Task 1: Database migration (column + trigger)

**Files:**
- Create: `supabase/migrations/20260618000002_campaign_commission_cap.sql`

**Interfaces:**
- Produces: `campaigns.commission_cap INTEGER NULL`; redefined `create_reward_on_completion()` trigger function (same name/signature, honours the cap).

- [ ] **Step 1: Create the migration file**

Create `supabase/migrations/20260618000002_campaign_commission_cap.sql` with exactly:

```sql
-- Optional per-campaign commission cap: only the first N invitees to COMPLETE
-- (check out) earn a reward for their agent. NULL = no cap (every completion
-- earns commission, the prior behaviour). Independent of max_headcount, which
-- caps registrations rather than commissions.
-- Spec: docs/superpowers/specs/2026-06-18-campaign-commission-cap-design.md

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

- [ ] **Step 2: Apply the migration to the local database**

> Note: this resets local data. The user runs the local Supabase stack — if a reset/restart is needed, ask them to run it, or run it yourself if you own the stack.

Run: `npx supabase db reset`
Expected: all migrations apply with no errors; the final lines show the seed completing. No error mentioning `commission_cap` or `create_reward_on_completion`.

- [ ] **Step 3: Verify the column and constraint exist and reject invalid values**

Run:

```bash
psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" -v ON_ERROR_STOP=0 -c "INSERT INTO campaigns (name, start_date, end_date, venue, registration_type, status, commission_cap) VALUES ('cap-test-zero','2026-07-01','2026-07-01','x','business_opportunity','draft', 0);"
```

Expected: fails with `new row for relation "campaigns" violates check constraint "campaigns_commission_cap_check"`.

Then confirm a valid value is accepted and clean it up:

```bash
psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" -c "INSERT INTO campaigns (name, start_date, end_date, venue, registration_type, status, commission_cap) VALUES ('cap-test-ok','2026-07-01','2026-07-01','x','business_opportunity','draft', 5); DELETE FROM campaigns WHERE name IN ('cap-test-zero','cap-test-ok');"
```

Expected: `INSERT 0 1` then `DELETE 1` (only `cap-test-ok` existed to delete).

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260618000002_campaign_commission_cap.sql
git commit -m "feat(db): add campaign commission_cap and enforce it in reward trigger"
```

---

### Task 2: Add `commission_cap` to the shared Campaign type

**Files:**
- Modify: `packages/shared-types/src/database.ts` (the `Campaign` interface)

**Interfaces:**
- Consumes: nothing.
- Produces: `Campaign.commission_cap: number | null` — used by the admin form, detail page, and query hooks.

- [ ] **Step 1: Add the field to the `Campaign` interface**

In `packages/shared-types/src/database.ts`, add `commission_cap` immediately after `max_headcount` in the `Campaign` interface so it reads:

```typescript
  card_template_overrides?: Partial<CardTemplate> | null;
  max_headcount: number | null;
  commission_cap: number | null;
}
```

- [ ] **Step 2: Typecheck the workspace to find every consumer that now needs the field**

Run: `pnpm -r typecheck`
Expected: PASS, or errors **only** in files that construct a full `Campaign` object literal and now miss `commission_cap`. (The admin form/hooks pass partials, so they should not error.) If an error appears, note the file — it is handled in the relevant task below or as a follow-up edit in this task.

- [ ] **Step 3: Commit**

```bash
git add packages/shared-types/src/database.ts
git commit -m "feat(types): add commission_cap to Campaign"
```

---

### Task 3: Add the field to the admin campaign form

**Files:**
- Modify: `apps/admin-portal/src/pages/campaigns/CampaignForm.tsx`

**Interfaces:**
- Consumes: `Campaign.commission_cap` (Task 2).
- Produces: form now reads/writes `commission_cap` on create and edit.

- [ ] **Step 1: Add `commission_cap` to the zod schema**

In `CampaignForm.tsx`, add this key to `campaignSchema`, directly after the `max_headcount` entry (mirror its exact shape):

```typescript
  commission_cap: z.preprocess(
    (val) => (val === '' || val === null || val === undefined ? null : Number(val)),
    z.number().int().positive().nullable()
  ),
```

- [ ] **Step 2: Add `commission_cap` to `defaultValues`**

In the `useForm({ ... defaultValues })`, add after `max_headcount: null,`:

```typescript
      commission_cap: null,
```

- [ ] **Step 3: Add `commission_cap` to the edit reset effect**

In the `useEffect` that calls `form.reset({...})` when `campaign` loads, add after `max_headcount: campaign.max_headcount,`:

```typescript
        commission_cap: campaign.commission_cap,
```

- [ ] **Step 4: Include `commission_cap` in the submit payload**

In `onSubmit`, update the `payload` line so it normalises both optional numbers:

```typescript
      const payload = {
        ...data,
        max_headcount: data.max_headcount || null,
        commission_cap: data.commission_cap || null,
      };
```

- [ ] **Step 5: Add the `commission_cap` FormField**

Directly after the `max_headcount` `FormField` block, add:

```tsx
              <FormField
                control={form.control}
                name="commission_cap"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Commission Cap (first X invitees)</FormLabel>
                    <FormControl>
                      <Input
                        type="number"
                        placeholder="Leave empty for no cap"
                        value={field.value ?? ''}
                        onChange={(e) => {
                          const val = e.target.value;
                          field.onChange(val === '' ? null : parseInt(val));
                        }}
                      />
                    </FormControl>
                    <FormDescription>
                      Only the first X invitees who complete the event earn a commission for their agent. Leave empty so every completion earns commission.
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />
```

- [ ] **Step 6: Typecheck the admin portal**

Run: `pnpm --filter admin-portal typecheck`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/admin-portal/src/pages/campaigns/CampaignForm.tsx
git commit -m "feat(admin): add commission cap field to campaign form"
```

---

### Task 4: Show the commission cap on the campaign detail page

**Files:**
- Modify: `apps/admin-portal/src/pages/campaigns/CampaignDetail.tsx:552-601` (the info-card grid)

**Interfaces:**
- Consumes: `Campaign.commission_cap` (Task 2).
- Produces: a read-only "Commission Cap" info card.

- [ ] **Step 1: Widen the info-card grid to five columns**

Change the grid container on line 552 from:

```tsx
      <div className="grid gap-3 md:grid-cols-4">
```

to:

```tsx
      <div className="grid gap-3 md:grid-cols-3 lg:grid-cols-5">
```

- [ ] **Step 2: Add the "Commission Cap" card**

Immediately after the closing `</Card>` of the "Headcount" card (line 600) and before the grid's closing `</div>` (line 601), insert:

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

- [ ] **Step 3: Typecheck the admin portal**

Run: `pnpm --filter admin-portal typecheck`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add apps/admin-portal/src/pages/campaigns/CampaignDetail.tsx
git commit -m "feat(admin): display commission cap on campaign detail"
```

---

### Task 5: Full verification (typecheck, lint, functional trigger test)

**Files:** None (verification only)

- [ ] **Step 1: Full workspace typecheck**

Run: `pnpm -r typecheck`
Expected: PASS across all packages.

- [ ] **Step 2: Lint**

Run: `pnpm lint`
Expected: no new errors introduced by this change.

- [ ] **Step 3: Functional trigger test — cap is enforced**

This validates the trigger end-to-end against local Supabase. The user runs the apps; ask them to start `pnpm dev:admin` and `pnpm dev:public` if not already running.

1. In the admin portal, edit (or create) a campaign and set **Commission Cap = 1**. Ensure the campaign is `active` and has a slot.
2. Through the public flow, register **two** invitees on that campaign's slot and run each through check-in → check-out (`checkout_with_otp`) so both reach `completed`.
3. Query the granted commissions for that campaign:

```bash
psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" -c "
SELECT COUNT(*) AS rewards_granted
FROM rewards rw
JOIN attendance att ON att.id = rw.attendance_id
JOIN registrations r ON r.id = att.registration_id
JOIN slots s ON s.id = r.slot_id
JOIN campaigns c ON c.id = s.campaign_id
WHERE c.name = '<your test campaign name>';"
```

Expected: `rewards_granted = 1` (the cap), even though **two** registrations are `completed`.

4. Confirm both registrations still completed (cap did not block checkout):

```bash
psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" -c "
SELECT COUNT(*) AS completed
FROM registrations r
JOIN slots s ON s.id = r.slot_id
JOIN campaigns c ON c.id = s.campaign_id
WHERE c.name = '<your test campaign name>' AND r.status = 'completed';"
```

Expected: `completed = 2`.

- [ ] **Step 4: Functional regression test — no cap means every completion earns**

On a campaign with **Commission Cap empty (NULL)**, complete one invitee and confirm a reward row is created for it (rewards_granted increments by 1). This proves the prior behaviour is preserved when no cap is set.

- [ ] **Step 5: Commit any fixes**

If steps 1–2 surfaced fixes:

```bash
git add -A
git commit -m "fix: resolve typecheck/lint issues for commission cap"
```

---

### Task 6: Deploy to production (USER-GATED — do not run without explicit approval)

**Files:** None (deployment only)

> Production is the `BOP Website` Supabase project (`mjtdsevynrtcmafsnxsj`) under the RACC account. Per project memory, the Supabase CLI must be logged in to the RACC account to push. The frontend auto-deploys to Render on push to `main`. **Only perform this task when the user explicitly says to deploy.**

- [ ] **Step 1: Open a PR / merge the branch to `main`** (per the user's preferred flow)

- [ ] **Step 2: Push the migration to production**

Run: `npx supabase db push`
Expected: migration `20260618000002_campaign_commission_cap` applies to the remote project with no errors.

- [ ] **Step 3: Confirm the column exists in production**

Run (or via the Supabase MCP `execute_sql` against the prod project):

```sql
SELECT column_name FROM information_schema.columns
WHERE table_name = 'campaigns' AND column_name = 'commission_cap';
```

Expected: one row, `commission_cap`.

- [ ] **Step 4: Verify the Render admin-portal deploy picked up the new field** (the form shows "Commission Cap (first X invitees)").
