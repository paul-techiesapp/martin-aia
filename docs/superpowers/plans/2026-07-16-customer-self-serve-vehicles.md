# Customer Self-Serve Vehicle List Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give each customer a permanent, unauthenticated URL where they can view, add and remove their own cars.

**Architecture:** A token table keyed on the customer's normalized NRIC (there is no `customers` table — a "customer" is every `enquiries` row sharing a `customer_nric_normalized`). Anon reaches nothing directly: three `SECURITY DEFINER` RPCs granted `TO anon` are the only surface. Removal is a soft-delete (`removed_at`), which ripples into every site that counts vehicles.

**Tech Stack:** PostgreSQL 15 (Supabase), plpgsql, React 18 + TypeScript, TanStack Router + Query, react-hook-form + zod, shadcn/ui via `@agent-system/shared-ui`.

**Spec:** `docs/superpowers/specs/2026-07-16-customer-agent-reassign-and-self-serve-design.md` (Feature 2). Feature 1 shipped separately in `2026-07-16-customer-agent-reassignment.md`.

## Global Constraints

- **Branch-guard every commit.** Run `git branch --show-current` and confirm it is `feat/customer-self-serve-vehicles` before every `git commit`. This repo's working tree is shared across concurrent workflows and HEAD has thrashed before.
- **No test runner and no eslint.** Validation is `pnpm -r typecheck` (packages ONLY — the three apps define no typecheck script) plus `pnpm --filter <app> build`, whose script is `tsc && vite build` — **that build is what actually typechecks app code**. Plus SQL assertions against staging. Do not add a test framework.
- **Keep all packages on zod 3.23.8.** Do not run `pnpm add`; it re-trips a known dual-zod tsc failure in `Account.tsx`.
- **Never call `createClient()` in an app.** `apps/public-pages/src/lib/supabase.ts` re-exports the single shared client; a second client races the single-use refresh token. Import from `../lib/supabase`.
- **Migration naming:** `20260716000002_*.sql` onward. `20260716000001_customer_agent_reassignment.sql` is taken (already in prod).
- **Migration header style:** plain `--` rationale narrative naming what was wrong before and the new invariant. No banner separators.
- **SQL function boilerplate:** `SECURITY DEFINER` + `SET search_path = public`, closed with `GRANT EXECUTE ON FUNCTION <name>(<argtypes>) TO anon;` or `TO authenticated;`.
- **Anon RLS rule (established, do not break):** `enquiries` and `enquiry_vehicles` have ZERO anon policies. All public writes go through `SECURITY DEFINER` RPCs. `insurance_products` is the ONLY table with an anon policy.
- **Error codes:** `P0012` invalid/revoked/non-matching token, `P0013` cannot remove a renewed/lost vehicle. Already reserved by the spec. **Taken, do not reuse:** `P0001`–`P0009` (enquiry/registration flows), `P0010` (checkout OTP), `P0011` + `22023` (Feature 1), `42501` (authz).
- **Staging:** `lyjdlietzmmejrxjvwgp`. **Production:** `mjtdsevynrtcmafsnxsj`. Apply prod migrations via MCP `apply_migration` — **never** `supabase db push`.
- **PII rule:** mask the NRIC **in the RPC**, not in the page. Anything an RPC returns sits in the network response regardless of what the UI renders. Precedent: `merchant_branch_leads` deliberately omits NRIC/phone/email.

## Spec refinements made while planning (deviations from the spec text)

1. **`customer_add_vehicle` takes no `p_insurance_product_id`.** The spec listed one, but the live gold form has **no product picker** — the field was dropped from the UI when `20260629000001` made the column nullable, so it is always NULL in practice. Adding a picker only on the self-serve page would be inconsistent and is not requested. The column stays NULL.
2. **No attachment upload.** The public enquiry form requires a Covernote/Geran upload; self-serve add does not. Out of scope, not requested.
3. **The token hangs off the NRIC, not off an enquiry.** A `my_cars_token` column on `enquiries` would give a customer with two enquiries two tokens and two disjoint car lists. `customer_portal_tokens.nric_normalized UNIQUE` is what makes one customer = one link.

---

## File Structure

| File | Responsibility |
|---|---|
| `supabase/migrations/20260716000002_customer_portal_tokens.sql` | Token table, `removed_at` columns, `ensure_customer_portal_token`, `revoke_customer_portal_token` |
| `supabase/migrations/20260716000003_customer_self_serve_rpcs.sql` | The three anon RPCs |
| `supabase/migrations/20260716000004_removed_at_ripple.sql` | Patch every existing function that counts vehicles |
| `packages/shared-types/src/merchant.ts` | `CustomerPortalToken` type; `removed_at`/`removed_by_customer` on `EnquiryVehicle` |
| `apps/public-pages/src/pages/MyCars.tsx` | The customer-facing page |
| `apps/public-pages/src/router.tsx` | Route registration |
| `apps/agent-portal/src/pages/MyEnquiries.tsx` + hook | Copy-link button; hide removed cars |
| `apps/admin-portal/src/pages/enquiries/*` + hook | Copy-link, revoke, show removed cars marked |

---

### Task 1: Migration — token table, soft-delete columns, token RPCs

**Files:**
- Create: `supabase/migrations/20260716000002_customer_portal_tokens.sql`

**Interfaces:**
- Consumes: `is_admin()` (`20260613000001`), `get_agent_id()` (`20260201000001`), `unit_member_ids()` (`20260702000002`), `enquiries`, `enquiry_vehicles`.
- Produces: table `customer_portal_tokens(token text PK, nric_normalized text UNIQUE NOT NULL, created_at timestamptz, revoked_at timestamptz)`; columns `enquiry_vehicles.removed_at timestamptz NULL`, `enquiry_vehicles.removed_by_customer boolean NOT NULL DEFAULT false`; `ensure_customer_portal_token(p_enquiry_id uuid) RETURNS text` (authenticated); `revoke_customer_portal_token(p_token text) RETURNS void` (authenticated, admin-only). Tasks 2, 4, 6, 7 depend on these exact names.

- [ ] **Step 1: Write the migration**

Create `supabase/migrations/20260716000002_customer_portal_tokens.sql`:

