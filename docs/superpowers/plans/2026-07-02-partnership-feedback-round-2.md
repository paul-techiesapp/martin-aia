# Merchant Partnership — Feedback Round 2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans (inline) or superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Ship 8 round-2 feedback items for the merchant-partnership subsystem (per-car partner assignment, branch↔any-agent, Unit Manager role, QR save-as-photo, admin email, universal enquiry notifications, unit-admin partner proposal, admin-managed form branding).

**Architecture:** Additive DB migrations (no destructive changes to live checkout/enquiry tables) + one edge-function redeploy + hooks/UI across admin-portal, agent-portal, public-pages. Spec: `docs/superpowers/specs/2026-07-02-partnership-feedback-round-2-design.md`.

**Tech Stack:** React 18 + Vite + TanStack Router/Query, Supabase (Postgres RLS, edge functions Deno), shadcn/ui, `qrcode` + `qrcode.react`.

## Global Constraints
- **No test runner in this repo.** Verify every code task with `pnpm -r typecheck` and `pnpm --filter <app> build`. There is no jest/eslint; do NOT invent test files.
- **Keep a single zod version** — do NOT `pnpm add` anything that re-trips the dual-zod tsc failure. No new runtime deps needed (`qrcode` already in agent-portal).
- **DB changes staging-first:** author migration → apply to staging `lyjdlietzmmejrxjvwgp` via MCP `apply_migration` → verify → apply to prod `mjtdsevynrtcmafsnxsj` (per [[prod-migration-apply-method]]). Commit the `.sql` files to the repo too.
- **Commits are branch-guarded to `feat/merchant-partnership`.** Never commit on main.
- **Single Supabase client** (re-export from shared-ui); never `createClient` in an app.
- **Migrations additive only:** `ADD COLUMN IF NOT EXISTS`, `CREATE OR REPLACE`, `CREATE POLICY` with `DROP POLICY IF EXISTS` first. Do not touch `campaigns/registrations/slots/attendance` columns.
- Edge fns keep their current `verify_jwt` setting (send-enquiry-notification = false).

---

## Phase 1 — Database migrations

### Task 1: Per-car partner assignment RPC (item 1)

**Files:**
- Create: `supabase/migrations/20260702000001_assign_vehicle_merchant.sql`

**Interfaces:**
- Produces: `assign_vehicle_merchant(p_vehicle_id uuid, p_merchant_id uuid) RETURNS void` (GRANT authenticated)

- [ ] **Step 1: Write the migration**

```sql
-- Agent assigns a partner PER CAR (enquiry_vehicles.merchant_id) instead of per enquiry.
-- Mirrors assign_enquiry_merchant guards but keyed on the vehicle's parent enquiry.
CREATE OR REPLACE FUNCTION assign_vehicle_merchant(p_vehicle_id uuid, p_merchant_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_agent_id uuid := get_agent_id();
BEGIN
  IF v_agent_id IS NULL THEN RAISE EXCEPTION 'Not an agent' USING ERRCODE='42501'; END IF;
  IF NOT EXISTS (SELECT 1 FROM merchants WHERE id = p_merchant_id AND status = 'active') THEN
    RAISE EXCEPTION 'Partnership not found or not active' USING ERRCODE='P0001'; END IF;
  UPDATE enquiry_vehicles ev
     SET merchant_id = p_merchant_id
    FROM enquiries e
   WHERE ev.id = p_vehicle_id
     AND e.id = ev.enquiry_id
     AND e.agent_id = v_agent_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Vehicle not found or not yours' USING ERRCODE='42501'; END IF;
END;
$$;
GRANT EXECUTE ON FUNCTION assign_vehicle_merchant(uuid, uuid) TO authenticated;
```

- [ ] **Step 2:** Apply to staging via MCP `apply_migration` (project `lyjdlietzmmejrxjvwgp`, name `20260702000001_assign_vehicle_merchant`).
- [ ] **Step 3:** Verify: `SELECT pg_get_functiondef('assign_vehicle_merchant(uuid,uuid)'::regprocedure);` returns the function on staging.
- [ ] **Step 4: Commit** `git add supabase/migrations/20260702000001_assign_vehicle_merchant.sql && git commit -m "feat(partnership): assign_vehicle_merchant RPC (per-car partner)"`

---

### Task 2: Unit Manager role (item 3)

**Files:**
- Create: `supabase/migrations/20260702000002_unit_manager.sql`

