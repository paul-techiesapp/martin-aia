# Campaign-Level Headcount Limit Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace per-agent-per-slot invitation limits (on tiers) with an optional campaign-level max headcount.

**Architecture:** New nullable `max_headcount` column on `campaigns` table replaces `invitation_limit_per_slot` on `tiers`. The `register_attendee()` PL/pgSQL function is updated to count total registrations across all campaign slots instead of per-agent-per-slot. Admin sets headcount in the campaign form; null means unlimited.

**Tech Stack:** PostgreSQL (Supabase), TypeScript, React, TanStack Query, react-hook-form + zod, shadcn/ui

---

### Task 1: Database Migration

**Files:**
- Create: `supabase/migrations/20260330000003_campaign_headcount.sql`

- [ ] **Step 1: Create migration file**

```sql
-- Campaign-level headcount limit
-- Spec: docs/superpowers/specs/2026-03-30-campaign-headcount-limit-design.md

-- 1. Add max_headcount to campaigns (NULL = unlimited)
ALTER TABLE campaigns ADD COLUMN max_headcount INTEGER NULL;
ALTER TABLE campaigns ADD CONSTRAINT campaigns_max_headcount_check CHECK (max_headcount IS NULL OR max_headcount > 0);

-- 2. Remove invitation_limit_per_slot from tiers
ALTER TABLE tiers DROP COLUMN invitation_limit_per_slot;

-- 3. Replace register_attendee() with campaign-level headcount check
CREATE OR REPLACE FUNCTION register_attendee(
  p_link_code uuid,
  p_name text,
  p_nric text,
  p_phone text,
  p_email text DEFAULT NULL,
  p_occupation text DEFAULT NULL
) RETURNS uuid AS $$
DECLARE
  v_link agent_links%ROWTYPE;
  v_campaign campaigns%ROWTYPE;
  v_count integer;
  v_completed_count integer;
  v_capacity_type capacity_type;
  v_registration_id uuid;
BEGIN
  -- Look up agent_link with row lock (serializes concurrent registrations per link)
  SELECT * INTO v_link FROM agent_links WHERE link_code = p_link_code AND is_active = true FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Link not found or inactive' USING ERRCODE = 'P0001';
  END IF;

  -- Global completion gate: block registration if NRIC already completed an event
  IF p_nric IS NOT NULL THEN
    SELECT COUNT(*) INTO v_completed_count
    FROM registrations
    WHERE invitee_nric = p_nric AND status = 'completed';

    IF v_completed_count > 0 THEN
      RAISE EXCEPTION 'Invitee has already completed an event'
        USING ERRCODE = 'P0005';
    END IF;
  END IF;

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

  -- Determine capacity type
  IF v_link.partner_id IS NULL THEN
    v_capacity_type := 'agent';
  ELSE
    v_capacity_type := 'business_partner';
  END IF;

  -- Check NRIC duplicate per slot
  IF p_nric IS NOT NULL THEN
    PERFORM 1 FROM registrations WHERE slot_id = v_link.slot_id AND invitee_nric = p_nric;
    IF FOUND THEN
      RAISE EXCEPTION 'NRIC already registered for this slot' USING ERRCODE = 'P0003';
    END IF;
  END IF;

  -- Check phone duplicate per slot
  IF p_phone IS NOT NULL THEN
    PERFORM 1 FROM registrations WHERE slot_id = v_link.slot_id AND invitee_phone = p_phone;
    IF FOUND THEN
      RAISE EXCEPTION 'Phone already registered for this slot' USING ERRCODE = 'P0004';
    END IF;
  END IF;

  -- Insert registration
  INSERT INTO registrations (
    agent_link_id, agent_id, slot_id, capacity_type, status,
    invitee_name, invitee_nric, invitee_phone, invitee_email, invitee_occupation,
    registered_at
  ) VALUES (
    v_link.id, v_link.agent_id, v_link.slot_id, v_capacity_type, 'registered',
    p_name, p_nric, p_phone, p_email, p_occupation,
    now()
  ) RETURNING id INTO v_registration_id;

  RETURN v_registration_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
```

- [ ] **Step 2: Deploy migration to production**

