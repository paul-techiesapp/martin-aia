# Partnership Round 8 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Lock partner-sourced leads to the partner they came from (and show that source to agents), make Staff ID mandatory per partner, move the enquiry-QR menu item from Unit Admin to Unit Manager, and restrict events to their assigned units.

**Architecture:** Four small Postgres migrations carry every rule that must not be bypassable — `submit_enquiry` seeds each car's partner from the branch link, `assign_vehicle_merchant` refuses non-manager changes on sourced leads, `submit_enquiry` enforces a per-partner Staff ID rule, and a `campaign_units` join table plus an `agent_ancestor_ids()` upward walk narrows the campaigns SELECT policy. The React changes are presentation and admin editing on top of those rules; no new dependency, hook pattern or component library is introduced.

**Tech Stack:** React 18 + Vite + TypeScript, TanStack Query/Router, Tailwind + shadcn/ui, Supabase (PostgreSQL 15, RLS), pnpm workspaces.

**Spec:** `docs/superpowers/specs/2026-08-08-partnership-round-8-design.md`

## Global Constraints

- **Branch:** `feat/partnership-round-8` (already created, cut from `main`). Verify with `git rev-parse --abbrev-ref HEAD` before EVERY commit — this repo has concurrent workflows sharing one working tree and a commit has previously landed on the wrong branch.
- **No test runner exists.** There is no vitest/jest and eslint is not installed. Do NOT add one — `pnpm add <anything>` re-trips a known dual-zod tsc failure. Verification gates are the SQL assertions written into each task, plus `npx tsc --noEmit` / `pnpm build`.
- **`pnpm -r typecheck` does NOT cover the apps.** Only `packages/shared-ui` and `packages/shared-types` define a `typecheck` script. For any task touching `apps/`, the real gate is `npx tsc --noEmit` run inside that app's directory (or `pnpm --filter <app> build`, whose script is `tsc && vite build`).
- **Never run `supabase db push` against production.** Remote migrations are applied with the Supabase MCP `apply_migration` tool only.
- **Staging project:** `lyjdlietzmmejrxjvwgp`. **Production project:** `mjtdsevynrtcmafsnxsj` (BOP Website).
- **RLS and SECURITY DEFINER verification must impersonate.** MCP `execute_sql` carries no JWT, so `auth.uid()` is NULL and every unit-scoped helper returns empty regardless of correctness. Use the impersonation pattern in Task 11 and compute fixture ids BEFORE impersonating.
- **Recreating a Postgres function means copying its CURRENT body verbatim** and changing only the lines the task names. `submit_enquiry` is currently defined by `supabase/migrations/20260706000009_enquiry_nric_dedup_window.sql`; `assign_vehicle_merchant` by `20260711000001_partner_master_scope.sql`. Task 5 copies from the file Task 1 creates, not from `20260706000009`.
- **Never null, clear or regenerate `agents.enquiry_link_code`.** Printed QR codes are live (2026-08-02 incident, PR #24).
- **Single Supabase client:** import `supabase` from the app's `src/lib/supabase.ts`. Never call `createClient()`.
- **Zod stays at 3.23.8** across all packages. Do not add or upgrade dependencies.
- **Vehicle statuses:** `submitted`, `quoted`, `renewed`, `lost`. "Open" means `submitted` or `quoted` with `removed_at IS NULL`.
- **Migration filenames** follow the existing `YYYYMMDDNNNNNN_snake_name.sql` convention under `supabase/migrations/`.

---

## File Structure

| File | Responsibility |
| --- | --- |
| `supabase/migrations/20260808000001_source_locked_leads.sql` | Create. `submit_enquiry` seeds car partner; `assign_vehicle_merchant` lock guard; one-time backfill. |
| `supabase/migrations/20260808000002_staff_id_required.sql` | Create. `submit_enquiry` enforces per-partner Staff ID. |
| `supabase/migrations/20260808000003_campaign_units.sql` | Create. `campaign_units` table, `agent_ancestor_ids()`, `campaign_visible_to_me()`, campaigns SELECT policy. |
| `packages/shared-types/src/merchant.ts` | Modify. `MerchantFormSettings.staff_id_required`. |
| `packages/shared-types/src/campaign.ts` | Modify. `CampaignUnit` row type. |
| `apps/agent-portal/src/pages/MyEnquiries.tsx` | Modify. Staff ID + source line; locked partner cell with unit-viewer override. |
| `apps/admin-portal/src/pages/merchants/MerchantDetail.tsx` | Modify. Staff ID switch in Form Design; boolean-safe save. |
| `apps/public-pages/src/pages/Enquiry.tsx` | Modify. Required Staff ID field + `P0020` message. |
| `apps/agent-portal/src/components/Layout.tsx` | Modify. My Link shown to roots + plain agents, hidden for deputies. |
| `apps/admin-portal/src/hooks/useCampaignUnits.ts` | Create. Read + replace-all write for a campaign's units. |
| `apps/admin-portal/src/pages/campaigns/CampaignForm.tsx` | Modify. Units checkbox picker wired to the hook. |

---

### Task 1: Migration — branch leads carry their source partner

**Files:**
- Create: `supabase/migrations/20260808000001_source_locked_leads.sql`

**Interfaces:**
- Consumes: existing `submit_enquiry(text,text,text,text,text,jsonb,text)`, `assign_vehicle_merchant(uuid,uuid)`, `merchant_available_to_agent(uuid,uuid)`, `is_unit_viewer()`, `get_agent_id()`, `unit_member_ids()`.
- Produces: `submit_enquiry` with an unchanged 7-arg signature that additionally writes `enquiry_vehicles.merchant_id`; `assign_vehicle_merchant` raising `P0021` on locked leads. Task 5 copies this file's `submit_enquiry` body.

- [ ] **Step 1: Write the migration**

Create `supabase/migrations/20260808000001_source_locked_leads.sql`:

```sql
-- Round 8 item 1: a lead submitted through a partner BRANCH link belongs to
-- that partner from the moment it arrives.
--
-- Before: submit_enquiry recorded the source on the ENQUIRY
-- (merchant_id / merchant_branch_id) but left enquiry_vehicles.merchant_id
-- NULL, and the agent portal renders only the per-car partner. A lead from
-- Poh Kong Shah Alam therefore looked partner-less, and after a customer
-- reassignment the receiving agent had no way at all to see where it came
-- from. Nothing was ever deleted -- reassign_customer_agent only touches
-- enquiries.agent_id.
--
-- After: the car's merchant_id is seeded from the branch's merchant at
-- submit, and only unit viewers (Unit Manager / Unit Admin deputies) may
-- change it. Admins keep their existing path: confirm_vehicle_renewal takes
-- p_merchant_id explicitly and overwrites this column, so seeding it early
-- cannot misdirect a gift or a settlement.

-- ---------------------------------------------------------------------------
-- submit_enquiry: body copied verbatim from 20260706000009 with ONE change --
-- the enquiry_vehicles INSERT now writes merchant_id (NULL on the agent path,
-- the branch's merchant on the branch path).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION submit_enquiry(
  p_link_code text, p_customer_name text, p_customer_nric text,
  p_customer_phone text, p_customer_email text, p_vehicles jsonb,
  p_staff_id text DEFAULT NULL) RETURNS uuid AS $$
DECLARE
  v_agent_id uuid; v_branch_link_id uuid; v_merchant_branch_id uuid; v_merchant_id uuid;
  v_enquiry_id uuid; v_vehicle_id uuid; v_nric_norm text; v_phone_norm text; v_digits text;
  v_vehicle jsonb; v_att jsonb;
BEGIN
  SELECT id INTO v_agent_id FROM agents WHERE enquiry_link_code = p_link_code AND status='active';
  IF FOUND THEN
    v_branch_link_id := NULL; v_merchant_branch_id := NULL; v_merchant_id := NULL;  -- agent path
  ELSE
    SELECT bl.id, bl.merchant_branch_id, bl.agent_id, b.merchant_id
      INTO v_branch_link_id, v_merchant_branch_id, v_agent_id, v_merchant_id
    FROM branch_links bl
    JOIN merchant_branches b ON b.id = bl.merchant_branch_id
    JOIN merchants m ON m.id = b.merchant_id
    WHERE bl.link_code = p_link_code AND bl.is_active = true
      AND b.status='active' AND m.status='active';
    IF NOT FOUND THEN RAISE EXCEPTION 'Link not found or inactive' USING ERRCODE='P0001'; END IF;
  END IF;

  IF p_vehicles IS NULL OR jsonb_typeof(p_vehicles)<>'array' OR jsonb_array_length(p_vehicles)=0 THEN
    RAISE EXCEPTION 'At least one vehicle is required' USING ERRCODE='P0006'; END IF;

  v_nric_norm := upper(regexp_replace(coalesce(p_customer_nric,''),'[^a-zA-Z0-9]','','g'));

  -- One gold-form registration per IC per month (lock releases after 1 month).
  IF v_nric_norm <> '' AND EXISTS (
    SELECT 1 FROM enquiries
    WHERE customer_nric_normalized = v_nric_norm
      AND created_at >= now() - interval '1 month'
  ) THEN
    RAISE EXCEPTION 'This IC has already been registered' USING ERRCODE='P0009';
  END IF;

  v_digits := regexp_replace(coalesce(p_customer_phone,''),'\D','','g');
  IF left(v_digits,2)='60' THEN v_phone_norm := v_digits;
  ELSE v_digits := regexp_replace(v_digits,'^0+',''); v_phone_norm := CASE WHEN v_digits='' THEN '' ELSE '60'||v_digits END; END IF;

  INSERT INTO enquiries (branch_link_id, merchant_branch_id, merchant_id, agent_id,
    customer_name, customer_nric, customer_nric_normalized,
    customer_phone, customer_phone_normalized, customer_email, status, assigned_at, assigned_by, staff_id)
  VALUES (v_branch_link_id, v_merchant_branch_id, v_merchant_id, v_agent_id,
    p_customer_name, p_customer_nric, v_nric_norm, p_customer_phone, v_phone_norm,
    NULLIF(trim(coalesce(p_customer_email,'')),''), 'open',
    CASE WHEN v_merchant_id IS NOT NULL THEN now() ELSE NULL END, NULL,
    NULLIF(trim(coalesce(p_staff_id,'')),''))
  RETURNING id INTO v_enquiry_id;

  FOR v_vehicle IN SELECT * FROM jsonb_array_elements(p_vehicles) LOOP
    -- CHANGED (round 8): merchant_id seeded from the source branch's merchant.
    INSERT INTO enquiry_vehicles (enquiry_id, merchant_branch_id, merchant_id, car_plate, car_plate_normalized, insurance_expiry_date, insurance_product_id, road_tax_renewal, status)
    VALUES (v_enquiry_id, v_merchant_branch_id, v_merchant_id, v_vehicle->>'car_plate',
      upper(regexp_replace(coalesce(v_vehicle->>'car_plate',''),'[^a-zA-Z0-9]','','g')),
      (v_vehicle->>'expiry_date')::date, NULLIF(v_vehicle->>'insurance_product_id','')::uuid,
      COALESCE((v_vehicle->>'road_tax_renewal')::boolean, false), 'submitted')
    RETURNING id INTO v_vehicle_id;

    -- per-vehicle attachments (optional)
    IF v_vehicle ? 'attachments' AND jsonb_typeof(v_vehicle->'attachments') = 'array' THEN
      FOR v_att IN SELECT * FROM jsonb_array_elements(v_vehicle->'attachments') LOOP
        IF coalesce(v_att->>'storage_path','') <> '' THEN
          INSERT INTO enquiry_attachments (enquiry_id, enquiry_vehicle_id, storage_path, file_name, content_type, size_bytes)
          VALUES (v_enquiry_id, v_vehicle_id, v_att->>'storage_path',
            coalesce(NULLIF(v_att->>'file_name',''),'document'),
            v_att->>'content_type', NULLIF(v_att->>'size_bytes','')::bigint)
          ON CONFLICT (storage_path) DO NOTHING;
        END IF;
      END LOOP;
    END IF;
  END LOOP;

  PERFORM notify_agent_enquiry(v_enquiry_id);
  RETURN v_enquiry_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions, net, vault;
GRANT EXECUTE ON FUNCTION submit_enquiry(text,text,text,text,text,jsonb,text) TO anon;

-- ---------------------------------------------------------------------------
-- assign_vehicle_merchant: same UPDATE and ownership rules as 20260711000001,
-- plus two guards.
--   P0021 -- the enquiry came from a partner branch and the caller is not a
--            unit viewer, so the partner is locked.
--   The availability check is skipped when the target IS the enquiry's own
--   source merchant: a non-master source partner is not in any receiving
--   agent's allowed set, so without this a unit viewer who moved a car off it
--   could never move it back.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION assign_vehicle_merchant(p_vehicle_id uuid, p_merchant_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_agent_id           uuid := get_agent_id();
  v_has_source         boolean;
  v_source_merchant_id uuid;
BEGIN
  IF v_agent_id IS NULL THEN
    RAISE EXCEPTION 'Not an agent' USING ERRCODE='42501';
  END IF;

  SELECT e.merchant_branch_id IS NOT NULL, e.merchant_id
    INTO v_has_source, v_source_merchant_id
  FROM enquiry_vehicles ev
  JOIN enquiries e ON e.id = ev.enquiry_id
  WHERE ev.id = p_vehicle_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Vehicle not found or not yours' USING ERRCODE='42501';
  END IF;

  IF v_has_source AND NOT is_unit_viewer() THEN
    RAISE EXCEPTION 'This lead is locked to the partner it came from' USING ERRCODE='P0021';
  END IF;

  IF (v_source_merchant_id IS NULL OR p_merchant_id <> v_source_merchant_id)
     AND NOT merchant_available_to_agent(p_merchant_id, v_agent_id) THEN
    RAISE EXCEPTION 'Partnership not found, not active, or not assignable by you' USING ERRCODE='P0008';
  END IF;

  UPDATE enquiry_vehicles ev
     SET merchant_id = p_merchant_id
    FROM enquiries e
   WHERE ev.id = p_vehicle_id
     AND e.id = ev.enquiry_id
     AND (e.agent_id = v_agent_id OR e.agent_id IN (SELECT unit_member_ids()));
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Vehicle not found or not yours' USING ERRCODE='42501';
  END IF;
END;
$$;
GRANT EXECUTE ON FUNCTION assign_vehicle_merchant(uuid, uuid) TO authenticated;

-- ---------------------------------------------------------------------------
-- One-time backfill: OPEN cars on branch-sourced enquiries inherit the
-- enquiry's partner. Renewed and lost cars are deliberately excluded -- their
-- partner was decided at confirmation time and gift/settlement rows already
-- point at it.
-- ---------------------------------------------------------------------------
UPDATE enquiry_vehicles ev
   SET merchant_id = e.merchant_id
  FROM enquiries e
 WHERE e.id = ev.enquiry_id
   AND ev.merchant_id IS NULL
   AND ev.removed_at IS NULL
   AND ev.status IN ('submitted','quoted')
   AND e.merchant_branch_id IS NOT NULL
   AND e.merchant_id IS NOT NULL;
```

- [ ] **Step 2: Count what the backfill will touch, BEFORE applying**

Run against staging (`lyjdlietzmmejrxjvwgp`) with MCP `execute_sql`:

```sql
SELECT count(*) AS will_backfill
FROM enquiry_vehicles ev
JOIN enquiries e ON e.id = ev.enquiry_id
WHERE ev.merchant_id IS NULL
  AND ev.removed_at IS NULL
  AND ev.status IN ('submitted','quoted')
  AND e.merchant_branch_id IS NOT NULL
  AND e.merchant_id IS NOT NULL;
```

Record the number. Expected: greater than zero on staging (the client's Poh Kong leads are of exactly this shape). If it is zero, stop and report — either the fixture data is missing or the predicate is wrong.

- [ ] **Step 3: Apply to staging**

Apply the file with MCP `apply_migration` against `lyjdlietzmmejrxjvwgp`, name `source_locked_leads`.

- [ ] **Step 4: Verify the backfill ran and nothing else moved**

```sql
-- must now be 0: no open branch-sourced car left partner-less
SELECT count(*) AS still_null
FROM enquiry_vehicles ev
JOIN enquiries e ON e.id = ev.enquiry_id
WHERE ev.merchant_id IS NULL
  AND ev.removed_at IS NULL
  AND ev.status IN ('submitted','quoted')
  AND e.merchant_branch_id IS NOT NULL
  AND e.merchant_id IS NOT NULL;

-- must be 0: no renewed/lost car disagrees with its gift's merchant
SELECT count(*) AS money_mismatch
FROM gifts g
JOIN enquiry_vehicles ev ON ev.id = g.enquiry_vehicle_id
WHERE ev.merchant_id IS DISTINCT FROM g.merchant_id;
```

Expected: `still_null` = 0, `money_mismatch` = 0.

- [ ] **Step 5: Verify a new branch submission seeds the car partner**

Pick an active branch link on staging, then submit through it as anon:

```sql
SELECT bl.link_code, b.merchant_id
FROM branch_links bl
JOIN merchant_branches b ON b.id = bl.merchant_branch_id
JOIN merchants m ON m.id = b.merchant_id
WHERE bl.is_active AND b.status='active' AND m.status='active'
LIMIT 1;

SELECT submit_enquiry(
  '<link_code>', 'Round8 Seed Test', 'S9999001A', '+60123456789',
  'round8-seed@example.com',
  '[{"car_plate":"R8SEED1","expiry_date":"2027-01-01","road_tax_renewal":false}]'::jsonb,
  'STAFF-R8');

SELECT ev.car_plate, ev.merchant_id, e.merchant_id AS enquiry_merchant, e.staff_id
FROM enquiry_vehicles ev JOIN enquiries e ON e.id = ev.enquiry_id
WHERE ev.car_plate = 'R8SEED1';
```

Expected: `ev.merchant_id` equals `enquiry_merchant` and is not NULL.

Clean up the fixture:

```sql
DELETE FROM enquiries WHERE customer_nric_normalized = 'S9999001A';
```

- [ ] **Step 6: Commit**

```bash
git rev-parse --abbrev-ref HEAD   # must print feat/partnership-round-8
git add supabase/migrations/20260808000001_source_locked_leads.sql
git commit -m "feat(db): seed car partner from source branch and lock it to unit viewers"
```

---

### Task 2: Agent lead card shows Staff ID and source

**Files:**
- Modify: `apps/agent-portal/src/pages/MyEnquiries.tsx` (CardHeader block, currently lines 261-294)

**Interfaces:**
- Consumes: `EnquiryWithDetails` from `apps/agent-portal/src/hooks/useMyEnquiries.ts` — `staff_id: string | null` (via `Enquiry`), `branch: { name: string; merchant: { name: string } | null } | null`, `merchant: { id: string; name: string } | null`. All three are already selected; no hook or type change.
- Produces: nothing other tasks consume.

- [ ] **Step 1: Add the source label helper inside `EnquiryCard`**

In `apps/agent-portal/src/pages/MyEnquiries.tsx`, immediately above the `return (` of `EnquiryCard` (just after `const reassignOptions = ...`), add:

```tsx
  // Round 8 item 2: agents see which partner (and which of its branches) sent
  // the lead, and which partner staff member referred it — the same pair admin
  // already shows in its enquiry list. Both come from columns the query
  // already selects.
  const sourceLabel = enq.branch
    ? `${enq.branch.merchant?.name ?? 'Partner'} — ${enq.branch.name}`
    : (enq.merchant?.name ?? null);
```

- [ ] **Step 2: Render the line in the card header**

Directly after the "Submitted …" paragraph and before the `{showAgent && enq.agent && (` block, insert:

```tsx
          {(enq.staff_id || sourceLabel) && (
            <p className="text-xs text-muted-foreground">
              {enq.staff_id ? `Staff ID: ${enq.staff_id}` : null}
              {enq.staff_id && sourceLabel ? ' · ' : null}
              {sourceLabel}
            </p>
          )}
```

- [ ] **Step 3: Typecheck**

```bash
cd apps/agent-portal && npx tsc --noEmit
```

Expected: no errors. If `staff_id` is reported missing on the type, stop — it should exist at `packages/shared-types/src/merchant.ts:102`; do not cast it away.

- [ ] **Step 4: Verify in the running agent portal**

The user runs the apps. Ask them to open My Enquiries and confirm a branch-sourced lead now reads e.g. `Staff ID: AIDA · Poh Kong — Shah Alam Branch`, and that an agent-link lead (no branch, no staff) shows no extra line at all.

- [ ] **Step 5: Commit**

```bash
git rev-parse --abbrev-ref HEAD
git add apps/agent-portal/src/pages/MyEnquiries.tsx
git commit -m "feat(agent): show staff ID and lead source on the enquiry card"
```

---

### Task 3: Locked partner cell with unit-viewer override

**Files:**
- Modify: `apps/agent-portal/src/pages/MyEnquiries.tsx` (Partner `TableCell`, currently lines 322-368)

**Interfaces:**
- Consumes: `enq.merchant_branch_id` (on `Enquiry`), the existing `isUnitView` prop, `assignVehicleMerchant` mutation, `vehicleMerchant` state, `activeMerchants`.
- Produces: nothing other tasks consume.

- [ ] **Step 1: Add the lock flag and the per-vehicle edit state**

Next to the other `useState` calls in `EnquiryCard` (after `const [copiedId, setCopiedId] = useState<string | null>(null);`) add:

```tsx
  // Round 8 item 1: a lead that arrived through a partner BRANCH link is
  // locked to that partner. Plain agents see it as fixed text; unit viewers
  // (Unit Manager / Unit Admin) can open an override. Admins change it in the
  // renewal dialog, which is a different code path entirely.
  const isSourceLocked = !!enq.merchant_branch_id;
  const [editingVehicleId, setEditingVehicleId] = useState<string | null>(null);
```

- [ ] **Step 2: Replace the Partner cell body**

Replace the whole `<TableCell>` that currently renders the partner (the one starting `{v.merchant?.name ? (`) with:

```tsx
                      <TableCell>
                        {v.merchant?.name && editingVehicleId !== v.id ? (
                          <div className="flex items-center gap-1.5">
                            <span className="inline-flex items-center gap-1.5 text-sm font-medium text-foreground">
                              <Store className="size-3.5 text-muted-foreground shrink-0" />
                              {v.merchant.name}
                            </span>
                            {isUnitView && !readOnly && (
                              <Button
                                size="sm"
                                variant="ghost"
                                className="h-7 px-2 text-xs"
                                onClick={() => setEditingVehicleId(v.id)}
                              >
                                Change
                              </Button>
                            )}
                          </div>
                        ) : readOnly ? (
                          <span className="text-xs text-muted-foreground">Unassigned</span>
                        ) : isSourceLocked && !isUnitView ? (
                          <span className="text-xs text-muted-foreground">Locked to partner</span>
                        ) : (
                          <div className="flex items-center gap-1.5">
                            <Select
                              value={vehicleMerchant[v.id] ?? ''}
                              onValueChange={(val) =>
                                setVehicleMerchant((prev) => ({ ...prev, [v.id]: val }))
                              }
                            >
                              <SelectTrigger className="w-44 h-8 text-sm">
                                <SelectValue placeholder="Assign partner" />
                              </SelectTrigger>
                              <SelectContent>
                                {activeMerchants.length === 0 ? (
                                  <SelectItem value="__none" disabled>
                                    No active partnerships
                                  </SelectItem>
                                ) : (
                                  activeMerchants.map((m) => (
                                    <SelectItem key={m.id} value={m.id}>
                                      {m.name}
                                    </SelectItem>
                                  ))
                                )}
                              </SelectContent>
                            </Select>
                            <Button
                              size="sm"
                              variant="outline"
                              disabled={
                                !vehicleMerchant[v.id] ||
                                (assignVehicleMerchant.isPending && assigningVehicleId === v.id)
                              }
                              onClick={() => handleAssignVehicle(v.id)}
                            >
                              Assign
                            </Button>
                            {editingVehicleId === v.id && (
                              <Button
                                size="sm"
                                variant="ghost"
                                className="h-7 px-2 text-xs"
                                onClick={() => setEditingVehicleId(null)}
                              >
                                Cancel
                              </Button>
                            )}
                          </div>
                        )}
                      </TableCell>
```

- [ ] **Step 3: Close the override panel after a successful assign**

In `handleAssignVehicle`, inside the `try` block right after `toast({ title: 'Partner assigned' });`, add:

```tsx
      setEditingVehicleId(null);
```

- [ ] **Step 4: Surface the lock error**

In `handleAssignVehicle`'s `catch`, replace the toast with one that explains `P0021` in the user's language:

```tsx
    } catch (err: unknown) {
      const message = (err as Error)?.message ?? '';
      toast({
        title: 'Failed to assign',
        description: message.includes('locked to the partner')
          ? 'This lead came from a partner branch — only your unit manager or an admin can change its partner.'
          : message,
        variant: 'error',
      });
```

- [ ] **Step 5: Typecheck**

```bash
cd apps/agent-portal && npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 6: Verify with the running portal**

Ask the user to confirm, on a branch-sourced lead: a plain agent sees the partner name with no Change button; a unit manager sees a Change button that opens the dropdown and can reassign; an agent-link lead still shows the ordinary Assign dropdown.

- [ ] **Step 7: Commit**

```bash
git rev-parse --abbrev-ref HEAD
git add apps/agent-portal/src/pages/MyEnquiries.tsx
git commit -m "feat(agent): lock branch-sourced leads to their partner, unit viewers may override"
```

---

### Task 4: `staff_id_required` type + admin toggle

**Files:**
- Modify: `packages/shared-types/src/merchant.ts:10-18`
- Modify: `apps/admin-portal/src/pages/merchants/MerchantDetail.tsx` (`FormDesignCard`, lines 207-320)

**Interfaces:**
- Consumes: `MerchantFormSettings`, `useUpdateMerchant()`.
- Produces: `MerchantFormSettings.staff_id_required?: boolean` — read by Task 6 (public form) and Task 5 (SQL reads the same JSON key).

- [ ] **Step 1: Extend the type**

In `packages/shared-types/src/merchant.ts`, inside `MerchantFormSettings`, add:

```ts
  /** Round 8 item 3: this partner's branch forms require the referring Staff ID. */
  staff_id_required?: boolean;
```

- [ ] **Step 2: Make the save boolean-safe**

`handleSave` currently drops every non-string value, which would silently discard the new flag. In `MerchantDetail.tsx` replace the `cleaned` computation with:

```tsx
    // Empty strings mean "use the global setting" — strip them so the public
    // form's per-field fallback works. Booleans are kept when true and dropped
    // when false, so `false` and "unset" store identically (absent = not
    // required). Filtering by `typeof v === 'string'` alone silently discarded
    // the staff_id_required flag.
    const cleaned = Object.fromEntries(
      Object.entries(draft).filter(([, v]) =>
        typeof v === 'boolean' ? v : typeof v === 'string' && v.trim() !== '',
      ),
    ) as MerchantFormSettings;
```

- [ ] **Step 3: Add the switch**

Import `Switch` in the `@agent-system/shared-ui` import list of `MerchantDetail.tsx` if it is not already there, then add this inside `FormDesignCard`'s `<CardContent>`, directly above the `<div className="flex justify-end">` save row:

```tsx
        <div className="flex items-center justify-between rounded-md border p-3">
          <div>
            <Label>Require Staff ID</Label>
            <p className="text-xs text-muted-foreground">
              Customers submitting through this partner's branch links must enter the referring
              staff ID. Enforced on the server, not just in the browser.
            </p>
          </div>
          <Switch
            checked={draft.staff_id_required === true}
            onCheckedChange={(checked) =>
              setDraft((prev) => ({ ...prev, staff_id_required: checked }))
            }
          />
        </div>
```

- [ ] **Step 4: Typecheck both packages**

```bash
pnpm --filter @agent-system/shared-types typecheck
cd apps/admin-portal && npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 5: Verify the flag persists**

Ask the user to turn the switch on for a test partner in admin and save, then confirm with MCP `execute_sql` against staging:

```sql
SELECT name, form_settings FROM merchants WHERE form_settings ? 'staff_id_required';
```

Expected: the partner appears with `"staff_id_required": true`. Turning it off and saving must remove the key (not store `false`).

- [ ] **Step 6: Commit**

```bash
git rev-parse --abbrev-ref HEAD
git add packages/shared-types/src/merchant.ts apps/admin-portal/src/pages/merchants/MerchantDetail.tsx
git commit -m "feat(admin): per-partner Require Staff ID toggle"
```

---

### Task 5: Migration — enforce `staff_id_required` in `submit_enquiry`

**Files:**
- Create: `supabase/migrations/20260808000002_staff_id_required.sql`

**Interfaces:**
- Consumes: the `submit_enquiry` body created in **Task 1** (`20260808000001`) — copy from that file, not from `20260706000009`.
- Produces: `submit_enquiry` raising `P0020` when a branch partner requires a Staff ID and none was given. Task 6 maps that code to a message.

- [ ] **Step 1: Write the migration**

Create `supabase/migrations/20260808000002_staff_id_required.sql` containing the **entire** `submit_enquiry` body from `20260808000001_source_locked_leads.sql`, with one addition: immediately after the branch-path `IF NOT FOUND THEN RAISE ... 'P0001'; END IF;` and before the vehicles-array check, insert

```sql
    -- Round 8 item 3: partners may make the referring Staff ID mandatory.
    -- Client-side validation alone is bypassable by calling this RPC directly,
    -- so the rule lives here. Branch path only -- agent links never show the
    -- field.
    IF EXISTS (
      SELECT 1 FROM merchants m
      WHERE m.id = v_merchant_id
        AND coalesce((m.form_settings->>'staff_id_required')::boolean, false)
    ) AND NULLIF(trim(coalesce(p_staff_id,'')),'') IS NULL THEN
      RAISE EXCEPTION 'Staff ID is required for this partner' USING ERRCODE='P0020';
    END IF;
```

End the file with the same `GRANT EXECUTE ON FUNCTION submit_enquiry(text,text,text,text,text,jsonb,text) TO anon;` line. Do not change the signature.

- [ ] **Step 2: Apply to staging**

MCP `apply_migration` against `lyjdlietzmmejrxjvwgp`, name `staff_id_required`.

- [ ] **Step 3: Verify it rejects and accepts correctly**

Turn the flag on for the branch's merchant, then:

```sql
-- 1. missing staff id -> must raise P0020
SELECT submit_enquiry('<link_code>', 'R8 Staff Test', 'S9999002A', '+60123456780',
  'round8-staff@example.com',
  '[{"car_plate":"R8STAFF1","expiry_date":"2027-01-01","road_tax_renewal":false}]'::jsonb, NULL);

-- 2. with staff id -> must succeed
SELECT submit_enquiry('<link_code>', 'R8 Staff Test', 'S9999003A', '+60123456781',
  'round8-staff2@example.com',
  '[{"car_plate":"R8STAFF2","expiry_date":"2027-01-01","road_tax_renewal":false}]'::jsonb, 'AIDA');
```

Expected: call 1 fails with SQLSTATE `P0020`; call 2 returns a uuid. Then confirm a partner **without** the flag still accepts a NULL staff id.

Clean up:

```sql
DELETE FROM enquiries WHERE customer_nric_normalized IN ('S9999002A','S9999003A');
```

- [ ] **Step 4: Commit**

```bash
git rev-parse --abbrev-ref HEAD
git add supabase/migrations/20260808000002_staff_id_required.sql
git commit -m "feat(db): enforce per-partner mandatory Staff ID in submit_enquiry"
```

---

### Task 6: Public form requires Staff ID when the partner demands it

**Files:**
- Modify: `apps/public-pages/src/pages/Enquiry.tsx` (staff field at lines ~497-511, submit handler ~245-275)

**Interfaces:**
- Consumes: `context.merchant_form_settings.staff_id_required` (already returned by `get_enquiry_context` — that function needs no change, the flag rides inside the existing `jsonb`), `MerchantFormSettings` from Task 4.
- Produces: nothing other tasks consume.

- [ ] **Step 1: Derive the flag**

Next to the existing `const merchantForm = context?.merchant_form_settings ?? null;` (line ~356) add:

```tsx
  // Round 8 item 3. The zod schema is module-level and cannot see this
  // partner-specific flag, so the check runs in the submit handler and the
  // server enforces it again (P0020) for direct RPC calls.
  const staffIdRequired = context?.kind === 'branch' && merchantForm?.staff_id_required === true;
```

- [ ] **Step 2: Make the field say so**

Replace the Staff ID `FormField` block with:

```tsx
              {context?.kind === 'branch' && (
                <FormField
                  control={form.control}
                  name="staff_id"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="text-foreground">
                        Staff ID{staffIdRequired ? ' *' : ''}
                      </FormLabel>
                      <FormControl>
                        <Input
                          placeholder={
                            staffIdRequired ? 'Referring staff ID' : 'Referring staff ID (optional)'
                          }
                          className="h-11"
                          {...field}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              )}
```

- [ ] **Step 3: Block submission client-side**

At the very top of the submit handler (the function that runs the uploads and then calls `supabase.rpc('submit_enquiry', …)`), before any upload work, add:

```tsx
    if (staffIdRequired && !formData.staff_id?.trim()) {
      form.setError('staff_id', { message: 'Staff ID is required' });
      return;
    }
```

Placing it before the uploads matters: otherwise a rejected submission still leaves orphaned files in storage.

- [ ] **Step 4: Map the server error**

In the `rpcError` chain, add before the final `else`:

```tsx
      } else if (rpcError.code === 'P0020') {
        setError('Staff ID is required for this partner. Please enter the referring staff ID.');
```

- [ ] **Step 5: Typecheck**

```bash
cd apps/public-pages && npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 6: Verify both partners in the browser**

Ask the user to open a branch link of the flagged partner and confirm the field is marked required and blocks submission when empty; then open a branch link of an unflagged partner and confirm it still submits with the field empty.

- [ ] **Step 7: Commit**

```bash
git rev-parse --abbrev-ref HEAD
git add apps/public-pages/src/pages/Enquiry.tsx
git commit -m "feat(public): require Staff ID on branch forms when the partner demands it"
```

---

### Task 7: "My Link" moves from Unit Admin to Unit Manager

**Files:**
- Modify: `apps/agent-portal/src/components/Layout.tsx:11-52` (`buildAgentGroups`) and its call site at line ~101-107

**Interfaces:**
- Consumes: `useAuth()` — `role` (`'agent_admin' | 'agent' | …`), `agent.is_unit_manager`.
- Produces: nothing other tasks consume.

- [ ] **Step 1: Change the signature and the comment**

Replace the comment block and signature of `buildAgentGroups` with:

```tsx
// Builds the sidebar for agent/unit users. Sub-agent + business-partner
// MANAGEMENT (My Agents, Event Partners) and unit-wide VIEW pages (Team
// Report) are shown to anyone who is a unit viewer (isUnitViewer): the unit
// admin (agent_admin) plus deputies flagged is_unit_manager.
// isDeputy: a deputy (is_unit_manager, not the unit root — displayed as "Unit
// Admin") has no personal enquiry QR in the sidebar (round 8, item 4). The
// unit root (displayed as "Unit Manager") and plain agents do. Round 6 had
// this the other way round; the root's link codes were restored on 2026-08-02
// (PR #24) after printed QRs went dead, and this puts the nav back in step.
// NOTE: no enquiry_link_code is cleared here. A deputy who already printed a
// QR keeps a working link — hiding the menu item does not break it.
function buildAgentGroups(isUnitViewer: boolean, isDeputy: boolean): NavGroup[] {
```

- [ ] **Step 2: Flip the condition**

Replace

```tsx
  if (!isRoot) {
    partnershipItems.push({ name: 'My Link', href: '/my-link', icon: QrCode });
  }
```

with

```tsx
  if (!isDeputy) {
    partnershipItems.push({ name: 'My Link', href: '/my-link', icon: QrCode });
  }
```

- [ ] **Step 3: Update the call site**

Replace

```tsx
        ? buildAgentGroups(isUnitViewer, role === 'agent_admin')
```

with

```tsx
        ? buildAgentGroups(isUnitViewer, role !== 'agent_admin' && agent?.is_unit_manager === true)
```

Leave the `buildAgentGroups(false, false)` fallback on the next line unchanged.

- [ ] **Step 4: Typecheck**

```bash
cd apps/agent-portal && npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 5: Verify all three roles**

Ask the user to confirm: a Unit Manager (root) now sees Partnership → My Link and the page renders their QR; a Unit Admin (deputy) no longer sees the item; a plain agent still sees it. Also confirm a deputy's previously issued link URL still opens the public enquiry form (paste it in a private window) — it must, since no codes were touched.

- [ ] **Step 6: Commit**

```bash
git rev-parse --abbrev-ref HEAD
git add apps/agent-portal/src/components/Layout.tsx
git commit -m "fix(agent): show My Link to Unit Managers, hide it from Unit Admin deputies"
```

---

### Task 8: Migration — `campaign_units` and unit-scoped campaign visibility

**Files:**
- Create: `supabase/migrations/20260808000003_campaign_units.sql`

**Interfaces:**
- Consumes: `is_admin()`, `agents.parent_agent_id`, existing policy `"Agents read active campaigns"` on `campaigns`.
- Produces: table `campaign_units (campaign_id uuid, unit_agent_id uuid)`; functions `agent_ancestor_ids() RETURNS SETOF uuid` and `campaign_visible_to_me(p_campaign_id uuid) RETURNS boolean`. Task 9 reads and writes `campaign_units` through PostgREST.

- [ ] **Step 1: Write the migration**

Create `supabase/migrations/20260808000003_campaign_units.sql`:

```sql
-- Round 8 item 5: an event is accessible only to the unit(s) assigned to it.
--
-- Before: "Agents read active campaigns" (20260201000001) was
-- USING (status = 'active') with no unit condition, so every agent could
-- browse and create links for every event in the system.
--
-- DEFAULT-OPEN: a campaign with no rows in campaign_units stays visible to
-- everyone, exactly as today. Every existing production event has zero rows
-- the moment this lands, so nothing disappears; scoping begins only when an
-- admin assigns units. The opposite default would empty every agent portal on
-- deploy -- the 2026-08-04 failure mode.

CREATE TABLE IF NOT EXISTS campaign_units (
  campaign_id   uuid NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  unit_agent_id uuid NOT NULL REFERENCES agents(id)    ON DELETE CASCADE,
  created_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (campaign_id, unit_agent_id)
);
CREATE INDEX IF NOT EXISTS idx_campaign_units_unit ON campaign_units(unit_agent_id);

ALTER TABLE campaign_units ENABLE ROW LEVEL SECURITY;

-- Admins manage assignments. Agents never read this table directly -- their
-- visibility runs through campaign_visible_to_me(), which is SECURITY DEFINER
-- and therefore not blocked by the absence of an agent SELECT policy.
CREATE POLICY "Admins manage campaign_units"
  ON campaign_units FOR ALL TO authenticated
  USING (is_admin()) WITH CHECK (is_admin());

-- Upward mirror of unit_member_ids() (20260804000001): the caller's own agent
-- id plus every ancestor. Depth-capped so a hypothetical parent cycle degrades
-- to a short list instead of hanging. Flat COALESCE(parent_agent_id, id) unit
-- derivation is deliberately NOT used -- that assumption is what hid
-- mid-level managers' teams on 2026-08-04.
CREATE OR REPLACE FUNCTION agent_ancestor_ids()
RETURNS SETOF uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH RECURSIVE up AS (
    SELECT a.id, a.parent_agent_id, 0 AS depth
    FROM agents a WHERE a.user_id = auth.uid()
    UNION ALL
    SELECT p.id, p.parent_agent_id, up.depth + 1
    FROM agents p
    JOIN up ON p.id = up.parent_agent_id
    WHERE up.depth < 50
  )
  SELECT id FROM up;
$$;
GRANT EXECUTE ON FUNCTION agent_ancestor_ids() TO authenticated;

-- Visible when unassigned (default-open) or when one of the assigned unit
-- heads is the caller or one of the caller's ancestors. SECURITY DEFINER so
-- the policy does not depend on the caller being able to read campaign_units.
CREATE OR REPLACE FUNCTION campaign_visible_to_me(p_campaign_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT NOT EXISTS (
    SELECT 1 FROM campaign_units cu WHERE cu.campaign_id = p_campaign_id
  ) OR EXISTS (
    SELECT 1 FROM campaign_units cu
    WHERE cu.campaign_id = p_campaign_id
      AND cu.unit_agent_id IN (SELECT agent_ancestor_ids())
  );
$$;
GRANT EXECUTE ON FUNCTION campaign_visible_to_me(uuid) TO authenticated;

DROP POLICY IF EXISTS "Agents read active campaigns" ON campaigns;
CREATE POLICY "Agents read active campaigns"
  ON campaigns FOR SELECT TO authenticated
  USING (status = 'active' AND campaign_visible_to_me(id));
```

- [ ] **Step 2: Apply to staging**

MCP `apply_migration` against `lyjdlietzmmejrxjvwgp`, name `campaign_units`.

- [ ] **Step 3: Confirm nothing disappeared (default-open)**

```sql
SELECT count(*) AS assignments FROM campaign_units;                    -- expect 0
SELECT count(*) AS active_campaigns FROM campaigns WHERE status='active';
```

Record `active_campaigns`. With zero assignments every agent must still see all of them — verified by impersonation in the next step.

- [ ] **Step 4: Verify scoping by impersonation**

Compute the fixture ids FIRST (MCP has no JWT, so `auth.uid()` is NULL and every helper returns empty until impersonation is set):

```sql
-- an agent deep inside a unit, and that unit's top-most root
WITH RECURSIVE up AS (
  SELECT a.id, a.user_id, a.parent_agent_id, a.id AS leaf FROM agents a WHERE a.parent_agent_id IS NOT NULL AND a.user_id IS NOT NULL
  UNION ALL
  SELECT p.id, up.user_id, p.parent_agent_id, up.leaf FROM agents p JOIN up ON p.id = up.parent_agent_id
)
SELECT leaf AS agent_id, user_id, id AS root_id FROM up WHERE parent_agent_id IS NULL LIMIT 1;

SELECT id AS campaign_id FROM campaigns WHERE status='active' LIMIT 1;

-- another unit root, to act as the "wrong unit"
SELECT id FROM agents WHERE parent_agent_id IS NULL AND id <> '<root_id>' LIMIT 1;
```

Then, in one statement block per case:

```sql
-- case A: assigned to the agent's own unit root -> visible
INSERT INTO campaign_units (campaign_id, unit_agent_id) VALUES ('<campaign_id>', '<root_id>');
SET LOCAL role = authenticated;
SELECT set_config('request.jwt.claims', json_build_object('sub','<user_id>','role','authenticated')::text, true);
SELECT count(*) AS visible FROM campaigns WHERE id = '<campaign_id>';   -- expect 1
```

```sql
-- case B: assigned only to a different unit -> invisible
DELETE FROM campaign_units WHERE campaign_id = '<campaign_id>';
INSERT INTO campaign_units (campaign_id, unit_agent_id) VALUES ('<campaign_id>', '<other_root_id>');
SET LOCAL role = authenticated;
SELECT set_config('request.jwt.claims', json_build_object('sub','<user_id>','role','authenticated')::text, true);
SELECT count(*) AS visible FROM campaigns WHERE id = '<campaign_id>';   -- expect 0
```

```sql
-- case C: no assignment -> visible again (default-open)
DELETE FROM campaign_units WHERE campaign_id = '<campaign_id>';
SET LOCAL role = authenticated;
SELECT set_config('request.jwt.claims', json_build_object('sub','<user_id>','role','authenticated')::text, true);
SELECT count(*) AS visible FROM campaigns WHERE id = '<campaign_id>';   -- expect 1
```

Case A is the important one: the impersonated agent is a **grandchild** of the assigned root, so it proves the ancestor walk is recursive rather than one level deep.

Leave staging with zero rows in `campaign_units` after these checks.

- [ ] **Step 5: Confirm public registration is unaffected**

```sql
SET LOCAL role = anon;
SELECT count(*) FROM campaigns;   -- expect the "Public can read campaigns" policy to still return rows
```

Expected: unchanged from before the migration — the anon policy was not touched.

- [ ] **Step 6: Commit**

```bash
git rev-parse --abbrev-ref HEAD
git add supabase/migrations/20260808000003_campaign_units.sql
git commit -m "feat(db): scope events to assigned units, default-open when unassigned"
```

---

### Task 9: Admin — assign units on the event form

**Files:**
- Create: `apps/admin-portal/src/hooks/useCampaignUnits.ts`
- Modify: `apps/admin-portal/src/pages/campaigns/CampaignForm.tsx`
- Modify: `packages/shared-types/src/campaign.ts`

**Interfaces:**
- Consumes: `campaign_units` from Task 8; `useAgents()` (`apps/admin-portal/src/hooks/useAgents.ts`), which already returns unit heads only (`parent_agent_id IS NULL OR is_unit_manager = true`) as `AgentWithTier[]`.
- Produces: `useCampaignUnits(campaignId: string | undefined)` → `UseQueryResult<string[]>` (unit agent ids) and `useSetCampaignUnits()` → mutation taking `{ campaignId: string; unitAgentIds: string[] }`.

- [ ] **Step 1: Add the row type**

In `packages/shared-types/src/campaign.ts`, append:

```ts
/** Round 8 item 5: which unit heads an event is restricted to. No rows = all units. */
export interface CampaignUnit {
  campaign_id: string;
  unit_agent_id: string;
  created_at: string;
}
```

Export it from the package barrel if `campaign.ts` types are re-exported explicitly rather than by `export *` — check `packages/shared-types/src/index.ts` and match whatever pattern is already there.

- [ ] **Step 2: Create the hook**

Create `apps/admin-portal/src/hooks/useCampaignUnits.ts`:

```ts
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';

/**
 * Unit heads an event is restricted to. An empty array means the event is
 * open to every unit — the default-open rule enforced by
 * campaign_visible_to_me() in 20260808000003.
 */
export function useCampaignUnits(campaignId: string | undefined) {
  return useQuery({
    queryKey: ['campaign-units', campaignId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('campaign_units')
        .select('unit_agent_id')
        .eq('campaign_id', campaignId!);
      if (error) throw error;
      return (data ?? []).map((r) => (r as { unit_agent_id: string }).unit_agent_id);
    },
    enabled: !!campaignId,
  });
}

/**
 * Replace-all write: delete the rows that are gone, insert the ones that are
 * new. Done as a diff rather than delete-then-insert-everything so a failed
 * insert cannot leave the event unscoped (i.e. visible to all units).
 */
export function useSetCampaignUnits() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      campaignId,
      unitAgentIds,
    }: {
      campaignId: string;
      unitAgentIds: string[];
    }) => {
      const { data: existingRows, error: readError } = await supabase
        .from('campaign_units')
        .select('unit_agent_id')
        .eq('campaign_id', campaignId);
      if (readError) throw readError;

      const existing = new Set(
        (existingRows ?? []).map((r) => (r as { unit_agent_id: string }).unit_agent_id),
      );
      const wanted = new Set(unitAgentIds);
      const toRemove = [...existing].filter((id) => !wanted.has(id));
      const toAdd = [...wanted].filter((id) => !existing.has(id));

      if (toAdd.length > 0) {
        const { error } = await supabase
          .from('campaign_units')
          .insert(toAdd.map((unit_agent_id) => ({ campaign_id: campaignId, unit_agent_id })));
        if (error) throw error;
      }
      if (toRemove.length > 0) {
        const { error } = await supabase
          .from('campaign_units')
          .delete()
          .eq('campaign_id', campaignId)
          .in('unit_agent_id', toRemove);
        if (error) throw error;
      }
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ['campaign-units', variables.campaignId] });
    },
  });
}
```

- [ ] **Step 3: Hold the selection in the form**

In `CampaignForm.tsx`, add the imports

```tsx
import { Checkbox } from '@agent-system/shared-ui';
import { useAgents } from '../../hooks/useAgents';
import { useCampaignUnits, useSetCampaignUnits } from '../../hooks/useCampaignUnits';
import { useState } from 'react';
```

(merge `useState` into the existing `react` import rather than duplicating it, and add `Checkbox` to the existing `@agent-system/shared-ui` import list), then inside the component after `const updateCampaign = useUpdateCampaign();`:

```tsx
  const { data: unitHeads } = useAgents();
  const { data: assignedUnitIds } = useCampaignUnits(campaignId);
  const setCampaignUnits = useSetCampaignUnits();
  // Unit ids selected in the form. Empty = event open to every unit.
  const [selectedUnitIds, setSelectedUnitIds] = useState<string[]>([]);
```

and, next to the existing `useEffect` that resets the form from `campaign`, add:

```tsx
  useEffect(() => {
    if (assignedUnitIds) setSelectedUnitIds(assignedUnitIds);
  }, [assignedUnitIds]);
```

- [ ] **Step 4: Save the units alongside the campaign**

In `onSubmit`, replace the create/update branch with:

```tsx
      if (isEditing && campaignId) {
        await updateCampaign.mutateAsync({ id: campaignId, ...payload });
        await setCampaignUnits.mutateAsync({ campaignId, unitAgentIds: selectedUnitIds });
      } else {
        const created = await createCampaign.mutateAsync({ ...payload, checkout_config: { fb_enabled: false, fb_url: '', video_enabled: false, video_url: '', rating_enabled: false } });
        if (selectedUnitIds.length > 0) {
          await setCampaignUnits.mutateAsync({ campaignId: created.id, unitAgentIds: selectedUnitIds });
        }
      }
```

- [ ] **Step 5: Render the picker**

Add this card inside the form, after the card holding the existing switches (`nric_required`) and before the submit buttons:

```tsx
      <Card>
        <CardHeader>
          <CardTitle>Units</CardTitle>
          <CardDescription>
            Restrict this event to specific units. Leave everything unticked to keep it open to
            every unit — that is how all existing events behave.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="max-h-64 space-y-2 overflow-auto rounded-md border p-3">
            {(unitHeads ?? []).length === 0 ? (
              <p className="text-sm text-muted-foreground">No units found.</p>
            ) : (
              (unitHeads ?? []).map((u) => (
                <label key={u.id} className="flex items-center gap-2 text-sm">
                  <Checkbox
                    checked={selectedUnitIds.includes(u.id)}
                    onCheckedChange={(checked) =>
                      setSelectedUnitIds((prev) =>
                        checked ? [...prev, u.id] : prev.filter((id) => id !== u.id),
                      )
                    }
                  />
                  <span>
                    {u.unit_name || u.name}
                    <span className="text-muted-foreground"> · {u.agent_code}</span>
                  </span>
                </label>
              ))
            )}
          </div>
          <p className="mt-2 text-xs text-muted-foreground">
            {selectedUnitIds.length === 0
              ? 'Open to all units'
              : `Restricted to ${selectedUnitIds.length} unit(s)`}
          </p>
        </CardContent>
      </Card>
```

- [ ] **Step 6: Typecheck**

```bash
pnpm --filter @agent-system/shared-types typecheck
cd apps/admin-portal && npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 7: Verify the round trip**

Ask the user to tick one unit on an existing event, save, reopen the form (the tick must persist), then confirm in staging:

```sql
SELECT c.name, a.unit_name, a.agent_code
FROM campaign_units cu
JOIN campaigns c ON c.id = cu.campaign_id
JOIN agents a ON a.id = cu.unit_agent_id;
```

Then have an agent from a different unit reload their portal — the event must be gone from their Events list — and an agent inside the assigned unit confirm it is still there. Finally untick and save: the event returns for everyone.

- [ ] **Step 8: Commit**

```bash
git rev-parse --abbrev-ref HEAD
git add packages/shared-types/src/campaign.ts apps/admin-portal/src/hooks/useCampaignUnits.ts apps/admin-portal/src/pages/campaigns/CampaignForm.tsx
git commit -m "feat(admin): assign units to an event, empty selection means all units"
```

---

### Task 10: Full build and cross-app check

**Files:** none modified.

**Interfaces:**
- Consumes: everything from Tasks 1-9.
- Produces: a green build, the gate for Task 11.

- [ ] **Step 1: Build every app**

```bash
pnpm build
```

Expected: all three apps build. `pnpm build` runs `tsc && vite build` per app, so this is the only gate that typechecks admin, agent and public together.

- [ ] **Step 2: Re-read the two files touched by more than one task**

`apps/agent-portal/src/pages/MyEnquiries.tsx` was edited by Tasks 2 and 3. Read the `EnquiryCard` header and the Partner cell end to end and confirm: the source line renders once, `editingVehicleId` is declared once, and no duplicate `<TableCell>` survived the replacement.

- [ ] **Step 3: Commit if anything needed fixing**

```bash
git rev-parse --abbrev-ref HEAD
git add -A
git commit -m "chore: round 8 build fixes"
```

Skip this step if the build was clean and nothing changed.

---

### Task 11: Deploy to production and verify

**Files:** none modified.

**Interfaces:**
- Consumes: the three migrations, verified on staging.
- Produces: production parity. Frontend merges only after this task passes.

- [ ] **Step 1: Confirm what production is missing**

MCP `list_migrations` against `mjtdsevynrtcmafsnxsj`. Confirm none of the round-8 migrations is present. Production version numbers are timestamps unrelated to repo filename prefixes — compare by content/name, not by number.

- [ ] **Step 2: Count the production backfill before applying**

Run the `will_backfill` query from Task 1 Step 2 against `mjtdsevynrtcmafsnxsj`. Record the number and report it to the user before proceeding — this is the count of live leads whose partner is about to be filled in.

- [ ] **Step 3: Apply the three migrations in order**

MCP `apply_migration` against `mjtdsevynrtcmafsnxsj`, in this order:

1. `source_locked_leads` (`20260808000001`)
2. `staff_id_required` (`20260808000002`)
3. `campaign_units` (`20260808000003`)

Order matters: `20260808000002` recreates the `submit_enquiry` written by `20260808000001`.

- [ ] **Step 4: Re-run the post-conditions on production**

- `still_null` and `money_mismatch` from Task 1 Step 4 → both 0.
- `SELECT count(*) FROM campaign_units;` → 0 (default-open, nothing scoped yet).
- `SELECT count(*) FROM campaigns WHERE status='active';` → unchanged from before.
- `SELECT proname FROM pg_proc WHERE proname IN ('agent_ancestor_ids','campaign_visible_to_me');` → both present.

- [ ] **Step 5: Check the client's actual leads**

The two leads named in the feedback (Teechunyin / WWP 4176 and Zita Aizan Binti Ahmad / BRC2790):

```sql
SELECT e.customer_name, ev.car_plate, m.name AS partner, b.name AS branch, e.staff_id
FROM enquiry_vehicles ev
JOIN enquiries e ON e.id = ev.enquiry_id
LEFT JOIN merchants m ON m.id = ev.merchant_id
LEFT JOIN merchant_branches b ON b.id = e.merchant_branch_id
WHERE ev.car_plate_normalized IN ('WWP4176','BRC2790');
```

Expected: `partner` reads Poh Kong (not NULL) and `branch` names the Shah Alam branch. Report the actual rows to the user — this is the check they will make themselves.

- [ ] **Step 6: Get advisor review, then hand over**

Run `advisor()`. Then report to the user: the backfill counts for staging and production, the verification output from Step 5, and that the frontend is ready to merge. Do not merge or push to `main` without the user asking.

---

## Self-Review

**Spec coverage**

| Spec section | Task(s) |
| --- | --- |
| Item 1 — seed car partner at submit | 1 |
| Item 1 — lock guard + `P0021` | 1 (SQL), 3 (UI + message) |
| Item 1 — source-always-assignable clause | 1 |
| Item 1 — backfill open cars only | 1 (steps 2, 4) |
| Item 1 — locked display, unit-viewer override | 3 |
| Item 1 — admin path unchanged (renewal dialog) | none needed; asserted in Task 1's header comment |
| Item 2 — Staff ID + source on agent card | 2 |
| Item 3 — `staff_id_required` type + admin toggle + boolean-safe save | 4 |
| Item 3 — server enforcement `P0020` | 5 |
| Item 3 — public form required field + error message | 6 |
| Item 4 — nav swap, no link codes touched | 7 |
| Item 5 — `campaign_units`, `agent_ancestor_ids()`, policy, default-open | 8 |
| Item 5 — admin units picker | 9 |
| Item 5 — public/anon untouched | 8 (step 5) |
| Deployment: staging → prod, MCP only, impersonation | 1, 5, 8 (staging), 11 (prod) |

No spec requirement is unassigned.

**Type consistency**

- `MerchantFormSettings.staff_id_required?: boolean` — defined in Task 4, read by Task 6 (`merchantForm?.staff_id_required === true`) and by Task 5's SQL (`form_settings->>'staff_id_required'`). Same key spelling in all three.
- `buildAgentGroups(isUnitViewer: boolean, isDeputy: boolean)` — renamed parameter used consistently in the signature, the body and the call site within Task 7.
- `useCampaignUnits(campaignId)` returns `string[]`; `useSetCampaignUnits()` takes `{ campaignId, unitAgentIds }`. Task 9 steps 3-4 call both with exactly those names.
- `agent_ancestor_ids()` and `campaign_visible_to_me(uuid)` — defined and referenced only in Task 8, and asserted present in Task 11 step 4.
- `isSourceLocked` / `editingVehicleId` — declared in Task 3 step 1, used in Task 3 steps 2-3 only.