**Interfaces:**
- Produces: `agents.is_unit_manager boolean`; `get_unit_root() returns uuid`; additive unit-scope SELECT RLS covering unit managers on `agents`, `registrations`, `rewards`, `attendance`, `agent_links`.

- [ ] **Step 1: Write the migration**

```sql
-- Item 3(a): Unit Manager = an agent flagged is_unit_manager who gets the SAME unit-wide
-- view as a Unit Admin (parent_agent_id IS NULL), scoped to their unit root.
ALTER TABLE agents ADD COLUMN IF NOT EXISTS is_unit_manager boolean NOT NULL DEFAULT false;

-- Unit root of the CURRENT caller: their parent if a sub-agent, else themselves.
CREATE OR REPLACE FUNCTION get_unit_root()
RETURNS uuid
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(a.parent_agent_id, a.id)
  FROM agents a WHERE a.user_id = auth.uid();
$$;

-- Whether the caller may view their whole unit (unit admin OR unit manager).
CREATE OR REPLACE FUNCTION is_unit_viewer()
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM agents a
    WHERE a.user_id = auth.uid()
      AND (a.parent_agent_id IS NULL OR a.is_unit_manager)
  );
$$;

-- Set of agent ids in the caller's unit (root + all agents whose root matches).
-- Reuse in RLS via: agent_id IN (SELECT unit_member_ids())
CREATE OR REPLACE FUNCTION unit_member_ids()
RETURNS SETOF uuid
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT a.id FROM agents a
  WHERE is_unit_viewer()
    AND COALESCE(a.parent_agent_id, a.id) = get_unit_root();
$$;

-- Extend unit-scope SELECT RLS to unit managers (additive; existing unit-admin
-- policies stay). Idempotent create.
DROP POLICY IF EXISTS "Unit viewers read unit agents" ON agents;
CREATE POLICY "Unit viewers read unit agents" ON agents
  FOR SELECT TO authenticated
  USING (id IN (SELECT unit_member_ids()));

DROP POLICY IF EXISTS "Unit viewers read unit registrations" ON registrations;
CREATE POLICY "Unit viewers read unit registrations" ON registrations
  FOR SELECT TO authenticated
  USING (agent_id IN (SELECT unit_member_ids()));

DROP POLICY IF EXISTS "Unit viewers read unit rewards" ON rewards;
CREATE POLICY "Unit viewers read unit rewards" ON rewards
  FOR SELECT TO authenticated
  USING (agent_id IN (SELECT unit_member_ids()));

DROP POLICY IF EXISTS "Unit viewers read unit attendance" ON attendance;
CREATE POLICY "Unit viewers read unit attendance" ON attendance
  FOR SELECT TO authenticated
  USING (registration_id IN (
    SELECT r.id FROM registrations r WHERE r.agent_id IN (SELECT unit_member_ids())
  ));

DROP POLICY IF EXISTS "Unit viewers read unit links" ON agent_links;
CREATE POLICY "Unit viewers read unit links" ON agent_links
  FOR SELECT TO authenticated
  USING (agent_id IN (SELECT unit_member_ids()));
```

- [ ] **Step 2:** Confirm the existing unit-admin RLS policy NAMES (`20260617000001_unit_admin_report_rls.sql`) differ from the new ones above so we don't collide — the new policies are ADDITIVE (OR-combined). If a name matches, rename the new one.
- [ ] **Step 3:** Apply to staging (`lyjdlietzmmejrxjvwgp`).
- [ ] **Step 4:** Verify on staging: set `is_unit_manager=true` on a test sub-agent, confirm `unit_member_ids()` returns the unit set (query as that user is hard via MCP; instead assert the functions exist and `SELECT unit_member_ids` compiles). Sanity: `SELECT proname FROM pg_proc WHERE proname IN ('get_unit_root','is_unit_viewer','unit_member_ids');`
- [ ] **Step 5: Commit.**

---

### Task 3: Universal enquiry notification (item 6)

**Files:**
- Create: `supabase/migrations/20260702000003_enquiry_notify_all.sql`

- [ ] **Step 1: Write the migration** — redefine `submit_enquiry` identical to `20260630000003_submit_enquiry_roadtax.sql` EXCEPT the final notify line changes from `IF v_agent_id IS NOT NULL THEN PERFORM notify_agent_enquiry(v_enquiry_id); END IF;` to an unconditional `PERFORM notify_agent_enquiry(v_enquiry_id);`. (Copy the full latest body verbatim from that migration; change only that one line. The edge function decides recipients.)