Run: `npx supabase db push`

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260330000003_campaign_headcount.sql
git commit -m "feat: add campaign-level max_headcount, remove tier invitation_limit_per_slot"
```

---

### Task 2: Update Shared Types

**Files:**
- Modify: `packages/shared-types/src/database.ts:77-89` (Campaign interface)
- Modify: `packages/shared-types/src/database.ts:103-111` (Tier interface)

- [ ] **Step 1: Add max_headcount to Campaign interface**

In `packages/shared-types/src/database.ts`, add `max_headcount` to the `Campaign` interface:

```typescript
export interface Campaign {
  id: string;
  name: string;
  start_date: string;
  end_date: string;
  venue: string;
  registration_type: InvitationType;
  status: CampaignStatus;
  created_at: string;
  updated_at: string;
  checkout_config?: CheckoutConfig;
  card_template_overrides?: Partial<CardTemplate> | null;
  max_headcount: number | null;
}
```

- [ ] **Step 2: Remove invitation_limit_per_slot from Tier interface**

```typescript
export interface Tier {
  id: string;
  name: string;
  role_type: RoleType;
  reward_amount: number;
  created_at: string;
  updated_at: string;
}
```

- [ ] **Step 3: Run typecheck to find all broken references**

Run: `pnpm -r typecheck`

This will show all files that reference `invitation_limit_per_slot` on the Tier type — these are the files we fix in subsequent tasks.

- [ ] **Step 4: Commit**

```bash
git add packages/shared-types/src/database.ts
git commit -m "feat: add max_headcount to Campaign, remove invitation_limit_per_slot from Tier"
```

---

### Task 3: Update Admin Portal — Tier Form

**Files:**
- Modify: `apps/admin-portal/src/pages/tiers/TierList.tsx`

- [ ] **Step 1: Remove invitation_limit_per_slot from form state**

In `TierList.tsx`, update the `formData` state initialization (line 52-57):

```typescript
  const [formData, setFormData] = useState({
    name: '',
    role_type: RoleType.AGENT,
    reward_amount: 0,
  });
```

- [ ] **Step 2: Remove invitation_limit_per_slot from handleOpenDialog**

Update the `handleOpenDialog` function (lines 59-78). When editing:

```typescript
  const handleOpenDialog = (tier?: Tier) => {
    if (tier) {
      setEditingTier(tier);
      setFormData({
        name: tier.name,
        role_type: tier.role_type,
        reward_amount: tier.reward_amount,
      });
    } else {
      setEditingTier(null);
      setFormData({
        name: '',
        role_type: RoleType.AGENT,
        reward_amount: 0,
      });
    }
    setIsDialogOpen(true);
  };
```

- [ ] **Step 3: Remove invitation_limit_per_slot form field**

Remove the entire `<div>` block for "Invitation Limit per Slot" (lines 167-174):

```tsx
              <div>
                <Label>Invitation Limit per Slot</Label>
                <Input
                  type="number"
                  value={formData.invitation_limit_per_slot}
                  onChange={(e) => setFormData({ ...formData, invitation_limit_per_slot: parseInt(e.target.value) || 0 })}
                />
              </div>
```

- [ ] **Step 4: Update dialog description text**

Update the `DialogDescription` (lines 131-133) to remove mention of invitation limits:

```tsx
              <DialogDescription>
                {editingTier ? 'Update the tier name, role type, and reward amount.' : 'Define the tier name, role type, and reward amount.'}
              </DialogDescription>
```

- [ ] **Step 5: Update page subtitle**

Change the subtitle (line 119):

```tsx
          <p className="text-sm text-muted-foreground">Configure reward tiers</p>
```

- [ ] **Step 6: Remove Invitation Limit column from table**

Remove the `<TableHead>` for "Invitation Limit" (line 208):

```tsx
                  <TableHead className="text-right">Invitation Limit</TableHead>
```

Remove the corresponding `<TableCell>` in the row (line 218):

```tsx
                    <TableCell className="text-right text-muted-foreground">{tier.invitation_limit_per_slot} per slot</TableCell>
```

Also update the `<TableSkeleton>` columns prop from 5 to 4 (line 197):

```tsx
            <TableSkeleton rows={5} columns={4} />