```sql
-- Customer self-serve vehicle list: the permanent per-customer link.
--
-- There is no customers table: a "customer" is every enquiries row sharing a
-- customer_nric_normalized. The token therefore hangs off the NRIC, not off an
-- enquiry — a my_cars_token column on enquiries would give a customer with two
-- enquiries two tokens and two disjoint car lists, which is exactly the thing
-- this feature exists to avoid.
--
-- The link is permanent and unauthenticated (matching agents.enquiry_link_code
-- and branch_links.link_code, which are also permanent random codes). It is
-- revocable instead of expiring, because a customer who hits a dead link just
-- calls their agent. NRIC is masked by the read RPC, so a leaked link does not
-- disclose a full IC.
--
-- Removal of a car is a SOFT delete. A renewed car has a gifts voucher and a
-- merchant_settlements row attached, so hard-deleting one would strand money
-- records; and an agent needs to see that a lead existed even after the
-- customer withdrew it. removed_at is the single source of truth and every
-- site that counts vehicles must exclude it (see 20260716000004).

CREATE TABLE customer_portal_tokens (
  token           text PRIMARY KEY,
  nric_normalized text NOT NULL UNIQUE,
  created_at      timestamptz NOT NULL DEFAULT now(),
  revoked_at      timestamptz
);

ALTER TABLE customer_portal_tokens ENABLE ROW LEVEL SECURITY;

-- NO anon policy: anon reaches this table only through the SECURITY DEFINER
-- RPCs in 20260716000003, matching the rule set in 20260627000002.
-- Read-only for admins; the RPCs below are SECURITY DEFINER and write directly.
CREATE POLICY "Admins read customer_portal_tokens"
  ON customer_portal_tokens FOR SELECT TO authenticated USING (is_admin());

ALTER TABLE enquiry_vehicles
  ADD COLUMN removed_at          timestamptz,
  ADD COLUMN removed_by_customer boolean NOT NULL DEFAULT false;

-- Partial index: every hot query filters removed_at IS NULL.
CREATE INDEX idx_enquiry_vehicles_live
  ON enquiry_vehicles (enquiry_id) WHERE removed_at IS NULL;

-- Get-or-create, mirroring ensure_my_enquiry_link() (20260629000010).
-- Callable by the enquiry's owning agent, a unit viewer of that agent, or an
-- admin. The admin path matters: it is the fallback when the agent has resigned
-- and cannot share the link themselves.
CREATE OR REPLACE FUNCTION ensure_customer_portal_token(p_enquiry_id uuid)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_nric_norm text;
  v_agent_id  uuid;
  v_token     text;
BEGIN
  SELECT e.customer_nric_normalized, e.agent_id
    INTO v_nric_norm, v_agent_id
  FROM enquiries e WHERE e.id = p_enquiry_id;

  IF v_nric_norm IS NULL THEN
    RAISE EXCEPTION 'Enquiry not found' USING ERRCODE = 'P0012';
  END IF;

  -- A blank NRIC would collide every blank-NRIC customer onto one token.
  IF v_nric_norm = '' THEN
    RAISE EXCEPTION 'This customer has no IC on record' USING ERRCODE = '22023';
  END IF;

  IF NOT (
    is_admin()
    OR (v_agent_id IS NOT NULL AND v_agent_id = get_agent_id())
    OR (v_agent_id IS NOT NULL AND v_agent_id IN (SELECT unit_member_ids()))
  ) THEN
    RAISE EXCEPTION 'Not allowed to issue this customer link' USING ERRCODE = '42501';
  END IF;

  SELECT t.token INTO v_token
  FROM customer_portal_tokens t WHERE t.nric_normalized = v_nric_norm;

  IF v_token IS NULL THEN
    -- Same shape as ensure_my_enquiry_link(): 32 lowercase hex chars.
    v_token := replace(gen_random_uuid()::text, '-', '');
    INSERT INTO customer_portal_tokens (token, nric_normalized)
    VALUES (v_token, v_nric_norm);
  END IF;

  -- A revoked token is returned as-is rather than silently reissued: reissuing
  -- would defeat the revoke. Re-enabling is an explicit admin action.
  RETURN v_token;
END;
$$;

GRANT EXECUTE ON FUNCTION ensure_customer_portal_token(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION revoke_customer_portal_token(p_token text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT is_admin() THEN
    RAISE EXCEPTION 'Only admins can revoke a customer link' USING ERRCODE = '42501';
  END IF;
  UPDATE customer_portal_tokens SET revoked_at = now()
  WHERE token = p_token AND revoked_at IS NULL;
END;
$$;

GRANT EXECUTE ON FUNCTION revoke_customer_portal_token(text) TO authenticated;
```

- [ ] **Step 2: Apply to staging**

Apply via Supabase MCP `apply_migration` to `lyjdlietzmmejrxjvwgp`, name `customer_portal_tokens`.
Expected: `{"success": true}`.

- [ ] **Step 3: Verify the schema landed**

```sql
SELECT
  (SELECT count(*) FROM pg_tables  WHERE tablename = 'customer_portal_tokens')        AS token_table,
  (SELECT string_agg(cmd, ',') FROM pg_policies
     WHERE tablename = 'customer_portal_tokens')                                      AS token_policy_cmds,
  (SELECT count(*) FROM information_schema.columns
     WHERE table_name = 'enquiry_vehicles' AND column_name = 'removed_at')            AS removed_at_col,
  (SELECT count(*) FROM information_schema.columns
     WHERE table_name = 'enquiry_vehicles' AND column_name = 'removed_by_customer')   AS removed_by_col,
  (SELECT count(*) FROM enquiry_vehicles WHERE removed_at IS NOT NULL)                AS preexisting_removed;
```

Expected: `token_table=1`, `token_policy_cmds=SELECT`, both columns `1`, `preexisting_removed=0`.

- [ ] **Step 4: Verify the token RPC's authz and idempotency**

`execute_sql` carries no JWT, so `auth.uid()` is NULL. Impersonate inside a transaction; `is_admin()` reads `auth.users.raw_app_meta_data` for `auth.uid()`, and `auth.uid()` reads `request.jwt.claims`. On staging the admin is `8d6df332-6a10-43a2-8100-68d1cc1a7385` (admin@test.com) — re-derive with `SELECT id FROM auth.users WHERE raw_app_meta_data->>'role' = 'admin';` if that fails.

```sql
-- Expect: ERROR 42501 — no JWT means not admin, not the agent, not a unit viewer.
SELECT ensure_customer_portal_token((SELECT id FROM enquiries LIMIT 1));
```

```sql
-- Admin path: mints once, then returns the SAME token (get-or-create).
BEGIN;
SELECT set_config('request.jwt.claims',
  '{"sub":"8d6df332-6a10-43a2-8100-68d1cc1a7385","role":"authenticated"}', true);
SELECT
  ensure_customer_portal_token((SELECT id FROM enquiries ORDER BY created_at LIMIT 1)) AS first_call,
  ensure_customer_portal_token((SELECT id FROM enquiries ORDER BY created_at LIMIT 1)) AS second_call;
ROLLBACK;
```

Expected: first call raises `42501`; the admin block returns two IDENTICAL 32-char hex strings. If they differ, the get-or-create is broken and would mint a new link on every button press.

- [ ] **Step 5: Commit**

```bash
git branch --show-current   # must print feat/customer-self-serve-vehicles
git add supabase/migrations/20260716000002_customer_portal_tokens.sql
git commit -m "feat(partner): customer portal token table + vehicle soft-delete columns

One permanent link per customer, keyed on normalized NRIC because there is
no customers table. A token on enquiries would give a customer with two
enquiries two disjoint car lists. Removal is soft: a renewed car has a gift
voucher and a settlement attached."
```

---

### Task 2: Migration — the three anon RPCs

**Files:**
- Create: `supabase/migrations/20260716000003_customer_self_serve_rpcs.sql`

**Interfaces:**
- Consumes: `customer_portal_tokens`, `enquiry_vehicles.removed_at` (Task 1).
- Produces, all `GRANT EXECUTE ... TO anon`:
  - `get_customer_cars(p_token text) RETURNS TABLE (customer_name text, nric_masked text, vehicles jsonb)`
  - `customer_add_vehicle(p_token text, p_car_plate text, p_insurance_expiry_date date, p_road_tax_renewal boolean) RETURNS uuid`
  - `customer_remove_vehicle(p_token text, p_vehicle_id uuid) RETURNS void`

  Task 5's page calls exactly these names and parameter names.

- [ ] **Step 1: Write the migration**

Create `supabase/migrations/20260716000003_customer_self_serve_rpcs.sql`:

```sql
-- The anon surface for the customer self-serve car list.
--
-- enquiries and enquiry_vehicles have no anon RLS policies by design
-- (20260627000002 states it outright), so these SECURITY DEFINER functions are
-- the ONLY way an unauthenticated customer touches their data. Every one
-- resolves the token first and refuses a revoked one.
--
-- NRIC is masked HERE rather than in the page: whatever these functions return
-- lands in the network response regardless of what the UI chooses to render.
-- Phone and email are never returned at all.

-- Resolve a token to its customer, or NULL. Revoked tokens resolve to NULL, so
-- every caller below refuses them identically.
CREATE OR REPLACE FUNCTION customer_token_nric(p_token text)
RETURNS text
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT t.nric_normalized FROM customer_portal_tokens t
  WHERE t.token = p_token AND t.revoked_at IS NULL;
$$;
-- Deliberately NOT granted to anon: an internal helper for the functions below.

CREATE OR REPLACE FUNCTION get_customer_cars(p_token text)
RETURNS TABLE (customer_name text, nric_masked text, vehicles jsonb)
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
DECLARE
  v_nric_norm text := customer_token_nric(p_token);
BEGIN
  IF v_nric_norm IS NULL THEN
    RAISE EXCEPTION 'This link is no longer valid' USING ERRCODE = 'P0012';
  END IF;

  RETURN QUERY
  SELECT
    -- Newest enquiry wins for the display name.
    (SELECT e.customer_name FROM enquiries e
      WHERE e.customer_nric_normalized = v_nric_norm
      ORDER BY e.created_at DESC LIMIT 1),
    -- Last 4 only. A leaked link must not disclose a full IC.
    ('•••• ' || right(v_nric_norm, 4)),
    COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
               'id', v.id,
               'car_plate', v.car_plate,
               'insurance_expiry_date', v.insurance_expiry_date,
               'status', v.status,
               'road_tax_renewal', v.road_tax_renewal
             ) ORDER BY v.insurance_expiry_date, v.car_plate)
      FROM enquiry_vehicles v
      JOIN enquiries e ON e.id = v.enquiry_id
      WHERE e.customer_nric_normalized = v_nric_norm
        AND v.removed_at IS NULL
    ), '[]'::jsonb);
END;
$$;

GRANT EXECUTE ON FUNCTION get_customer_cars(text) TO anon;

-- Adds a car for the token's customer.
--
-- Landing rule: the newest OPEN enquiry, else a new enquiry inheriting the
-- customer's newest prior enquiry's agent/merchant/branch. Reopening a closed
-- enquiry was rejected: it would disturb settled gift/settlement reporting.
--
-- The NRIC 1-month dedup window (P0009) deliberately does NOT apply here. That
-- guard lives inside submit_enquiry and exists to stop repeat gold-form
-- REGISTRATIONS. An existing customer adding a second car is not a new
-- registration. This is intentional, not an oversight.
CREATE OR REPLACE FUNCTION customer_add_vehicle(
  p_token text,
  p_car_plate text,
  p_insurance_expiry_date date,
  p_road_tax_renewal boolean
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_nric_norm  text := customer_token_nric(p_token);
  v_enquiry_id uuid;
  v_prior      enquiries%ROWTYPE;
  v_vehicle_id uuid;
BEGIN
  IF v_nric_norm IS NULL THEN
    RAISE EXCEPTION 'This link is no longer valid' USING ERRCODE = 'P0012';
  END IF;

  IF coalesce(btrim(p_car_plate), '') = '' THEN
    RAISE EXCEPTION 'Car plate is required' USING ERRCODE = '22023';
  END IF;

  IF p_insurance_expiry_date IS NULL THEN
    RAISE EXCEPTION 'Insurance expiry date is required' USING ERRCODE = '22023';
  END IF;

  SELECT e.id INTO v_enquiry_id
  FROM enquiries e
  WHERE e.customer_nric_normalized = v_nric_norm
    AND e.status = 'open'
  ORDER BY e.created_at DESC
  LIMIT 1;

  IF v_enquiry_id IS NULL THEN
    SELECT * INTO v_prior
    FROM enquiries e
    WHERE e.customer_nric_normalized = v_nric_norm
    ORDER BY e.created_at DESC
    LIMIT 1;

    IF v_prior.id IS NULL THEN
      -- A token always derives from an enquiry, so this is unreachable in
      -- practice; refuse rather than invent a customer with no history.
      RAISE EXCEPTION 'This link is no longer valid' USING ERRCODE = 'P0012';
    END IF;

    INSERT INTO enquiries (
      agent_id, merchant_id, branch_link_id, merchant_branch_id,
      customer_name, customer_nric, customer_nric_normalized,
      customer_phone, customer_phone_normalized, customer_email, status
    ) VALUES (
      v_prior.agent_id, v_prior.merchant_id, v_prior.branch_link_id, v_prior.merchant_branch_id,
      v_prior.customer_name, v_prior.customer_nric, v_prior.customer_nric_normalized,
      v_prior.customer_phone, v_prior.customer_phone_normalized, v_prior.customer_email, 'open'
    ) RETURNING id INTO v_enquiry_id;
  END IF;

  INSERT INTO enquiry_vehicles (
    enquiry_id, merchant_branch_id, merchant_id, car_plate, car_plate_normalized,
    insurance_expiry_date, road_tax_renewal, status
  )
  SELECT
    v_enquiry_id, e.merchant_branch_id, e.merchant_id, p_car_plate,
    -- Identical expression to submit_enquiry (20260706000009:64).
    upper(regexp_replace(coalesce(p_car_plate, ''), '[^a-zA-Z0-9]', '', 'g')),
    p_insurance_expiry_date, coalesce(p_road_tax_renewal, false), 'submitted'
  FROM enquiries e WHERE e.id = v_enquiry_id
  RETURNING id INTO v_vehicle_id;

  RETURN v_vehicle_id;
END;
$$;

GRANT EXECUTE ON FUNCTION customer_add_vehicle(text, text, date, boolean) TO anon;

-- Soft-removes a car. Refuses renewed/lost: those have a gifts voucher and a
-- merchant_settlements row attached. The enquiry-belongs-to-this-token check is
-- what stops a token holder removing someone else's car by guessing an id.
CREATE OR REPLACE FUNCTION customer_remove_vehicle(p_token text, p_vehicle_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_nric_norm  text := customer_token_nric(p_token);
  v_status     vehicle_status;
  v_enquiry_id uuid;
BEGIN
  IF v_nric_norm IS NULL THEN
    RAISE EXCEPTION 'This link is no longer valid' USING ERRCODE = 'P0012';
  END IF;

  SELECT v.status, v.enquiry_id INTO v_status, v_enquiry_id
  FROM enquiry_vehicles v
  JOIN enquiries e ON e.id = v.enquiry_id
  WHERE v.id = p_vehicle_id
    AND e.customer_nric_normalized = v_nric_norm
    AND v.removed_at IS NULL
  FOR UPDATE OF v;

  -- Same code as a bad token: never disclose that someone else's vehicle id exists.
  IF v_enquiry_id IS NULL THEN
    RAISE EXCEPTION 'This link is no longer valid' USING ERRCODE = 'P0012';
  END IF;

  IF v_status IN ('renewed', 'lost') THEN
    RAISE EXCEPTION 'This car can no longer be removed' USING ERRCODE = 'P0013';
  END IF;

  UPDATE enquiry_vehicles
  SET removed_at = now(), removed_by_customer = true, updated_at = now()
  WHERE id = p_vehicle_id;

  -- Close the enquiry when nothing live and non-terminal is left.
  UPDATE enquiries e SET status = 'closed', updated_at = now()
  WHERE e.id = v_enquiry_id
    AND e.status = 'open'
    AND NOT EXISTS (
      SELECT 1 FROM enquiry_vehicles ev
      WHERE ev.enquiry_id = e.id
        AND ev.removed_at IS NULL
        AND ev.status NOT IN ('renewed', 'lost')
    );
END;
$$;

GRANT EXECUTE ON FUNCTION customer_remove_vehicle(text, uuid) TO anon;
```