- [ ] **Step 2:** Apply to staging; `SELECT pg_get_functiondef('submit_enquiry(text,text,text,text,text,jsonb)'::regprocedure)` and confirm the guard is gone.
- [ ] **Step 3: Commit.**

---

### Task 4: Shared form branding config (item 8)

**Files:**
- Create: `supabase/migrations/20260702000004_form_branding.sql`

- [ ] **Step 1: Write the migration**

```sql
-- Item 8: one admin-managed logo + footer shared across ALL public forms
-- (events register/checkout/display + partnership enquiry). Anon-readable
-- (system_settings already has anon read). Per-form titles stay hardcoded.
ALTER TABLE system_settings
  ADD COLUMN IF NOT EXISTS form_branding JSONB NOT NULL DEFAULT jsonb_build_object(
    'logo_url', '',
    'footer_text', '© RACC Agency. All rights reserved.'
  );
```

- [ ] **Step 2:** Apply to staging; confirm column + default.
- [ ] **Step 3: Commit.**

---

## Phase 2 — Edge function (item 6)

### Task 5: send-enquiry-notification → also email admin catch-all

**Files:**
- Modify: `supabase/functions/send-enquiry-notification/index.ts`

**Change:** After loading the enquiry, ALSO read `system_settings.admin_notification_email`. Build the recipient list = `[agent.email (if present), adminEmail (if present)]`, de-duplicated. Remove the hard `!agent?.email → skip`; instead skip only when the recipient list is empty OR `RESEND_API_KEY` unset. Send the same HTML to each recipient (loop `sendResendEmail`). Return `{ recipients: [...], sent_count }`.

- [ ] **Step 1:** Edit the function per above (keep m2m auth check, graceful degradation).
- [ ] **Step 2:** Deploy to staging (`lyjdlietzmmejrxjvwgp`, name `send-enquiry-notification`, verify_jwt=false, bundle index.ts only).
- [ ] **Step 3:** Smoke-test on staging with a bogus enquiry_id + service bearer → expect 404 (auth OK, not 403). Use the staging service key (bootstrap same as prod if needed).
- [ ] **Step 4: Commit** the edited `index.ts`.

---

## Phase 3 — Shared types & hooks

### Task 6: Types + hooks

**Files:**
- Modify: `packages/shared-types/src/merchant.ts` (add `is_unit_manager?: boolean` to Agent-ish type if present; add per-car merchant already exists) — verify where the Agent type lives; may be shared-types database.ts.
- Create: `apps/admin-portal/src/hooks/useAllAgents.ts` (item 2)
- Create: `apps/agent-portal/src/hooks/useAssignVehicleMerchant.ts` (item 1) OR extend `useMyEnquiryLink.ts`
- Modify: `apps/admin-portal/src/hooks/useAgents.ts` mutation to allow `is_unit_manager` on update (item 3)

- [ ] **Step 1:** `useAllAgents()` — copy `useAgents()` but drop `.is('parent_agent_id', null)` and add `.eq('status','active')`; queryKey `['all-agents']`.
- [ ] **Step 2:** `useAssignVehicleMerchant(agentId)` — mutation calling `supabase.rpc('assign_vehicle_merchant',{p_vehicle_id, p_merchant_id})`, invalidates `['my-enquiries', agentId]`.
- [ ] **Step 3:** Ensure the agent update hook (admin) includes `is_unit_manager` in its update payload/type.
- [ ] **Step 4:** `pnpm -r typecheck`. **Commit.**

---

## Phase 4 — Admin-portal UI

### Task 7: Branch picker lists all agents (item 2)
- Modify: `apps/admin-portal/src/pages/merchants/MerchantDetail.tsx:79` → use `useAllAgents()` instead of `useAgents()` for the branch-link agent picker.
- [ ] Build admin-portal; verify picker shows sub-agents. Commit.

### Task 8: Unit Manager toggle on agent form (item 3)
- Modify: `apps/admin-portal/src/pages/agents/AgentForm.tsx` — add a "Unit Manager" checkbox/switch bound to `is_unit_manager`; include in create/update payloads. (create-agent edge fn may need to accept it — check; if agents are updated directly via supabase update, just add the field.)
- [ ] Build; commit.

### Task 9: Approve pending partners (item 7 admin side)
- Modify: `apps/admin-portal/src/pages/merchants/MerchantList.tsx` — show pending merchants (status='pending') with an "Approve" button calling `supabase.rpc('approve_merchant',{merchant_uuid})`; invalidate merchants query. (Read hook may already return all statuses — verify `useMerchants`.)
- [ ] Build; commit.