```

- [ ] **Step 7: Verify typecheck passes for admin-portal**

Run: `pnpm --filter admin-portal typecheck`

- [ ] **Step 8: Commit**

```bash
git add apps/admin-portal/src/pages/tiers/TierList.tsx
git commit -m "refactor: remove invitation_limit_per_slot from tier form and table"
```

---

### Task 4: Update Admin Portal — Campaign Form (Add Max Headcount)

**Files:**
- Modify: `apps/admin-portal/src/pages/campaigns/CampaignForm.tsx`

- [ ] **Step 1: Add max_headcount to zod schema**

Update the `campaignSchema` (lines 33-40):

```typescript
const campaignSchema = z.object({
  name: z.string().min(1, 'Name is required'),
  venue: z.string().min(1, 'Venue is required'),
  start_date: z.string().min(1, 'Start date is required'),
  end_date: z.string().min(1, 'End date is required'),
  registration_type: z.nativeEnum(InvitationType),
  status: z.nativeEnum(CampaignStatus),
  max_headcount: z.union([z.number().int().positive(), z.literal('')]).transform(v => v === '' ? null : v).nullable(),
});
```

- [ ] **Step 2: Add max_headcount to form defaultValues**

Update the `defaultValues` (lines 55-62):

```typescript
    defaultValues: {
      name: '',
      venue: '',
      start_date: '',
      end_date: '',
      registration_type: InvitationType.BUSINESS_OPPORTUNITY,
      status: CampaignStatus.DRAFT,
      max_headcount: null,
    },
```

- [ ] **Step 3: Include max_headcount in form reset when editing**

Update the `useEffect` that resets form on campaign load (lines 65-76):

```typescript
  useEffect(() => {
    if (campaign) {
      form.reset({
        name: campaign.name,
        venue: campaign.venue,
        start_date: campaign.start_date,
        end_date: campaign.end_date,
        registration_type: campaign.registration_type,
        status: campaign.status,
        max_headcount: campaign.max_headcount,
      });
    }
  }, [campaign, form]);
```

- [ ] **Step 4: Include max_headcount in onSubmit**

Update `onSubmit` to pass `max_headcount` (lines 78-89):

```typescript
  const onSubmit = async (data: CampaignFormData) => {
    try {
      const payload = {
        ...data,
        max_headcount: data.max_headcount || null,
      };
      if (isEditing && campaignId) {
        await updateCampaign.mutateAsync({ id: campaignId, ...payload });
      } else {
        await createCampaign.mutateAsync({ ...payload, checkout_config: { fb_enabled: false, fb_url: '', video_enabled: false, video_url: '', rating_enabled: false } });
      }
      navigate({ to: '/campaigns' });
    } catch (error) {
      console.error('Failed to save campaign:', error);
    }
  };