- [ ] **Step 2: Apply to staging**

Apply via MCP `apply_migration` to `lyjdlietzmmejrxjvwgp`, name `customer_self_serve_rpcs`.
Expected: `{"success": true}`.

- [ ] **Step 3: Verify the happy path and that PII is not leaked**

```sql
BEGIN;
SELECT set_config('request.jwt.claims',
  '{"sub":"8d6df332-6a10-43a2-8100-68d1cc1a7385","role":"authenticated"}', true);

INSERT INTO enquiries (id, agent_id, customer_name, customer_nric, customer_nric_normalized,
                       customer_phone, customer_phone_normalized, customer_email, status)
VALUES ('11111111-0000-0000-0000-000000000001',
        (SELECT id FROM agents WHERE status='active' ORDER BY created_at LIMIT 1),
        'Selfserve Test', 'S3333333T', 'S3333333T', '+60100000003', '60100000003',
        'selfserve@example.com', 'open');
INSERT INTO enquiry_vehicles (enquiry_id, car_plate, car_plate_normalized,
                              insurance_expiry_date, status)
VALUES ('11111111-0000-0000-0000-000000000001', 'SS 1', 'SS1', '2027-01-01', 'submitted');

SELECT ensure_customer_portal_token('11111111-0000-0000-0000-000000000001') AS token \gset

SELECT customer_name, nric_masked,
       jsonb_array_length(vehicles) AS car_count,
       CASE WHEN nric_masked = '•••• 333T' THEN 'PASS masked' ELSE 'FAIL not masked' END AS mask_verdict,
       CASE WHEN vehicles::text LIKE '%60100000003%' OR vehicles::text LIKE '%example.com%'
            THEN 'FAIL leaks phone/email' ELSE 'PASS no phone/email' END AS pii_verdict
FROM get_customer_cars(:'token');
ROLLBACK;
```

Expected: `car_count=1`, `mask_verdict=PASS masked`, `pii_verdict=PASS no phone/email`.

If your SQL client does not support `\gset`, capture the token with a CTE instead:
`WITH t AS (SELECT ensure_customer_portal_token('11111111-0000-0000-0000-000000000001') AS tok) SELECT * FROM t, LATERAL get_customer_cars(t.tok);`

- [ ] **Step 4: Verify a revoked token dies and a renewed car cannot be removed**

```sql
BEGIN;
SELECT set_config('request.jwt.claims',
  '{"sub":"8d6df332-6a10-43a2-8100-68d1cc1a7385","role":"authenticated"}', true);
INSERT INTO enquiries (id, agent_id, customer_name, customer_nric, customer_nric_normalized,
                       customer_phone, customer_phone_normalized, status)
VALUES ('11111111-0000-0000-0000-000000000002',
        (SELECT id FROM agents WHERE status='active' ORDER BY created_at LIMIT 1),
        'Revoke Test', 'S2222222S', 'S2222222S', '+60100000002', '60100000002', 'open');
INSERT INTO enquiry_vehicles (id, enquiry_id, car_plate, car_plate_normalized,
                              insurance_expiry_date, status)
VALUES ('22222222-0000-0000-0000-000000000001', '11111111-0000-0000-0000-000000000002',
        'RV 1', 'RV1', '2027-01-01', 'renewed');

WITH t AS (SELECT ensure_customer_portal_token('11111111-0000-0000-0000-000000000002') AS tok)
SELECT 'expect P0013 next' FROM t;
-- Expect: ERROR P0013 'This car can no longer be removed'
SELECT customer_remove_vehicle(
  (SELECT token FROM customer_portal_tokens WHERE nric_normalized = 'S2222222S'),
  '22222222-0000-0000-0000-000000000001');
ROLLBACK;
```

Then, separately:

```sql
-- Expect: ERROR P0012 'This link is no longer valid'
SELECT get_customer_cars('definitely-not-a-real-token');
```

Expected: the remove raises `P0013`; the bogus token raises `P0012`.

- [ ] **Step 5: Verify a token cannot touch another customer's car**

```sql
BEGIN;
SELECT set_config('request.jwt.claims',
  '{"sub":"8d6df332-6a10-43a2-8100-68d1cc1a7385","role":"authenticated"}', true);
INSERT INTO enquiries (id, agent_id, customer_name, customer_nric, customer_nric_normalized,
                       customer_phone, customer_phone_normalized, status)
VALUES
  ('11111111-0000-0000-0000-000000000003',
   (SELECT id FROM agents WHERE status='active' ORDER BY created_at LIMIT 1),
   'Cust A', 'S1111111A', 'S1111111A', '+60100000011', '60100000011', 'open'),
  ('11111111-0000-0000-0000-000000000004',
   (SELECT id FROM agents WHERE status='active' ORDER BY created_at LIMIT 1),
   'Cust B', 'S1111111B', 'S1111111B', '+60100000012', '60100000012', 'open');
INSERT INTO enquiry_vehicles (id, enquiry_id, car_plate, car_plate_normalized,
                              insurance_expiry_date, status)
VALUES ('22222222-0000-0000-0000-000000000002', '11111111-0000-0000-0000-000000000004',
        'B CAR', 'BCAR', '2027-01-01', 'submitted');

SELECT ensure_customer_portal_token('11111111-0000-0000-0000-000000000003');
-- Customer A's token, Customer B's vehicle id. Expect: ERROR P0012.
SELECT customer_remove_vehicle(
  (SELECT token FROM customer_portal_tokens WHERE nric_normalized = 'S1111111A'),
  '22222222-0000-0000-0000-000000000002');
ROLLBACK;
```

Expected: `P0012`. This is the cross-customer check — if it succeeds instead, anyone with any valid link can delete anyone's car by guessing a UUID. Do not proceed until this raises.

- [ ] **Step 6: Commit**

```bash
git branch --show-current   # must print feat/customer-self-serve-vehicles
git add supabase/migrations/20260716000003_customer_self_serve_rpcs.sql
git commit -m "feat(partner): anon RPCs for the customer self-serve car list

get_customer_cars / customer_add_vehicle / customer_remove_vehicle, all
token-gated. NRIC is masked in the RPC because whatever it returns is in
the network response whatever the UI renders; phone and email are never
returned. A vehicle belonging to another NRIC reports the same P0012 as a
bad token rather than confirming the id exists."
```

---

### Task 3: Migration — the `removed_at` ripple

**Files:**
- Create: `supabase/migrations/20260716000004_removed_at_ripple.sql`

**Interfaces:**
- Consumes: `enquiry_vehicles.removed_at` (Task 1).
- Produces: patched `confirm_vehicle_renewal(uuid, numeric, uuid)`, `mark_vehicle_lost(uuid, text)`, `record_quotation(uuid, text)`, `enqueue_expiry_reminders()`, `merchant_branch_leads(int)`, `reassign_customer_agent(text, uuid)`.

**Why this task exists and must not be skipped:** soft-delete is not a local change. Every site that counts vehicles returns a WRONG NUMBER rather than an error if it ignores `removed_at`. The highest-risk two are the enquiry-close predicates: if a customer removes their last open car, `NOT EXISTS (... status NOT IN ('renewed','lost'))` still sees the removed row and **the enquiry never closes**.