### Task 10: Form Branding settings card (item 8 admin side)
- Modify: `apps/admin-portal/src/pages/Settings.tsx` (+ `useSystemSettings.ts`) — add a "Form Branding" card: Logo URL + Footer Text inputs bound to `system_settings.form_branding`; save via an update hook (extend `useUpdateEnquirySettings` or add `useUpdateFormBranding`).
- [ ] Build; commit.

---

## Phase 5 — Agent-portal UI

### Task 11: Per-car partner assignment UI (item 1)
- Modify: `apps/agent-portal/src/pages/MyEnquiries.tsx` — remove the enquiry-header Select (L114-153); inside each vehicle row (the `enq.vehicles.map`) render a per-vehicle partner Select (options from `useAgentMerchants` active) + Assign button calling `useAssignVehicleMerchant`; show `v.merchant?.name` once assigned. Per-vehicle selection state (map by vehicle id).
- [ ] Build; commit.

### Task 12: Save QR as photo (item 4)
- Modify: `apps/agent-portal/src/pages/MyEnquiryLink.tsx` — add `import QRCode from 'qrcode'`; a "Save as photo" outline Button beside Copy Link; handler `await QRCode.toDataURL(enquiryUrl(code),{width:512,margin:1})` → anchor download `my-enquiry-qr.png`; toast.
- [ ] Build; commit.

### Task 13: Propose Partner (item 7 agent side, unit admins only)
- Create/modify agent-portal Partnerships page — for `role==='agent_admin'` show a "Propose Partner" dialog using existing `useProposeMerchant` (status pending). Show pending state.
- Modify `useAuth` if needed to also expose `is_unit_manager` capability (item 3 agent side) so unit managers see unit-scoped pages.
- [ ] Build; commit.

---

## Phase 6 — Public-pages (item 8)

### Task 14: Shared branding on all public forms
- Create: `apps/public-pages/src/hooks/useFormBranding.ts` (anon read of `system_settings.form_branding`, merged over defaults) — mirror `useEnquiryFormSettings.ts`.
- Modify: `Register.tsx`, `CheckOut.tsx`, `Display.tsx` — render `logo_url` (fallback to `<Logo/>`) in header and `footer_text` in a footer; keep existing titles.
- Modify: `Enquiry.tsx` — source logo/footer from `form_branding` (fallback to its `enquiry_form` values) so branding is consistent; keep title/subtitle/tnc from `enquiry_form`.
- [ ] Build public-pages; commit.

---

## Phase 7 — Deploy & config

### Task 15: Apply migrations + deploy to PROD
- [ ] Apply the 4 migrations (Tasks 1–4) to prod `mjtdsevynrtcmafsnxsj` via MCP `apply_migration`, in order.
- [ ] Parity-check key function defs (submit_enquiry, assign_vehicle_merchant, unit funcs) prod vs staging via `md5(pg_get_functiondef(...))`.
- [ ] Deploy `send-enquiry-notification` to prod (verify_jwt=false); smoke-test (bogus enquiry → 404).
- [ ] **Item 5:** `UPDATE system_settings SET admin_notification_email='azrisk1234@gmail.com';` on prod (and staging).
- [ ] Run `get_advisors` security on prod for the new objects (expect no ERROR).

### Task 16: Ship frontends
- [ ] `pnpm -r typecheck` and build all 3 apps clean.
- [ ] Merge `feat/merchant-partnership` → `main` (PR, clean-merge check) → Render redeploys 3 sites.
- [ ] Confirm all 3 Render deploys `live`.

### Task 17: Verify end-to-end
- [ ] Item 6: real pg_net path already proven; confirm an enquiry with no agent still emails admin (bogus/staging test).
- [ ] Update memory: round-2 shipped.

---

## Self-Review notes
- **Spec coverage:** items 1(Task1,6,11) 2(Task6,7) 3(Task2,6,8,13) 4(Task12) 5(Task15) 6(Task3,5) 7(Task9,13) 8(Task4,10,14) — all covered.
- **Open risk:** item 3 role model is the recommended interpretation of option (a); confirm with user before the prod migration if unsure. RLS policy-name collisions with existing unit-admin policies must be checked (Task 2 Step 2).
- **Verification** is build/typecheck + staging + prod parity (no unit tests in repo).