```

- [ ] **Step 5: Add max_headcount form field**

Add this `FormField` after the status field (after line 245), before the buttons:

```tsx
              <FormField
                control={form.control}
                name="max_headcount"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Max Headcount</FormLabel>
                    <FormControl>
                      <Input
                        type="number"
                        placeholder="Leave empty for unlimited"
                        value={field.value ?? ''}
                        onChange={(e) => {
                          const val = e.target.value;
                          field.onChange(val === '' ? null : parseInt(val));
                        }}
                      />
                    </FormControl>
                    <FormDescription>
                      Maximum total attendees across all slots. Leave empty for unlimited.
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />
```

- [ ] **Step 6: Verify typecheck passes**

Run: `pnpm --filter admin-portal typecheck`

- [ ] **Step 7: Commit**

```bash
git add apps/admin-portal/src/pages/campaigns/CampaignForm.tsx
git commit -m "feat: add max_headcount field to campaign create/edit form"
```

---

### Task 5: Update Admin Portal — Campaign Detail (Show Headcount)

**Files:**
- Modify: `apps/admin-portal/src/pages/campaigns/CampaignDetail.tsx:494-531` (info cards section)

- [ ] **Step 1: Add headcount info card**

Add a fourth card to the info grid at lines 494-531. Change the grid from `md:grid-cols-3` to `md:grid-cols-4` and add:

```tsx
      <div className="grid gap-3 md:grid-cols-4">
        {/* ... existing 3 cards unchanged ... */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Headcount
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="font-semibold text-foreground">
              {campaign.max_headcount ? `${campaign.max_headcount} max` : 'Unlimited'}
            </p>
          </CardContent>
        </Card>
      </div>
```

- [ ] **Step 2: Verify typecheck passes**

Run: `pnpm --filter admin-portal typecheck`

- [ ] **Step 3: Commit**

```bash
git add apps/admin-portal/src/pages/campaigns/CampaignDetail.tsx
git commit -m "feat: display campaign headcount limit on campaign detail page"
```

---

### Task 6: Update Agent Portal — Remove Tier Limit References

**Files:**
- Modify: `apps/agent-portal/src/pages/Dashboard.tsx:96-99`
- Modify: `apps/agent-portal/src/pages/Campaigns.tsx:152-168`
- Modify: `apps/agent-portal/src/pages/MyLinks.tsx:76,278-279`

- [ ] **Step 1: Remove invitation limit from Dashboard tier card**

In `Dashboard.tsx`, remove the "Invitation Limit per Slot" row (lines 96-99):

```tsx
                <div className="flex justify-between items-center py-2">
                  <span className="text-muted-foreground">Invitation Limit per Slot</span>
                  <span className="font-semibold text-foreground">{agent.tier.invitation_limit_per_slot}</span>
                </div>
```

The remaining tier card will show just "Tier Name" and "Reward per Attendance".

- [ ] **Step 2: Remove maxPerSlot logic from Campaigns.tsx**

In `Campaigns.tsx`, remove `maxPerSlot` variable and the capacity display (lines 152, 167-169).

Replace the slot rendering block (lines 149-170) with:

```tsx
                {slots.map((slot: Slot) => {
                  const existingLink = getExistingLink(slot.id);
                  const regCount = existingLink?.registration_count ?? 0;

                  return (
                    <div
                      key={slot.id}
                      className="flex items-center justify-between py-2.5 first:pt-0 last:pb-0"
                    >
                      <div className="flex items-center gap-4 text-sm">
                        <span className="font-medium text-foreground w-28">
                          {format(parseISO(slot.start_at), 'd MMM yyyy')}
                        </span>
                        <span className="text-muted-foreground">
                          {format(parseISO(slot.start_at), 'HH:mm')} – {format(parseISO(slot.end_at), 'HH:mm')}
                        </span>
                        {existingLink && (
                          <span className="text-xs text-sky-600">
                            {regCount} registered
                          </span>
                        )}
                      </div>
```

The key change: removed `maxPerSlot` variable, changed `{regCount}/{maxPerSlot} registered` to just `{regCount} registered`, and removed the conditional amber coloring.

- [ ] **Step 3: Remove maxPerSlot from MyLinks.tsx**

In `MyLinks.tsx`, remove the `maxPerSlot` variable (line 76):

```typescript
  const maxPerSlot = agent?.tier?.invitation_limit_per_slot ?? 0;
```

And update the registration count display (lines 277-280) from:

```tsx
                          <div className="mt-1 text-sm">
                            <span className={regCount >= maxPerSlot ? 'text-amber-600 font-medium' : 'text-sky-600'}>
                              {regCount}/{maxPerSlot} registered
                            </span>
                          </div>
```

To:

```tsx
                          <div className="mt-1 text-sm">
                            <span className="text-sky-600">
                              {regCount} registered
                            </span>
                          </div>
```

- [ ] **Step 4: Verify typecheck passes for agent-portal**

Run: `pnpm --filter agent-portal typecheck`

- [ ] **Step 5: Commit**

```bash
git add apps/agent-portal/src/pages/Dashboard.tsx apps/agent-portal/src/pages/Campaigns.tsx apps/agent-portal/src/pages/MyLinks.tsx
git commit -m "refactor: remove invitation_limit_per_slot references from agent portal"
```

---

### Task 7: Update Seed Data

**Files:**
- Modify: `supabase/seed.sql`
- Modify: `supabase/seed-demo.sql`

- [ ] **Step 1: Update seed.sql tier insert**

In `supabase/seed.sql`, change the tier insert (line 112) from:

```sql
INSERT INTO tiers (id, name, role_type, reward_amount, invitation_limit_per_slot)
VALUES (
  'f669fbc3-94ea-46ed-bfc5-a24e669ec337',
  'Standard Agent',
  'agent',
  50.00,
  10
```

To:

```sql
INSERT INTO tiers (id, name, role_type, reward_amount)
VALUES (
  'f669fbc3-94ea-46ed-bfc5-a24e669ec337',
  'Standard Agent',
  'agent',
  50.00
```

- [ ] **Step 2: Update seed.sql campaign insert to include max_headcount**

In `supabase/seed.sql`, update the campaign insert (line 147) to include `max_headcount`:

```sql
INSERT INTO campaigns (id, name, start_date, end_date, venue, registration_type, status, max_headcount)
VALUES (
  'aaaa1111-1111-1111-1111-111111111111',
  'March 2026 Recruitment Drive',
  '2026-03-01',
  '2026-03-31',
  'Marina Bay Sands Convention Centre',
  'business_opportunity',
  'active',
  100
```

- [ ] **Step 3: Update seed-demo.sql tier inserts**

In `supabase/seed-demo.sql`, update the base tier insert (line 13):

```sql
INSERT INTO tiers (id, name, role_type, reward_amount) VALUES
  ('f669fbc3-94ea-46ed-bfc5-a24e669ec337', 'Standard Agent', 'agent', 50.00)
ON CONFLICT (name) DO NOTHING;
```

And the additional tiers insert (line 33):

```sql
INSERT INTO tiers (id, name, role_type, reward_amount) VALUES
  ('d0000001-0000-0000-0000-000000000001', 'Senior Agent', 'agent', 100.00),
  ('d0000001-0000-0000-0000-000000000002', 'Business Partner', 'business_partner', 75.00)
ON CONFLICT (name) DO NOTHING;
```

- [ ] **Step 4: Add max_headcount to seed-demo.sql campaign inserts**

Update the March campaign (line 17) to include `max_headcount`:

```sql
INSERT INTO campaigns (id, name, start_date, end_date, venue, registration_type, status, checkout_config, max_headcount) VALUES
  ('aaaa1111-1111-1111-1111-111111111111', 'March 2026 Recruitment Drive', '2026-03-01', '2026-03-31', 'Marina Bay Sands Convention Centre', 'business_opportunity', 'active',
   '{"fb_enabled": true, "fb_url": "https://facebook.com/demo", "video_enabled": false, "video_url": "", "rating_enabled": true}'::jsonb, 100)
ON CONFLICT (id) DO NOTHING;
```

Update the April career fair (line 43) with a different limit:

```sql
INSERT INTO campaigns (id, name, start_date, end_date, venue, registration_type, status, checkout_config, max_headcount) VALUES
  ('c0000002-0000-0000-0000-000000000002',
   'April 2026 Career Fair',
   '2026-04-01', '2026-04-30',
   'Raffles City Convention Centre',
   'job_opportunity', 'active',
   '{"fb_enabled": false, "fb_url": "", "video_enabled": true, "video_url": "https://youtube.com/demo", "rating_enabled": false}'::jsonb, 200)
ON CONFLICT (id) DO NOTHING;
```

Leave the completed February campaign and draft May campaign without `max_headcount` (they'll be null/unlimited).

- [ ] **Step 5: Commit**

```bash
git add supabase/seed.sql supabase/seed-demo.sql
git commit -m "chore: update seed data for campaign headcount, remove tier invitation limits"
```

---

### Task 8: Full Typecheck and Lint

**Files:** None (verification only)

- [ ] **Step 1: Run full typecheck**

Run: `pnpm -r typecheck`

Expected: No type errors. If any remain, they will be files referencing `invitation_limit_per_slot` that were missed — fix them.

- [ ] **Step 2: Run lint**

Run: `pnpm lint`

Expected: No new lint errors.

- [ ] **Step 3: Commit any fixes**

If any fixes were needed:

```bash
git add -A
git commit -m "fix: resolve remaining type errors from headcount migration"
```