- [ ] **Step 1: Read the current function bodies**

Before writing, read each authoritative body so the patch is a minimal edit, not a rewrite:
- `supabase/migrations/20260630000001_partnership_gift_rate.sql:29-103` — `confirm_vehicle_renewal` (the 3-arg version; the 1-arg versions in `20260628000010:91` and `20260629000010:120` are dead)
- `supabase/migrations/20260628000010_merchant_pipeline_rpcs.sql:11-40` — `record_quotation`
- `supabase/migrations/20260628000010_merchant_pipeline_rpcs.sql:42-85` — `mark_vehicle_lost`
- `supabase/migrations/20260628000020_expiry_reminders.sql:40-60` — `enqueue_expiry_reminders`
- `supabase/migrations/20260706000010_merchant_branch_leads.sql:6-40` — `merchant_branch_leads`
- `supabase/migrations/20260716000001_customer_agent_reassignment.sql:90-109` — `reassign_customer_agent`

- [ ] **Step 2: Write the migration**

Create `supabase/migrations/20260716000004_removed_at_ripple.sql`. Copy each function body VERBATIM from the source above and apply only the marked change. Do not refactor anything else.

```sql
-- Soft-delete ripple for enquiry_vehicles.removed_at (20260716000002).
--
-- removed_at is not a local change: every site that counts vehicles returns a
-- WRONG NUMBER rather than an error if it ignores it. The two enquiry-close
-- predicates are the worst — if a customer removes their last open car, a
-- NOT EXISTS over (status NOT IN ('renewed','lost')) still sees the removed row
-- and the enquiry never closes.
--
-- Each function below is copied verbatim from its authoritative migration with
-- exactly one predicate changed. Sources:
--   confirm_vehicle_renewal   20260630000001:29-103
--   record_quotation          20260628000010:11-40
--   mark_vehicle_lost         20260628000010:42-85
--   enqueue_expiry_reminders  20260628000020:40-60
--   merchant_branch_leads     20260706000010:6-40
--   reassign_customer_agent   20260716000001:90-109
```

Then, in the same file:

1. **`confirm_vehicle_renewal(uuid, numeric, uuid)`** — verbatim from `20260630000001:29-103`, with the close predicate gaining `AND ev.removed_at IS NULL`:
```sql
    AND NOT EXISTS (
      SELECT 1 FROM enquiry_vehicles ev
      WHERE ev.enquiry_id = e.id
        AND ev.removed_at IS NULL
        AND ev.status NOT IN ('renewed','lost')
    )
```
Also add, immediately after the vehicle is locked `FOR UPDATE`:
```sql
  IF v_vehicle.removed_at IS NOT NULL THEN
    RAISE EXCEPTION 'This vehicle was removed by the customer' USING ERRCODE = 'P0013';
  END IF;
```

2. **`mark_vehicle_lost(uuid, text)`** — verbatim from `20260628000010:42-85`, same two changes: `AND ev.removed_at IS NULL` in the close predicate, and a `removed_at IS NOT NULL` → `P0013` guard before mutating.

3. **`record_quotation(uuid, text)`** — verbatim from `20260628000010:11-40`. It has no `NOT EXISTS` over siblings (single-row `WHERE id = p_vehicle_id`), so it needs ONLY the guard:
```sql
  IF v_vehicle.removed_at IS NOT NULL THEN
    RAISE EXCEPTION 'This vehicle was removed by the customer' USING ERRCODE = 'P0013';
  END IF;
```

4. **`enqueue_expiry_reminders()`** — verbatim from `20260628000020:40-60`, adding `AND ev.removed_at IS NULL` to the WHERE. Without it the system emails a customer about a car they deleted.

5. **`merchant_branch_leads(p_limit int DEFAULT 200)`** — verbatim from `20260706000010:6-40`, adding `AND v.removed_at IS NULL` to the WHERE, so merchant lead counts do not overstate.

6. **`reassign_customer_agent(text, uuid)`** — verbatim from `20260716000001:50-121`, adding `AND v.removed_at IS NULL` to **both** EXISTS clauses (the `from_agent_id` SELECT and the UPDATE). They must stay character-for-character identical to each other — that identity is what makes the audit record the agent that actually moved. Without this, a customer whose only open car was removed still counts as having open work, so their enquiry moves and blocks their agent's deletion forever.

- [ ] **Step 3: Apply to staging**

Apply via MCP `apply_migration` to `lyjdlietzmmejrxjvwgp`, name `removed_at_ripple`.
Expected: `{"success": true}`.

- [ ] **Step 4: Verify the enquiry-close fix — the highest-risk item**

```sql
BEGIN;
SELECT set_config('request.jwt.claims',
  '{"sub":"8d6df332-6a10-43a2-8100-68d1cc1a7385","role":"authenticated"}', true);

INSERT INTO enquiries (id, agent_id, customer_name, customer_nric, customer_nric_normalized,
                       customer_phone, customer_phone_normalized, status)
VALUES ('33333333-0000-0000-0000-000000000001',
        (SELECT id FROM agents WHERE status='active' ORDER BY created_at LIMIT 1),
        'Close Test', 'S4444441Q', 'S4444441Q', '+60100000041', '60100000041', 'open');
INSERT INTO enquiry_vehicles (id, enquiry_id, car_plate, car_plate_normalized,
                              insurance_expiry_date, status)
VALUES ('44444444-0000-0000-0000-000000000001', '33333333-0000-0000-0000-000000000001',
        'CL 1', 'CL1', '2027-01-01', 'submitted');

SELECT ensure_customer_portal_token('33333333-0000-0000-0000-000000000001');
SELECT customer_remove_vehicle(
  (SELECT token FROM customer_portal_tokens WHERE nric_normalized = 'S4444441Q'),
  '44444444-0000-0000-0000-000000000001');

SELECT status,
       CASE WHEN status = 'closed' THEN 'PASS enquiry closed after last car removed'
            ELSE 'FAIL enquiry stuck open' END AS verdict
FROM enquiries WHERE id = '33333333-0000-0000-0000-000000000001';
ROLLBACK;
```

Expected: `status=closed`, `verdict=PASS enquiry closed after last car removed`.

- [ ] **Step 5: Verify removed cars vanish from reminders and reassignment**

```sql
BEGIN;
SELECT set_config('request.jwt.claims',
  '{"sub":"8d6df332-6a10-43a2-8100-68d1cc1a7385","role":"authenticated"}', true);

INSERT INTO enquiries (id, agent_id, customer_name, customer_nric, customer_nric_normalized,
                       customer_phone, customer_phone_normalized, status)
VALUES ('33333333-0000-0000-0000-000000000002',
        (SELECT id FROM agents WHERE status='active' ORDER BY created_at LIMIT 1),
        'Ripple Test', 'S4444442R', 'S4444442R', '+60100000042', '60100000042', 'open');
-- Expiring in exactly 30 days: the reminder window.
INSERT INTO enquiry_vehicles (id, enquiry_id, car_plate, car_plate_normalized,
                              insurance_expiry_date, status, removed_at, removed_by_customer)
VALUES ('44444444-0000-0000-0000-000000000002', '33333333-0000-0000-0000-000000000002',
        'RM 1', 'RM1', (CURRENT_DATE + INTERVAL '30 days')::date, 'submitted', now(), true);

SELECT
  (SELECT count(*) FROM enquiry_vehicles ev
     WHERE ev.insurance_expiry_date = (CURRENT_DATE + INTERVAL '30 days')::date
       AND ev.reminder_sent_at IS NULL
       AND ev.status IN ('submitted','quoted')
       AND ev.removed_at IS NULL
       AND ev.id = '44444444-0000-0000-0000-000000000002')          AS reminder_would_send,
  reassign_customer_agent('S4444442R',
    (SELECT id FROM agents WHERE status='active' ORDER BY created_at LIMIT 1)) AS reassign_moved;
ROLLBACK;
```

Expected: `reminder_would_send=0` (no email about a deleted car) and `reassign_moved=0` (a customer whose only car was removed has no open work). Before this migration `reassign_moved` would be `1`.

- [ ] **Step 6: Commit**

```bash
git branch --show-current   # must print feat/customer-self-serve-vehicles
git add supabase/migrations/20260716000004_removed_at_ripple.sql
git commit -m "fix(partner): exclude customer-removed vehicles everywhere they are counted

Soft-delete is not local. Patches the two enquiry-close predicates (a
removed last car left the enquiry stuck open forever), the expiry reminder
window (we emailed about deleted cars), merchant lead counts, and
reassign_customer_agent's open-work test. Adds a P0013 guard so admins
cannot quote/lose/renew a car the customer withdrew."
```

---

### Task 4: Shared types

**Files:**
- Modify: `packages/shared-types/src/merchant.ts` — add fields to `EnquiryVehicle` (ends line 127); add `CustomerPortalToken` after it, before `Gift`

**Interfaces:**
- Produces: `CustomerPortalToken`; `EnquiryVehicle.removed_at` / `.removed_by_customer`. `src/index.ts` re-exports via `export *` — no edit needed there.

Enquiry-domain types live in `merchant.ts`, NOT `database.ts`. Conventions: hand-written `export interface PascalCase`, snake_case fields, nullable as `| null` (never `?`), timestamps as ISO `string`.

- [ ] **Step 1: Add the fields to `EnquiryVehicle`**

```ts
  /** Set when the customer removed this car from their self-serve list. Soft
   *  delete: renewed cars have a gift voucher and a settlement attached, and
   *  agents still need to see that the lead existed. Every count of vehicles
   *  must filter on this being null. */
  removed_at: string | null;
  removed_by_customer: boolean;
```

- [ ] **Step 2: Add `CustomerPortalToken`**

```ts
/**
 * The permanent unauthenticated link a customer uses to manage their own cars.
 * Keyed on the normalized NRIC, not on an enquiry: a customer with two
 * enquiries must get ONE link covering all their cars.
 */
export interface CustomerPortalToken {
  /** 32 lowercase hex chars, minted server-side. Same shape as agents.enquiry_link_code. */
  token: string;
  nric_normalized: string;
  created_at: string;
  /** Admin kill switch. A revoked token resolves to nothing and is never silently reissued. */
  revoked_at: string | null;
}
```

- [ ] **Step 3: Typecheck**

Run: `pnpm -r typecheck`
Expected: `packages/shared-types typecheck: Done`, no errors.

- [ ] **Step 4: Commit**

```bash
git branch --show-current   # must print feat/customer-self-serve-vehicles
git add packages/shared-types/src/merchant.ts
git commit -m "feat(types): CustomerPortalToken + vehicle soft-delete fields"
```

---

### Task 5: The customer-facing page

**Files:**
- Create: `apps/public-pages/src/pages/MyCars.tsx`
- Modify: `apps/public-pages/src/router.tsx`

**Interfaces:**
- Consumes: `get_customer_cars(p_token)`, `customer_add_vehicle(p_token, p_car_plate, p_insurance_expiry_date, p_road_tax_renewal)`, `customer_remove_vehicle(p_token, p_vehicle_id)` (Task 2).
- Produces: route `/public/my-cars/$token`. Tasks 6 and 7 build links to it.

**Context the implementer needs:**
- `router.tsx` is a flat manual TanStack route tree. Adding a route needs **TWO** edits: a `createRoute` const AND appending it to `rootRoute.addChildren([...])` (~line 55). Forgetting the array is the classic miss and the route silently 404s.
- **Never** call `createClient()` here — import `{ supabase }` from `../lib/supabase`, which re-exports the single shared client. A second client races the single-use refresh token on reload.
- `get_customer_cars` returns a TABLE, so supabase-js gives you an **array**. Check `.length === 0` as well as the error, exactly as `Enquiry.tsx:128-131` does.
- Copy the branding cascade from `Enquiry.tsx:340-363` and the invalid-link card from `Enquiry.tsx:297-310`. Use `||` not `??` in the cascade — empty strings must fall through (deliberate, per the Jul 11 fix).
- Error mapping: read `rpcError.code`. `P0012` → "This link is no longer valid." `P0013` → "This car can no longer be removed." Everything else → a generic retry message. Follow `Enquiry.tsx:258-272`.
- There is **no product picker** on the live enquiry form and there must not be one here.

- [ ] **Step 1a: Write the data layer and error mapping**

Create `apps/public-pages/src/pages/MyCars.tsx`. Start with the types, schema, loader and error mapper — this is the part that must be exact:

```tsx
import { useEffect, useState } from 'react';
import { useParams } from '@tanstack/react-router';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import { supabase } from '../lib/supabase';
import { useEnquiryFormSettings } from '../hooks/useEnquiryFormSettings';
import { useFormBranding } from '../hooks/useFormBranding';

interface MyCar {
  id: string;
  car_plate: string;
  insurance_expiry_date: string;
  status: 'submitted' | 'quoted' | 'renewed' | 'lost';
  road_tax_renewal: boolean;
}

interface MyCarsContext {
  customer_name: string;
  nric_masked: string;
  vehicles: MyCar[];
}

const addCarSchema = z.object({
  car_plate: z.string().min(1, 'Car plate is required'),
  insurance_expiry_date: z.string().min(1, 'Insurance expiry date is required'),
  road_tax_renewal: z.enum(['yes', 'no']),
});
type AddCarData = z.infer<typeof addCarSchema>;

/**
 * P-codes raised by the self-serve RPCs. P0012 is deliberately identical for a
 * bad token, a revoked token, and someone else's vehicle id — the page must
 * never confirm that a token or a vehicle exists.
 */
function selfServeError(code: string | undefined, fallback: string): string {
  if (code === 'P0012') return 'This link is no longer valid.';
  if (code === 'P0013') return 'This car can no longer be removed. Please contact your agent.';
  if (code === '22023') return 'Please fill in the car plate and insurance expiry date.';
  return fallback;
}
```

Then the loader. `get_customer_cars` returns a TABLE, so supabase-js hands back an **array** — the `.length === 0` check is as important as the error check (mirrors `Enquiry.tsx:128-131`):

```tsx
export function MyCars() {
  const { token } = useParams({ strict: false }) as { token: string };
  const { data: formSettings } = useEnquiryFormSettings();
  const formBranding = useFormBranding();

  const [context, setContext] = useState<MyCarsContext | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [actionError, setActionError] = useState<string | null>(null);
  const [removeTarget, setRemoveTarget] = useState<MyCar | null>(null);

  const load = async () => {
    const { data, error: rpcError } = await supabase.rpc('get_customer_cars', {
      p_token: token,
    });
    if (rpcError || !data || data.length === 0) {
      setError('This link is no longer valid.');
      setContext(null);
    } else {
      setContext(data[0] as MyCarsContext);
      setError(null);
    }
    setIsLoading(false);
  };

  useEffect(() => {
    if (token) load();
  }, [token]);
```

Add and remove — both refetch on success:

```tsx
  const form = useForm<AddCarData>({
    resolver: zodResolver(addCarSchema),
    defaultValues: { car_plate: '', insurance_expiry_date: '', road_tax_renewal: 'no' },
  });

  const onAdd = async (values: AddCarData) => {
    setActionError(null);
    const { error: rpcError } = await supabase.rpc('customer_add_vehicle', {
      p_token: token,
      p_car_plate: values.car_plate,
      p_insurance_expiry_date: values.insurance_expiry_date,
      p_road_tax_renewal: values.road_tax_renewal === 'yes',
    });
    if (rpcError) {
      setActionError(selfServeError(rpcError.code, 'Could not add this car. Please try again.'));
      return;
    }
    form.reset();
    await load();
  };

  const onRemove = async () => {
    if (!removeTarget) return;
    setActionError(null);
    const { error: rpcError } = await supabase.rpc('customer_remove_vehicle', {
      p_token: token,
      p_vehicle_id: removeTarget.id,
    });
    setRemoveTarget(null);
    if (rpcError) {
      setActionError(selfServeError(rpcError.code, 'Could not remove this car. Please try again.'));
      return;
    }
    await load();
  };
```

- [ ] **Step 1b: Write the render**

Invalid-link state — copy the card markup verbatim from `Enquiry.tsx:297-310`, substituting `{error}`. It must render **only** "This link is no longer valid.", never distinguishing a never-existed token from a revoked one:

```tsx
  if (isLoading) return <div className="min-h-screen flex items-center justify-center">Loading…</div>;

  if (error && !context) {
    // Markup copied from Enquiry.tsx:297-310 (red-circle card, no retry, no branding).
    return (/* … */);
  }
```

Branding cascade — copy from `Enquiry.tsx:340-363`. Use `||` not `??`: empty strings must fall through (deliberate, per the Jul 11 fix):

```tsx
  const headerLogoUrl = formBranding.logoUrl || formSettings?.header_logo_url || null;
  const headerTitle = formSettings?.header_title || 'My Cars';
  const footerText = formBranding.footerText || formSettings?.footer_text || '';
```

Header: `{context.customer_name}` and `{context.nric_masked}` rendered **exactly as returned** — never re-derive the mask client-side.

Car list: for each `context.vehicles`, show plate, `insurance_expiry_date`, a status badge, and a road-tax indicator. Empty → "You have no cars listed yet."

The remove control is gated on status — a renewed/lost car has a gift voucher and a settlement attached, and the RPC refuses anyway; not rendering it avoids offering an action that cannot succeed:

```tsx
  {(car.status === 'submitted' || car.status === 'quoted') && (
    <Button variant="ghost" size="sm" onClick={() => setRemoveTarget(car)} aria-label="Remove car">
      <Trash2 className="size-4 text-destructive" />
    </Button>
  )}
```

Wrap the removal in an `AlertDialog` driven by `removeTarget` (pattern: `AgentList.tsx:284-299`), naming the plate in the confirm copy, with `onRemove` as the action.

Add-car form: three `FormField`s only — `car_plate` (text), `insurance_expiry_date` (`type="date"`), and `road_tax_renewal` as the Yes/No button pair copied from `Enquiry.tsx:557-577`. **No product picker and no attachment upload** — the live enquiry form has no product picker either, and adding one only here would be inconsistent.

Render `{actionError}` as an inline alert above the form (pattern: `Enquiry.tsx:400-404`).

- [ ] **Step 2: Register the route**

In `apps/public-pages/src/router.tsx`, add the import, then:

```tsx
const myCarsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/public/my-cars/$token',
  component: MyCars,
});
```

and append `myCarsRoute` to the `rootRoute.addChildren([...])` array. **Both edits are required.**

- [ ] **Step 3: Build**

Run: `pnpm -r typecheck && pnpm --filter public-pages build`
Expected: typecheck Done; `✓ built in ...`. The build runs `tsc && vite build`, so this is what typechecks the page.

- [ ] **Step 4: Verify against staging in a browser**

Mint a token for a real staging enquiry, then open `http://localhost:3002/public/my-cars/<token>` with public-pages pointed at staging:
1. The list shows that customer's cars and a masked IC (`•••• NNNN`). **Open devtools → Network and confirm the RPC response contains no phone and no email.**
2. Add a car → it appears; confirm in SQL it landed on the customer's newest OPEN enquiry.
3. Remove a `submitted` car → it disappears; confirm in SQL `removed_at` is set and the row still exists.
4. Open `/public/my-cars/garbage` → the invalid-link card, no crash.
5. Revoke the token (`SELECT revoke_customer_portal_token('<token>');`) → reload → invalid-link card.

- [ ] **Step 5: Commit**

```bash
git branch --show-current   # must print feat/customer-self-serve-vehicles
git add apps/public-pages/src/pages/MyCars.tsx apps/public-pages/src/router.tsx
git commit -m "feat(public): customer self-serve car list at /public/my-cars/\$token

Permanent unauthenticated link. IC is masked by the RPC, phone and email
are never returned. Remove is offered only for submitted/quoted cars."
```

---

### Task 6: Agent portal — copy link, hide removed cars

**Files:**
- Modify: `apps/agent-portal/src/hooks/useMyEnquiries.ts:37`
- Modify: `apps/agent-portal/src/pages/MyEnquiries.tsx` (CardHeader at lines 174-191)

**Interfaces:**
- Consumes: `ensure_customer_portal_token(p_enquiry_id uuid) RETURNS text` (Task 1); route `/public/my-cars/$token` (Task 5).

- [ ] **Step 1: Hide removed cars from the agent's view**

In `useMyEnquiries.ts:37`, the embed is currently:
```ts
vehicles:enquiry_vehicles(*, product:insurance_products(name), merchant:merchants(id, name))
```
A plain `.select()` string cannot filter an embedded resource; add a filter on the embedded column to the query builder:
```ts
.is('vehicles.removed_at', null)
```
Agents see live cars only. (Admins keep seeing removed ones — Task 7.)

- [ ] **Step 2: Add the copy-link button**

In `MyEnquiries.tsx`, reuse the copy pattern from `MyLinks.tsx:108-115` verbatim, including `VITE_PUBLIC_PAGES_URL || window.location.origin`:

```tsx
const [copiedId, setCopiedId] = useState<string | null>(null);

const handleCopyMyCars = async (enquiryId: string) => {
  const { data, error } = await supabase.rpc('ensure_customer_portal_token', {
    p_enquiry_id: enquiryId,
  });
  if (error || !data) {
    toast({ title: 'Could not create the link', description: error?.message, variant: 'error' });
    return;
  }
  const publicPagesUrl = import.meta.env.VITE_PUBLIC_PAGES_URL || window.location.origin;
  await navigator.clipboard.writeText(`${publicPagesUrl}/public/my-cars/${data}`);
  setCopiedId(enquiryId);
  toast({ title: 'Link copied!', description: "Share this with the customer to manage their cars." });
  setTimeout(() => setCopiedId(null), 2000);
};
```

Render it in the `CardHeader` (lines 174-191), beside the existing `<Badge>`:

```tsx
<Button variant="outline" size="sm" onClick={() => handleCopyMyCars(enq.id)}>
  {copiedId === enq.id ? (
    <><Check className="size-4 mr-1 text-emerald-600" /> Copied!</>
  ) : (
    <><Copy className="size-4 mr-1" /> Copy my-cars link</>
  )}
</Button>
```

Import `Copy`, `Check` from `lucide-react` and `useToast` from `@agent-system/shared-ui`.

- [ ] **Step 2b: Confirm `VITE_PUBLIC_PAGES_URL` is set**

This var already gates the existing MyLinks copy button, and project history records it being missing in prod once. Confirm it is present on the agent-portal Render service before Task 8; without it the copied URL points at the agent portal's own origin and 404s.

- [ ] **Step 3: Build**

Run: `pnpm -r typecheck && pnpm --filter agent-portal build`
Expected: typecheck Done; `✓ built in ...`.

- [ ] **Step 4: Commit**

```bash
git branch --show-current   # must print feat/customer-self-serve-vehicles
git add apps/agent-portal/src/hooks/useMyEnquiries.ts apps/agent-portal/src/pages/MyEnquiries.tsx
git commit -m "feat(agent): copy a customer's my-cars link; hide removed cars"
```

---

### Task 7: Admin portal — copy link, revoke, show removed cars marked

**Files:**
- Modify: `apps/admin-portal/src/hooks/useEnquiries.ts` (types at 5-19 and 21-28; queries at 80 and 100-105)
- Modify: `apps/admin-portal/src/pages/enquiries/EnquiryDetail.tsx` (vehicle map at line 230)
- Modify: `apps/admin-portal/src/pages/enquiries/EnquiryList.tsx` (counts at 137-138)

**Interfaces:**
- Consumes: `ensure_customer_portal_token(p_enquiry_id uuid)`, `revoke_customer_portal_token(p_token text)` (Task 1).

**Admin keeps seeing removed cars** — that is the point of a soft delete. They must be visibly marked, and excluded from the open/total counts so the list doesn't overstate.

- [ ] **Step 1: Select the soft-delete fields**

Add `removed_at` and `removed_by_customer` to both vehicle embeds (`useEnquiries.ts:80` and `:100-105`) and to `EnquiryVehicleRow` / `EnquiryListVehicle`:
```ts
  removed_at: string | null;
  removed_by_customer: boolean;
```

- [ ] **Step 2: Exclude removed cars from counts**

`EnquiryList.tsx:137-138` currently:
```tsx
const total = e.vehicles?.length ?? 0;
const open = (e.vehicles ?? []).filter(
  (v) => v.status === VehicleStatus.SUBMITTED || v.status === VehicleStatus.QUOTED
).length;
```
Change to count live cars only:
```tsx
const live = (e.vehicles ?? []).filter((v) => v.removed_at === null);
const total = live.length;
const open = live.filter(
  (v) => v.status === VehicleStatus.SUBMITTED || v.status === VehicleStatus.QUOTED
).length;
```
Apply the same `removed_at === null` filter to the vehicle search predicate at `EnquiryList.tsx:99`.

- [ ] **Step 3: Mark removed cars in the detail view**

In `EnquiryDetail.tsx:230`, in the vehicle row, render a badge when removed and hide the action buttons for that row:
```tsx
{v.removed_at !== null && (
  <Badge variant="secondary" className="ml-1 text-[10px]">Removed by customer</Badge>
)}
```

- [ ] **Step 4: Add copy-link and revoke**

On `EnquiryDetail.tsx`, add a "Copy my-cars link" button calling `ensure_customer_portal_token` (same shape as Task 6 Step 2), and a "Revoke link" button calling `revoke_customer_portal_token`, confirmed via `AlertDialog` (the pattern used by `AgentList.tsx:284-299`).

- [ ] **Step 5: Build**

Run: `pnpm -r typecheck && pnpm --filter admin-portal build`
Expected: typecheck Done; `✓ built in ...`.

- [ ] **Step 6: Commit**

```bash
git branch --show-current   # must print feat/customer-self-serve-vehicles
git add apps/admin-portal/src/hooks/useEnquiries.ts apps/admin-portal/src/pages/enquiries/EnquiryDetail.tsx apps/admin-portal/src/pages/enquiries/EnquiryList.tsx
git commit -m "feat(admin): my-cars link + revoke; removed cars shown but not counted"
```

---

### Task 8: Deploy

**Files:** none — deployment only.

- [ ] **Step 1: Re-verify staging**

Re-run the assertions from Task 2 Steps 3-5 and Task 3 Steps 4-5. All must pass.

- [ ] **Step 2: Check the expiry-reminder edge function**

`supabase/functions/send-expiry-reminders/index.ts:167-188` re-reads the vehicle by id before sending. `enqueue_expiry_reminders` (Task 3) is the real gate, but add a `removed_at` guard here as defence in depth, then deploy the function to staging and prod.

- [ ] **Step 3: Apply migrations to production**

Apply `20260716000002`, `20260716000003`, `20260716000004` **in that order** to `mjtdsevynrtcmafsnxsj` via MCP `apply_migration`.

**Never** `supabase db push` — prod migration history uses timestamps unrelated to repo filename prefixes.

- [ ] **Step 4: Verify production**

```sql
SELECT
  (SELECT count(*) FROM pg_tables WHERE tablename = 'customer_portal_tokens')                  AS token_table,
  (SELECT count(*) FROM information_schema.columns
     WHERE table_name = 'enquiry_vehicles' AND column_name = 'removed_at')                     AS removed_at_col,
  (SELECT count(*) FROM pg_proc WHERE proname IN
     ('get_customer_cars','customer_add_vehicle','customer_remove_vehicle',
      'ensure_customer_portal_token','revoke_customer_portal_token'))                          AS rpcs_present,
  (SELECT count(*) FROM enquiry_vehicles WHERE removed_at IS NOT NULL)                         AS removed_rows;
```

Expected: `token_table=1`, `removed_at_col=1`, `rpcs_present=5`, `removed_rows=0`.

- [ ] **Step 5: Confirm `VITE_PUBLIC_PAGES_URL`**

Confirm it is set on BOTH the admin-portal and agent-portal Render services. Without it the copy button yields a URL on the portal's own origin, which 404s.

- [ ] **Step 6: Open the PR**

DB goes before the merge: the new pages call RPCs that must already exist, and Render auto-deploys on merge.

```bash
git push -u origin feat/customer-self-serve-vehicles
gh pr create --title "feat(partner): customer self-serve vehicle list" --body "$(cat <<'EOF'
## What

A permanent unauthenticated link per customer — `/public/my-cars/$token` — where they view, add and remove their own cars.

- Token keyed on normalized NRIC, so a customer with several enquiries gets ONE link covering all their cars.
- Three anon SECURITY DEFINER RPCs are the whole public surface; `enquiries`/`enquiry_vehicles` keep zero anon policies.
- IC is masked by the RPC (last 4 only); phone and email are never returned. A vehicle belonging to another NRIC reports the same P0012 as a bad token, so the id is never confirmed.
- Remove is a soft delete, refused for renewed/lost cars (gift voucher + settlement attached).
- Admins can revoke a link; agents and admins copy it from their portals.

## The ripple

`removed_at` is not local. Patched every site that counts vehicles: both enquiry-close predicates (a removed last car left the enquiry stuck open), the expiry reminder window (we emailed about deleted cars), merchant lead counts, and `reassign_customer_agent`'s open-work test.

## Deployed before merge

Migrations 20260716000002/3/4 applied to staging + prod via MCP.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

- [ ] **Step 7: Verify in production**

Mint a link for one real customer, open it, confirm the cars list and the masked IC, and confirm via devtools that no phone/email is in the response. Do not add or remove a car on a real customer's record.
