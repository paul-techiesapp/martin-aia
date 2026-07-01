# Merchant Partnership — Phase 3: Admin Pipeline & Ledgers — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the admin pipeline that moves each enquiry vehicle through its lifecycle (`submitted → quoted → renewed | lost`) and, on confirmed renewal, atomically mints the three payout ledgers — a customer **gift voucher**, an **agent commission** (when the branch link is tied to an agent), and a **merchant settlement**. Add the admin UIs: an **Enquiries** inbox + detail with per-vehicle actions, a **Gifts** voucher page (mark redeemed), and **Agent Commissions** + **Merchant Settlements** payout pages (set paid/failed) that mirror the existing Rewards page.

**Architecture:** One additive SQL migration adds six admin-only `SECURITY DEFINER` RPCs over the Phase 1 tables (`enquiry_vehicles`, `enquiries`, `merchants`, `merchant_branches`, `gifts`, `merchant_commissions`, `merchant_settlements`). `confirm_vehicle_renewal` is the transactional core: it locks the vehicle row, computes the percentage split from the merchant's fixed pool, and inserts the three ledgers idempotently (the `UNIQUE(enquiry_vehicle_id)` on each ledger + a voucher-code retry loop). Status-transition RPCs mirror the existing `set_reward_status` pattern. The admin UI copies the `useRewards.ts` / `Rewards.tsx` hook+page pattern; routes are registered in `router.tsx` and nav in `Layout.tsx`.

**Tech Stack:** Supabase (Postgres 15 + RLS), React 18 + Vite + TypeScript, TanStack Router (code-based routes in `src/router.tsx`), TanStack Query, shadcn/ui (`@agent-system/shared-ui`), react-hook-form/zod, pnpm workspaces.

## Global Constraints

- **No test framework** in this repo. Verify frontend with `pnpm --filter admin-portal build` (runs `tsc && vite build`). **Never add vitest/jest/any test runner.**
- **DB verification (NOT `db reset`):** apply pending migrations to the already-running local stack with `npx supabase migration up`, then run assertions through Docker because **local `psql` is NOT installed**:
  ```bash
  docker exec supabase_db_DATA psql -U postgres -d postgres -tAc "<SQL>"
  ```
  (`npx supabase start` must be running first. Production is applied later via MCP `apply_migration`, NOT `db push`.)
- **Migration filenames:** `supabase/migrations/YYYYMMDDNNNNNN_name.sql`, strictly increasing after the latest existing (`20260627000003`). Phase 3 owns the `20260628000010..` block (Phase 2 uses `20260628000001..`, which sorts before this; Phase 4 uses `20260628000020..`). Use the exact filename in Task 1.
- **Reuse existing DB helpers — do NOT redefine:** `is_admin()` (reads non-spoofable `app_metadata.role`), `get_agent_id()`, `update_updated_at()`. Mirror the existing `set_reward_status` RPC shape: `LANGUAGE plpgsql SECURITY DEFINER SET search_path = public`, `IF NOT is_admin() THEN RAISE EXCEPTION ... USING ERRCODE = '42501'`, then `GRANT EXECUTE ... TO authenticated`.
- **Idempotency:** every ledger has `UNIQUE(enquiry_vehicle_id)` (created in Phase 1). `confirm_vehicle_renewal` MUST be safe to call twice (it preserves the original `renewed_at/renewed_by` and never double-inserts a ledger).
- **Money:** all amounts `NUMERIC(10,2)`; the customer gift share is always derived as `pool × (100 - merchant_share_pct)/100` and the merchant settlement as `pool × merchant_share_pct/100` (the pct is never re-stored on the ledger). Round to 2 dp explicitly.
- **Voucher code:** `upper(substring(replace(gen_random_uuid()::text, '-', '') FOR 10))`; `gifts.voucher_code` is `UNIQUE`, so generation is wrapped in a retry loop on `unique_violation`.
- **Reward-status reuse:** `merchant_commissions` / `merchant_settlements` reuse the existing `reward_status` enum (`pending | confirmed | paid | failed`). `paid` === "Issued/Sent" in the UI; the status RPCs stamp `paid_at` + `set_by` (NOT `issued_at`, which is a `rewards`-only column).
- **Supabase client:** in `admin-portal`, import `supabase` from `../lib/supabase` (the single shared-ui client re-export). Never call `createClient`.
- **Naming:** database objects use `merchant*` / domain nouns; "partner" is reserved for the existing recruiter concept. UI labels this area **"Partnerships"**; the new nav items are **Enquiries**, **Gifts**, **Commissions**, **Settlements**.
- **Git:** work on branch `feat/merchant-partnership`; one commit per task; never commit to `main`. Verify the branch with `git rev-parse --abbrev-ref HEAD` before each commit.

---

## File Structure

**Created:**
- `supabase/migrations/20260628000010_merchant_pipeline_rpcs.sql` — the 6 admin RPCs (`record_quotation`, `mark_vehicle_lost`, `confirm_vehicle_renewal`, `mark_gift_redeemed`, `set_merchant_commission_status`, `set_merchant_settlement_status`)
- `apps/admin-portal/src/hooks/useEnquiries.ts`
- `apps/admin-portal/src/hooks/useGifts.ts`
- `apps/admin-portal/src/hooks/useMerchantCommissions.ts`
- `apps/admin-portal/src/hooks/useMerchantSettlements.ts`
- `apps/admin-portal/src/pages/enquiries/EnquiryList.tsx`
- `apps/admin-portal/src/pages/enquiries/EnquiryDetail.tsx`
- `apps/admin-portal/src/pages/gifts/GiftList.tsx`
- `apps/admin-portal/src/pages/commissions/MerchantCommissionList.tsx`
- `apps/admin-portal/src/pages/settlements/MerchantSettlementList.tsx`

**Modified:**
- `apps/admin-portal/src/router.tsx` — add 5 routes (`/enquiries`, `/enquiries/$enquiryId`, `/gifts`, `/commissions`, `/settlements`)
- `apps/admin-portal/src/components/Layout.tsx` — add 4 nav entries (Enquiries, Gifts, Commissions, Settlements)

**Consumes (already exist from Phase 1 — do not recreate):** tables `enquiries`, `enquiry_vehicles`, `merchants`, `merchant_branches`, `gifts`, `merchant_commissions`, `merchant_settlements`, `insurance_products`, `agents`, `tiers`; enums `vehicle_status`, `enquiry_status`, `gift_status`, `reward_status`; TS enums `VehicleStatus`, `EnquiryStatus`, `GiftStatus`, `RewardStatus` and interfaces in `packages/shared-types/src/merchant.ts`; helpers `is_admin()`, `auth.uid()`.

---

## Per-vehicle status state machine (authoritative)

```
                 record_quotation(p_vehicle_id, p_external_ref)
   submitted  ───────────────────────────────────────────────▶  quoted
       │                                                            │
       │  mark_vehicle_lost(p_vehicle_id, p_reason)                 │  confirm_vehicle_renewal(p_vehicle_id)
       │                                                            │     → mints gift + commission(if tied agent) + settlement
       ▼                                                            ▼
     lost  ◀──── mark_vehicle_lost ────────────────────────────  renewed   (terminal)
   (terminal)
```

- `record_quotation`: allowed from `submitted` **or** `quoted` (re-recording the external ref); sets `quoted`, stamps `external_quotation_ref`, `quoted_at`, `quoted_by`. Blocked from `renewed`/`lost`.
- `confirm_vehicle_renewal`: allowed from `submitted` or `quoted` (and idempotent if already `renewed`); blocked from `lost`. Sets `renewed`, stamps `renewed_at`/`renewed_by`, mints ledgers.
- `mark_vehicle_lost`: allowed from `submitted` or `quoted` (idempotent if already `lost`); blocked from `renewed`. Sets `lost`, stamps `lost_at`/`lost_reason`.
- After `confirm_vehicle_renewal` and `mark_vehicle_lost`, the parent `enquiries.status` rolls up to `closed` once **every** child vehicle is terminal (`renewed` or `lost`).
- `mark_gift_redeemed`: `gifts.status` `issued → redeemed`, stamps `redeemed_at`/`redeemed_by`.
- `set_merchant_commission_status` / `set_merchant_settlement_status`: `reward_status` transitions stamping `paid_at` (on `paid`), `failure_reason` (on `failed`), `set_by`, `updated_at`.

---

## Task 1: Migration — admin pipeline RPCs (quotation, lost, the renewal core, redeem, two payout-status setters)

**Files:**
- Create: `supabase/migrations/20260628000010_merchant_pipeline_rpcs.sql`

**Interfaces:**
- Consumes: `enquiry_vehicles`, `enquiries`, `merchants`, `merchant_branches`, `gifts`, `merchant_commissions`, `merchant_settlements`, `agents`, `tiers`; enums `vehicle_status`, `gift_status`, `reward_status`; helpers `is_admin()`, `auth.uid()`.
- Produces: RPCs `record_quotation(uuid, text)`, `mark_vehicle_lost(uuid, text)`, `confirm_vehicle_renewal(uuid)`, `mark_gift_redeemed(uuid)`, `set_merchant_commission_status(uuid, reward_status, text)`, `set_merchant_settlement_status(uuid, reward_status, text)`.

- [ ] **Step 1: Write the migration file**

Create `supabase/migrations/20260628000010_merchant_pipeline_rpcs.sql`:

```sql
-- ============================================================
-- Merchant Partnership — Phase 3 admin pipeline RPCs
--
-- Six admin-only SECURITY DEFINER functions drive the per-vehicle
-- lifecycle (submitted -> quoted -> renewed | lost) and the payout
-- ledgers minted on a confirmed renewal. All guard with is_admin()
-- and mirror the existing set_reward_status pattern.
-- ============================================================

-- record_quotation: submitted|quoted -> quoted, stamp the external ref ----
CREATE OR REPLACE FUNCTION record_quotation(p_vehicle_id uuid, p_external_ref text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_status vehicle_status;
BEGIN
  IF NOT is_admin() THEN
    RAISE EXCEPTION 'Only admins can record a quotation' USING ERRCODE = '42501';
  END IF;

  SELECT status INTO v_status FROM enquiry_vehicles WHERE id = p_vehicle_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Vehicle % not found', p_vehicle_id USING ERRCODE = 'P0002';
  END IF;
  IF v_status NOT IN ('submitted', 'quoted') THEN
    RAISE EXCEPTION 'Vehicle % is % and cannot be quoted', p_vehicle_id, v_status USING ERRCODE = '22023';
  END IF;

  UPDATE enquiry_vehicles
     SET status                 = 'quoted',
         external_quotation_ref = p_external_ref,
         quoted_at              = now(),
         quoted_by              = auth.uid()
   WHERE id = p_vehicle_id;
END;
$$;

-- mark_vehicle_lost: submitted|quoted -> lost, then roll the enquiry up ----
CREATE OR REPLACE FUNCTION mark_vehicle_lost(p_vehicle_id uuid, p_reason text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_enquiry_id uuid;
  v_status     vehicle_status;
BEGIN
  IF NOT is_admin() THEN
    RAISE EXCEPTION 'Only admins can mark a vehicle lost' USING ERRCODE = '42501';
  END IF;

  SELECT enquiry_id, status INTO v_enquiry_id, v_status
  FROM enquiry_vehicles WHERE id = p_vehicle_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Vehicle % not found', p_vehicle_id USING ERRCODE = 'P0002';
  END IF;
  IF v_status = 'renewed' THEN
    RAISE EXCEPTION 'Cannot mark a renewed vehicle as lost' USING ERRCODE = '22023';
  END IF;

  UPDATE enquiry_vehicles
     SET status      = 'lost',
         lost_at     = COALESCE(lost_at, now()),
         lost_reason = p_reason
   WHERE id = p_vehicle_id;

  -- Close the enquiry once every vehicle is terminal (renewed or lost).
  UPDATE enquiries e
     SET status = 'closed'
   WHERE e.id = v_enquiry_id
     AND e.status <> 'closed'
     AND NOT EXISTS (
       SELECT 1 FROM enquiry_vehicles ev
       WHERE ev.enquiry_id = v_enquiry_id
         AND ev.status NOT IN ('renewed', 'lost')
     );
END;
$$;

-- confirm_vehicle_renewal: the transactional payout core --------------------
-- 1) lock + flip the vehicle to renewed (preserve original stamps on re-run)
-- 2) mint the customer gift voucher  (value = pool * (100 - share_pct)/100)
-- 3) mint the agent commission       (amount = agent tier reward_amount) IFF tied
-- 4) mint the merchant settlement     (amount = pool * share_pct/100)
-- 5) roll the enquiry up to 'closed' when every vehicle is terminal
-- Idempotent: UNIQUE(enquiry_vehicle_id) on each ledger + ON CONFLICT / pre-check.
CREATE OR REPLACE FUNCTION confirm_vehicle_renewal(p_vehicle_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_enquiry_id      uuid;
  v_branch_id       uuid;
  v_status          vehicle_status;
  v_merchant_id     uuid;
  v_pool            numeric(10,2);
  v_share_pct       numeric(5,2);
  v_customer_amount numeric(10,2);
  v_merchant_amount numeric(10,2);
  v_agent_id        uuid;
  v_tier_id         uuid;
  v_reward_amount   numeric(10,2);
  v_voucher_code    text;
BEGIN
  IF NOT is_admin() THEN
    RAISE EXCEPTION 'Only admins can confirm a renewal' USING ERRCODE = '42501';
  END IF;

  -- Lock the vehicle so the whole mint is serialized per vehicle.
  SELECT ev.enquiry_id, ev.merchant_branch_id, ev.status
    INTO v_enquiry_id, v_branch_id, v_status
  FROM enquiry_vehicles ev
  WHERE ev.id = p_vehicle_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Vehicle % not found', p_vehicle_id USING ERRCODE = 'P0002';
  END IF;
  IF v_status = 'lost' THEN
    RAISE EXCEPTION 'Cannot renew a vehicle that is marked lost' USING ERRCODE = '22023';
  END IF;

  -- Merchant split via the vehicle's branch.
  SELECT b.merchant_id, m.gift_pool_amount, m.merchant_share_pct
    INTO v_merchant_id, v_pool, v_share_pct
  FROM merchant_branches b
  JOIN merchants m ON m.id = b.merchant_id
  WHERE b.id = v_branch_id;

  v_customer_amount := round(v_pool * (100 - v_share_pct) / 100, 2);
  v_merchant_amount := round(v_pool * v_share_pct / 100, 2);

  -- Tied agent snapshot (NULL = house branch -> no commission, per spec decision #9).
  SELECT e.agent_id INTO v_agent_id FROM enquiries e WHERE e.id = v_enquiry_id;

  -- 1) Flip vehicle to renewed (keep original stamps if this is a re-run).
  UPDATE enquiry_vehicles
     SET status     = 'renewed',
         renewed_at = COALESCE(renewed_at, now()),
         renewed_by = COALESCE(renewed_by, auth.uid())
   WHERE id = p_vehicle_id;

  -- 2) Customer gift voucher. Idempotent on enquiry_vehicle_id; retry on code collision.
  IF NOT EXISTS (SELECT 1 FROM gifts WHERE enquiry_vehicle_id = p_vehicle_id) THEN
    LOOP
      v_voucher_code := upper(substring(replace(gen_random_uuid()::text, '-', '') FOR 10));
      BEGIN
        INSERT INTO gifts (enquiry_vehicle_id, merchant_id, merchant_branch_id,
                           value_amount, voucher_code, status, issued_at)
        VALUES (p_vehicle_id, v_merchant_id, v_branch_id,
                v_customer_amount, v_voucher_code, 'issued', now());
        EXIT;
      EXCEPTION WHEN unique_violation THEN
        -- Either a concurrent call already minted the gift (enquiry_vehicle_id),
        -- or the random voucher_code collided. If the gift now exists, stop;
        -- otherwise regenerate the code and retry.
        IF EXISTS (SELECT 1 FROM gifts WHERE enquiry_vehicle_id = p_vehicle_id) THEN
          EXIT;
        END IF;
      END;
    END LOOP;
  END IF;

  -- 3) Agent commission (only when the branch link was tied to an agent).
  IF v_agent_id IS NOT NULL THEN
    SELECT a.tier_id, t.reward_amount
      INTO v_tier_id, v_reward_amount
    FROM agents a
    LEFT JOIN tiers t ON t.id = a.tier_id
    WHERE a.id = v_agent_id;

    INSERT INTO merchant_commissions (enquiry_vehicle_id, agent_id, tier_id, amount, status)
    VALUES (p_vehicle_id, v_agent_id, v_tier_id, COALESCE(v_reward_amount, 0), 'pending')
    ON CONFLICT (enquiry_vehicle_id) DO NOTHING;
  END IF;

  -- 4) Merchant payable settlement.
  INSERT INTO merchant_settlements (enquiry_vehicle_id, merchant_id, amount, status)
  VALUES (p_vehicle_id, v_merchant_id, v_merchant_amount, 'pending')
  ON CONFLICT (enquiry_vehicle_id) DO NOTHING;

  -- 5) Roll the enquiry up to 'closed' once every vehicle is terminal.
  UPDATE enquiries e
     SET status = 'closed'
   WHERE e.id = v_enquiry_id
     AND e.status <> 'closed'
     AND NOT EXISTS (
       SELECT 1 FROM enquiry_vehicles ev
       WHERE ev.enquiry_id = v_enquiry_id
         AND ev.status NOT IN ('renewed', 'lost')
     );
END;
$$;

-- mark_gift_redeemed: issued -> redeemed -----------------------------------
CREATE OR REPLACE FUNCTION mark_gift_redeemed(p_gift_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_status gift_status;
BEGIN
  IF NOT is_admin() THEN
    RAISE EXCEPTION 'Only admins can redeem a gift' USING ERRCODE = '42501';
  END IF;

  SELECT status INTO v_status FROM gifts WHERE id = p_gift_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Gift % not found', p_gift_id USING ERRCODE = 'P0002';
  END IF;
  IF v_status <> 'issued' THEN
    RAISE EXCEPTION 'Gift % is % and cannot be redeemed', p_gift_id, v_status USING ERRCODE = '22023';
  END IF;

  UPDATE gifts
     SET status      = 'redeemed',
         redeemed_at = now(),
         redeemed_by = auth.uid()
   WHERE id = p_gift_id;
END;
$$;

-- set_merchant_commission_status: mirror set_reward_status (stamp paid_at + set_by) --
CREATE OR REPLACE FUNCTION set_merchant_commission_status(
  p_id             uuid,
  p_status         reward_status,
  p_failure_reason text DEFAULT NULL
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT is_admin() THEN
    RAISE EXCEPTION 'Only admins can change commission status' USING ERRCODE = '42501';
  END IF;

  UPDATE merchant_commissions SET
    status         = p_status,
    paid_at        = CASE WHEN p_status = 'paid'   THEN now()            ELSE NULL END,
    failure_reason = CASE WHEN p_status = 'failed' THEN p_failure_reason ELSE NULL END,
    set_by         = auth.uid(),
    updated_at     = now()
  WHERE id = p_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Commission % not found', p_id USING ERRCODE = 'P0002';
  END IF;
END;
$$;

-- set_merchant_settlement_status: same, against merchant_settlements --------
CREATE OR REPLACE FUNCTION set_merchant_settlement_status(
  p_id             uuid,
  p_status         reward_status,
  p_failure_reason text DEFAULT NULL
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT is_admin() THEN
    RAISE EXCEPTION 'Only admins can change settlement status' USING ERRCODE = '42501';
  END IF;

  UPDATE merchant_settlements SET
    status         = p_status,
    paid_at        = CASE WHEN p_status = 'paid'   THEN now()            ELSE NULL END,
    failure_reason = CASE WHEN p_status = 'failed' THEN p_failure_reason ELSE NULL END,
    set_by         = auth.uid(),
    updated_at     = now()
  WHERE id = p_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Settlement % not found', p_id USING ERRCODE = 'P0002';
  END IF;
END;
$$;

-- Grants (admin gate is enforced inside each body; callers are authenticated) --
GRANT EXECUTE ON FUNCTION record_quotation(uuid, text)                              TO authenticated;
GRANT EXECUTE ON FUNCTION mark_vehicle_lost(uuid, text)                             TO authenticated;
GRANT EXECUTE ON FUNCTION confirm_vehicle_renewal(uuid)                             TO authenticated;
GRANT EXECUTE ON FUNCTION mark_gift_redeemed(uuid)                                  TO authenticated;
GRANT EXECUTE ON FUNCTION set_merchant_commission_status(uuid, reward_status, text) TO authenticated;
GRANT EXECUTE ON FUNCTION set_merchant_settlement_status(uuid, reward_status, text) TO authenticated;
```

- [ ] **Step 2: Apply the pending migration (NOT a reset)**

Run: `npx supabase migration up`
Expected: completes without error; output lists `20260628000010_merchant_pipeline_rpcs.sql` as applied. (If the stack is not running, `npx supabase start` first.)

- [ ] **Step 3: Assert the six functions exist**

Run:
```bash
docker exec supabase_db_DATA psql -U postgres -d postgres -tAc \
"SELECT count(*) FROM pg_proc WHERE proname IN ('record_quotation','mark_vehicle_lost','confirm_vehicle_renewal','mark_gift_redeemed','set_merchant_commission_status','set_merchant_settlement_status');"
```
Expected output: `6`.

- [ ] **Step 4: Functional smoke test of the renewal core (impersonate admin, rolled back)**

This proves the split math, all three ledgers, the voucher length, idempotency, and the enquiry roll-up. It impersonates the seeded `admin@test.com` so `is_admin()` passes, builds a self-contained merchant→branch→link→enquiry→vehicle graph (pool RM1000, 40% merchant share ⇒ gift RM600, settlement RM400; a synthetic tier at RM77 ⇒ commission RM77), calls the RPCs **twice** to prove idempotency, asserts, then `ROLLBACK` so nothing persists.

Run:
```bash
docker exec supabase_db_DATA psql -U postgres -d postgres -tA <<'SQL'
BEGIN;
SELECT set_config('request.jwt.claims',
  (SELECT json_build_object('sub', id)::text FROM auth.users WHERE email = 'admin@test.com'), true);

INSERT INTO tiers (id, name, role_type, reward_amount, invitation_limit_per_slot)
  VALUES ('00000000-0000-0000-0000-0000000aa001','PhaseTestTier','agent',77.00,10);
INSERT INTO agents (id, user_id, name, email, phone, agent_code, unit_name, tier_id)
  VALUES ('00000000-0000-0000-0000-0000000aa002',
          (SELECT id FROM auth.users WHERE email='admin@test.com'),
          'PhaseTest Agent','phasetest-agent@example.com','+60000000001','PHTEST','PhaseTest Unit',
          '00000000-0000-0000-0000-0000000aa001');
INSERT INTO merchants (id, name, gift_pool_amount, merchant_share_pct, status)
  VALUES ('00000000-0000-0000-0000-0000000aa010','PhaseTest Merchant',1000,40,'active');
INSERT INTO merchant_branches (id, merchant_id, name, status)
  VALUES ('00000000-0000-0000-0000-0000000aa011','00000000-0000-0000-0000-0000000aa010','PhaseTest Branch','active');
INSERT INTO branch_links (id, merchant_branch_id, agent_id, link_code, is_active)
  VALUES ('00000000-0000-0000-0000-0000000aa012','00000000-0000-0000-0000-0000000aa011',
          '00000000-0000-0000-0000-0000000aa002','PHTESTLINK',true);
INSERT INTO enquiries (id, branch_link_id, merchant_branch_id, agent_id,
    customer_name, customer_nric, customer_nric_normalized, customer_phone, customer_phone_normalized, status)
  VALUES ('00000000-0000-0000-0000-0000000aa013','00000000-0000-0000-0000-0000000aa012','00000000-0000-0000-0000-0000000aa011',
          '00000000-0000-0000-0000-0000000aa002','PhaseTest Customer','S1234567A','S1234567A','+60123456789','60123456789','open');
INSERT INTO enquiry_vehicles (id, enquiry_id, merchant_branch_id, car_plate, car_plate_normalized,
    insurance_expiry_date, insurance_product_id, status)
  VALUES ('00000000-0000-0000-0000-0000000aa014','00000000-0000-0000-0000-0000000aa013','00000000-0000-0000-0000-0000000aa011',
          'ABC1234','ABC1234', current_date + 30, (SELECT id FROM insurance_products ORDER BY sort_order LIMIT 1), 'submitted');

SELECT record_quotation('00000000-0000-0000-0000-0000000aa014','Q-PHTEST');
SELECT confirm_vehicle_renewal('00000000-0000-0000-0000-0000000aa014');
SELECT confirm_vehicle_renewal('00000000-0000-0000-0000-0000000aa014');  -- idempotent second call

SELECT
  (SELECT status        FROM enquiry_vehicles     WHERE id = '00000000-0000-0000-0000-0000000aa014')                AS vehicle_status,     -- renewed
  (SELECT value_amount  FROM gifts                WHERE enquiry_vehicle_id = '00000000-0000-0000-0000-0000000aa014') AS gift_value,         -- 600.00
  (SELECT length(voucher_code) FROM gifts         WHERE enquiry_vehicle_id = '00000000-0000-0000-0000-0000000aa014') AS code_len,           -- 10
  (SELECT count(*)      FROM gifts                WHERE enquiry_vehicle_id = '00000000-0000-0000-0000-0000000aa014') AS gift_count,         -- 1 (idempotent)
  (SELECT amount        FROM merchant_settlements WHERE enquiry_vehicle_id = '00000000-0000-0000-0000-0000000aa014') AS settlement_amount,  -- 400.00
  (SELECT amount        FROM merchant_commissions WHERE enquiry_vehicle_id = '00000000-0000-0000-0000-0000000aa014') AS commission_amount,  -- 77.00
  (SELECT status        FROM enquiries            WHERE id = '00000000-0000-0000-0000-0000000aa013')                AS enquiry_status;      -- closed
ROLLBACK;
SQL
```
Expected single row: `renewed|600.00|10|1|400.00|77.00|closed`.

- [ ] **Step 5: Assert the admin guard rejects non-admins**

Run (no JWT claim set ⇒ `auth.uid()` is NULL ⇒ `is_admin()` false ⇒ raises `42501`):
```bash
docker exec supabase_db_DATA psql -U postgres -d postgres -tAc \
"SELECT confirm_vehicle_renewal('00000000-0000-0000-0000-000000000000');" 2>&1 | grep -c "Only admins"
```
Expected output: `1`.

- [ ] **Step 6: Commit**

```bash
git rev-parse --abbrev-ref HEAD   # must print feat/merchant-partnership
git add supabase/migrations/20260628000010_merchant_pipeline_rpcs.sql
git commit -m "feat(partnership): admin pipeline RPCs (quotation, lost, renewal mint, redeem, payout-status setters)"
```

---

## Task 2: Admin module — Enquiries inbox + detail with per-vehicle actions

**Files:**
- Create: `apps/admin-portal/src/hooks/useEnquiries.ts`
- Create: `apps/admin-portal/src/pages/enquiries/EnquiryList.tsx`
- Create: `apps/admin-portal/src/pages/enquiries/EnquiryDetail.tsx`
- Modify: `apps/admin-portal/src/router.tsx`
- Modify: `apps/admin-portal/src/components/Layout.tsx`

**Interfaces:**
- Consumes: `VehicleStatus`, `EnquiryStatus` types; `supabase`; RPCs `record_quotation`, `confirm_vehicle_renewal`, `mark_vehicle_lost`.
- Produces: hooks `useEnquiries`, `useEnquiry`, `useRecordQuotation`, `useConfirmVehicleRenewal`, `useMarkVehicleLost`; components `EnquiryList`, `EnquiryDetail`; routes `/enquiries`, `/enquiries/$enquiryId`.

- [ ] **Step 1: Create the hook**

Create `apps/admin-portal/src/hooks/useEnquiries.ts`:

```typescript
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { VehicleStatus, EnquiryStatus } from '@agent-system/shared-types';

export interface EnquiryVehicleRow {
  id: string;
  car_plate: string;
  insurance_expiry_date: string;
  status: VehicleStatus;
  external_quotation_ref: string | null;
  quoted_at: string | null;
  renewed_at: string | null;
  lost_at: string | null;
  lost_reason: string | null;
  product: { id: string; name: string } | null;
}

export interface EnquiryListRow {
  id: string;
  customer_name: string;
  customer_phone: string;
  customer_nric: string;
  status: EnquiryStatus;
  created_at: string;
  agent_id: string | null;
  branch: { id: string; name: string; merchant: { id: string; name: string } | null } | null;
  vehicles: { id: string; status: VehicleStatus }[];
}

export interface EnquiryDetailRow {
  id: string;
  customer_name: string;
  customer_phone: string;
  customer_nric: string;
  customer_email: string | null;
  status: EnquiryStatus;
  created_at: string;
  agent_id: string | null;
  branch: {
    id: string;
    name: string;
    merchant: { id: string; name: string; gift_pool_amount: number; merchant_share_pct: number } | null;
  } | null;
  agent: { id: string; name: string; agent_code: string } | null;
  vehicles: EnquiryVehicleRow[];
}

export function useEnquiries() {
  return useQuery({
    queryKey: ['enquiries'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('enquiries')
        .select(`
          id, customer_name, customer_phone, customer_nric, status, created_at, agent_id,
          branch:merchant_branches(id, name, merchant:merchants(id, name)),
          vehicles:enquiry_vehicles(id, status)
        `)
        .order('created_at', { ascending: false });

      if (error) throw error;
      return (data ?? []) as unknown as EnquiryListRow[];
    },
  });
}

export function useEnquiry(id: string) {
  return useQuery({
    queryKey: ['enquiries', id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('enquiries')
        .select(`
          id, customer_name, customer_phone, customer_nric, customer_email, status, created_at, agent_id,
          branch:merchant_branches(id, name, merchant:merchants(id, name, gift_pool_amount, merchant_share_pct)),
          agent:agents(id, name, agent_code),
          vehicles:enquiry_vehicles(
            id, car_plate, insurance_expiry_date, status, external_quotation_ref,
            quoted_at, renewed_at, lost_at, lost_reason,
            product:insurance_products(id, name)
          )
        `)
        .eq('id', id)
        .single();

      if (error) throw error;
      return data as unknown as EnquiryDetailRow;
    },
    enabled: !!id,
  });
}

export function useRecordQuotation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      vehicleId,
      externalRef,
    }: {
      vehicleId: string;
      enquiryId: string;
      externalRef: string | null;
    }) => {
      const { error } = await supabase.rpc('record_quotation', {
        p_vehicle_id: vehicleId,
        p_external_ref: externalRef,
      });
      if (error) throw error;
    },
    onSuccess: (_data, vars) => {
      queryClient.invalidateQueries({ queryKey: ['enquiries'] });
      queryClient.invalidateQueries({ queryKey: ['enquiries', vars.enquiryId] });
    },
  });
}

export function useMarkVehicleLost() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      vehicleId,
      reason,
    }: {
      vehicleId: string;
      enquiryId: string;
      reason: string | null;
    }) => {
      const { error } = await supabase.rpc('mark_vehicle_lost', {
        p_vehicle_id: vehicleId,
        p_reason: reason,
      });
      if (error) throw error;
    },
    onSuccess: (_data, vars) => {
      queryClient.invalidateQueries({ queryKey: ['enquiries'] });
      queryClient.invalidateQueries({ queryKey: ['enquiries', vars.enquiryId] });
    },
  });
}

export function useConfirmVehicleRenewal() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ vehicleId }: { vehicleId: string; enquiryId: string }) => {
      const { error } = await supabase.rpc('confirm_vehicle_renewal', { p_vehicle_id: vehicleId });
      if (error) throw error;
    },
    onSuccess: (_data, vars) => {
      queryClient.invalidateQueries({ queryKey: ['enquiries'] });
      queryClient.invalidateQueries({ queryKey: ['enquiries', vars.enquiryId] });
      // Renewal mints ledgers — refresh the payout pages too.
      queryClient.invalidateQueries({ queryKey: ['gifts'] });
      queryClient.invalidateQueries({ queryKey: ['merchant-commissions'] });
      queryClient.invalidateQueries({ queryKey: ['merchant-settlements'] });
    },
  });
}
```

- [ ] **Step 2: Create the inbox list page**

Create `apps/admin-portal/src/pages/enquiries/EnquiryList.tsx`:

```tsx
import { useMemo, useState } from 'react';
import { Link } from '@tanstack/react-router';
import {
  Button,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Badge,
  TableSkeleton,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Label,
} from '@agent-system/shared-ui';
import { EnquiryStatus, VehicleStatus } from '@agent-system/shared-types';
import { useEnquiries, type EnquiryListRow } from '../../hooks/useEnquiries';

function fmtDate(value: string): string {
  return new Date(value).toLocaleDateString('en-SG', { dateStyle: 'medium' });
}

export function EnquiryList() {
  const { data: enquiries, isLoading, error } = useEnquiries();
  const [statusFilter, setStatusFilter] = useState<string>('all');

  const filtered = useMemo(
    () => (enquiries ?? []).filter((e) => statusFilter === 'all' || e.status === statusFilter),
    [enquiries, statusFilter]
  );

  const vehicleSummary = (e: EnquiryListRow) => {
    const total = e.vehicles?.length ?? 0;
    const open = (e.vehicles ?? []).filter(
      (v) => v.status === VehicleStatus.SUBMITTED || v.status === VehicleStatus.QUOTED
    ).length;
    return `${total} car${total === 1 ? '' : 's'}${open > 0 ? ` · ${open} open` : ''}`;
  };

  if (error) {
    return (
      <Card>
        <CardContent className="py-4">
          <p className="text-destructive">Error loading enquiries: {error.message}</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="flex flex-col gap-4 animate-fade-in">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">Enquiries</h1>
          <p className="text-sm text-muted-foreground">
            Customer car-insurance enquiries from partner branches. Open one to quote, renew, or mark each car lost.
          </p>
        </div>
        <div className="w-40">
          <Label className="text-sm font-medium">Status</Label>
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="mt-1">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All</SelectItem>
              <SelectItem value={EnquiryStatus.OPEN}>Open</SelectItem>
              <SelectItem value={EnquiryStatus.CLOSED}>Closed</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Inbox</CardTitle>
          <CardDescription>{filtered.length} enquiries</CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <TableSkeleton rows={6} columns={6} />
          ) : (
            <div className="overflow-auto rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow className="hover:bg-transparent">
                    <TableHead>Customer</TableHead>
                    <TableHead>Branch</TableHead>
                    <TableHead>Source</TableHead>
                    <TableHead>Cars</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Received</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filtered.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={6} className="text-center text-muted-foreground py-6">
                        No enquiries match the current filter.
                      </TableCell>
                    </TableRow>
                  ) : (
                    filtered.map((e) => (
                      <TableRow key={e.id}>
                        <TableCell className="font-medium">
                          <Link
                            to="/enquiries/$enquiryId"
                            params={{ enquiryId: e.id }}
                            className="hover:underline"
                          >
                            {e.customer_name}
                          </Link>
                          <div className="text-xs text-muted-foreground">{e.customer_phone}</div>
                        </TableCell>
                        <TableCell className="text-muted-foreground">
                          {e.branch?.merchant?.name ?? '—'}
                          <div className="text-xs">{e.branch?.name ?? ''}</div>
                        </TableCell>
                        <TableCell className="text-muted-foreground">
                          {e.agent_id ? 'Agent' : 'House'}
                        </TableCell>
                        <TableCell className="text-muted-foreground">{vehicleSummary(e)}</TableCell>
                        <TableCell>
                          <Badge variant={e.status === EnquiryStatus.CLOSED ? 'success' : 'warning'}>
                            {e.status === EnquiryStatus.CLOSED ? 'Closed' : 'Open'}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-muted-foreground">{fmtDate(e.created_at)}</TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
```

- [ ] **Step 3: Create the detail page (the per-vehicle state machine)**

Create `apps/admin-portal/src/pages/enquiries/EnquiryDetail.tsx`:

```tsx
import { useState } from 'react';
import { Link, useParams } from '@tanstack/react-router';
import {
  Button,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Badge,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  Label,
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  TableSkeleton,
  useToast,
} from '@agent-system/shared-ui';
import { ArrowLeft, FileText, CheckCircle2, XCircle } from 'lucide-react';
import { VehicleStatus } from '@agent-system/shared-types';
import {
  useEnquiry,
  useRecordQuotation,
  useConfirmVehicleRenewal,
  useMarkVehicleLost,
  type EnquiryVehicleRow,
} from '../../hooks/useEnquiries';

function fmtDate(value: string | null): string {
  if (!value) return '—';
  return new Date(value).toLocaleDateString('en-SG', { dateStyle: 'medium' });
}

function vehicleBadge(status: VehicleStatus): { label: string; variant: 'neutral' | 'warning' | 'success' | 'error' } {
  switch (status) {
    case VehicleStatus.QUOTED:
      return { label: 'Quoted', variant: 'warning' };
    case VehicleStatus.RENEWED:
      return { label: 'Renewed', variant: 'success' };
    case VehicleStatus.LOST:
      return { label: 'Lost', variant: 'error' };
    default:
      return { label: 'Submitted', variant: 'neutral' };
  }
}

export function EnquiryDetail() {
  const { enquiryId } = useParams({ strict: false }) as { enquiryId: string };
  const { toast } = useToast();
  const { data: enquiry, isLoading, error } = useEnquiry(enquiryId);
  const recordQuotation = useRecordQuotation();
  const confirmRenewal = useConfirmVehicleRenewal();
  const markLost = useMarkVehicleLost();

  // Record-quotation dialog
  const [quoteTarget, setQuoteTarget] = useState<EnquiryVehicleRow | null>(null);
  const [quoteRef, setQuoteRef] = useState('');
  // Mark-lost dialog
  const [lostTarget, setLostTarget] = useState<EnquiryVehicleRow | null>(null);
  const [lostReason, setLostReason] = useState('');
  // Mark-renewed confirm
  const [renewTarget, setRenewTarget] = useState<EnquiryVehicleRow | null>(null);

  const pending = recordQuotation.isPending || confirmRenewal.isPending || markLost.isPending;

  const submitQuote = async () => {
    if (!quoteTarget) return;
    try {
      await recordQuotation.mutateAsync({
        vehicleId: quoteTarget.id,
        enquiryId,
        externalRef: quoteRef.trim() === '' ? null : quoteRef.trim(),
      });
      toast({ title: 'Quotation recorded' });
      setQuoteTarget(null);
      setQuoteRef('');
    } catch (err: any) {
      toast({ title: 'Failed to record quotation', description: err.message, variant: 'error' });
    }
  };

  const submitRenew = async () => {
    if (!renewTarget) return;
    try {
      await confirmRenewal.mutateAsync({ vehicleId: renewTarget.id, enquiryId });
      toast({ title: 'Renewal confirmed — gift, commission & settlement created' });
      setRenewTarget(null);
    } catch (err: any) {
      toast({ title: 'Failed to confirm renewal', description: err.message, variant: 'error' });
    }
  };

  const submitLost = async () => {
    if (!lostTarget) return;
    try {
      await markLost.mutateAsync({
        vehicleId: lostTarget.id,
        enquiryId,
        reason: lostReason.trim() === '' ? null : lostReason.trim(),
      });
      toast({ title: 'Vehicle marked lost' });
      setLostTarget(null);
      setLostReason('');
    } catch (err: any) {
      toast({ title: 'Failed to mark lost', description: err.message, variant: 'error' });
    }
  };

  if (error) {
    return (
      <Card>
        <CardContent className="py-4">
          <p className="text-destructive">Error loading enquiry: {error.message}</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="flex flex-col gap-4 animate-fade-in">
      <div>
        <Link to="/enquiries" className="inline-flex items-center text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft className="size-4 mr-1" />
          Back to Enquiries
        </Link>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>{enquiry?.customer_name ?? 'Enquiry'}</CardTitle>
          <CardDescription>
            {enquiry?.customer_phone} · {enquiry?.customer_nric}
            {enquiry?.customer_email ? ` · ${enquiry.customer_email}` : ''}
          </CardDescription>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground space-y-1">
          <div>
            Branch: <span className="text-foreground">{enquiry?.branch?.merchant?.name ?? '—'}</span>
            {enquiry?.branch?.name ? ` — ${enquiry.branch.name}` : ''}
          </div>
          <div>
            Split: pool RM{enquiry?.branch?.merchant?.gift_pool_amount?.toFixed(2) ?? '0.00'} ·{' '}
            {enquiry?.branch?.merchant?.merchant_share_pct ?? 0}% merchant /{' '}
            {100 - (enquiry?.branch?.merchant?.merchant_share_pct ?? 0)}% customer
          </div>
          <div>
            Source: <span className="text-foreground">{enquiry?.agent ? `${enquiry.agent.name} (${enquiry.agent.agent_code})` : 'House (no agent commission)'}</span>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Vehicles</CardTitle>
          <CardDescription>{enquiry?.vehicles?.length ?? 0} cars · act on each line</CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <TableSkeleton rows={3} columns={5} />
          ) : (
            <div className="overflow-auto rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow className="hover:bg-transparent">
                    <TableHead>Plate</TableHead>
                    <TableHead>Product</TableHead>
                    <TableHead>Expiry</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(enquiry?.vehicles ?? []).map((v) => {
                    const badge = vehicleBadge(v.status);
                    const canQuote = v.status === VehicleStatus.SUBMITTED || v.status === VehicleStatus.QUOTED;
                    const canRenew = v.status === VehicleStatus.SUBMITTED || v.status === VehicleStatus.QUOTED;
                    const canLose = v.status === VehicleStatus.SUBMITTED || v.status === VehicleStatus.QUOTED;
                    return (
                      <TableRow key={v.id}>
                        <TableCell className="font-medium">{v.car_plate}</TableCell>
                        <TableCell className="text-muted-foreground">{v.product?.name ?? '—'}</TableCell>
                        <TableCell className="text-muted-foreground">{fmtDate(v.insurance_expiry_date)}</TableCell>
                        <TableCell>
                          <Badge variant={badge.variant}>{badge.label}</Badge>
                          {v.status === VehicleStatus.QUOTED && v.external_quotation_ref && (
                            <div className="text-xs text-muted-foreground mt-1">Ref: {v.external_quotation_ref}</div>
                          )}
                          {v.status === VehicleStatus.LOST && v.lost_reason && (
                            <div className="text-xs text-red-600 mt-1" title={v.lost_reason}>{v.lost_reason}</div>
                          )}
                        </TableCell>
                        <TableCell className="text-right">
                          <div className="flex items-center justify-end gap-1">
                            {canQuote && (
                              <Button
                                variant="ghost"
                                size="sm"
                                disabled={pending}
                                onClick={() => {
                                  setQuoteTarget(v);
                                  setQuoteRef(v.external_quotation_ref ?? '');
                                }}
                              >
                                <FileText className="size-4 mr-1" />
                                {v.status === VehicleStatus.QUOTED ? 'Edit quote' : 'Quote'}
                              </Button>
                            )}
                            {canRenew && (
                              <Button
                                variant="ghost"
                                size="sm"
                                className="text-emerald-700 hover:text-emerald-800 hover:bg-emerald-50"
                                disabled={pending}
                                onClick={() => setRenewTarget(v)}
                              >
                                <CheckCircle2 className="size-4 mr-1" />
                                Renew
                              </Button>
                            )}
                            {canLose && (
                              <Button
                                variant="ghost"
                                size="sm"
                                className="text-red-600 hover:text-red-700 hover:bg-red-50"
                                disabled={pending}
                                onClick={() => {
                                  setLostTarget(v);
                                  setLostReason('');
                                }}
                              >
                                <XCircle className="size-4 mr-1" />
                                Lost
                              </Button>
                            )}
                            {v.status === VehicleStatus.RENEWED && (
                              <span className="text-xs text-muted-foreground">Renewed {fmtDate(v.renewed_at)}</span>
                            )}
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Record-quotation dialog */}
      <Dialog open={!!quoteTarget} onOpenChange={(open) => !open && setQuoteTarget(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Record Quotation</DialogTitle>
            <DialogDescription>
              Mark {quoteTarget?.car_plate} as quoted and store the external quotation reference (optional).
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="quote-ref">External quotation reference</Label>
            <Input
              id="quote-ref"
              value={quoteRef}
              onChange={(e) => setQuoteRef(e.target.value)}
              placeholder="e.g. QTN-2026-00123"
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setQuoteTarget(null)}>Cancel</Button>
            <Button onClick={submitQuote} disabled={recordQuotation.isPending}>
              {recordQuotation.isPending ? 'Saving...' : 'Record Quotation'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Mark-renewed confirm (mints money) */}
      <AlertDialog open={!!renewTarget} onOpenChange={(open) => !open && setRenewTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Confirm Renewal</AlertDialogTitle>
            <AlertDialogDescription>
              Confirming {renewTarget?.car_plate} issues the customer gift voucher, the merchant settlement, and
              (if this enquiry came from an agent) the agent commission. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={submitRenew}
              disabled={confirmRenewal.isPending}
              className="bg-emerald-600 hover:bg-emerald-700"
            >
              {confirmRenewal.isPending ? 'Confirming...' : 'Confirm Renewal'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Mark-lost dialog */}
      <Dialog open={!!lostTarget} onOpenChange={(open) => !open && setLostTarget(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Mark Vehicle Lost</DialogTitle>
            <DialogDescription>
              Record why {lostTarget?.car_plate} did not renew (optional). No payout is created for a lost vehicle.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="lost-reason">Reason</Label>
            <Input
              id="lost-reason"
              value={lostReason}
              onChange={(e) => setLostReason(e.target.value)}
              placeholder="e.g. Renewed elsewhere"
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setLostTarget(null)}>Cancel</Button>
            <Button className="bg-red-600 hover:bg-red-700" onClick={submitLost} disabled={markLost.isPending}>
              {markLost.isPending ? 'Saving...' : 'Mark Lost'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
```

- [ ] **Step 4: Register the routes**

In `apps/admin-portal/src/router.tsx`:
1. Add imports after the `MerchantDetail` import (line ~21):
```tsx
import { EnquiryList } from './pages/enquiries/EnquiryList';
import { EnquiryDetail } from './pages/enquiries/EnquiryDetail';
```
2. Add the route definitions after `merchantDetailRoute` (line ~142):
```tsx
const enquiriesRoute = createRoute({
  getParentRoute: () => protectedLayoutRoute,
  path: '/enquiries',
  component: EnquiryList,
});

const enquiryDetailRoute = createRoute({
  getParentRoute: () => protectedLayoutRoute,
  path: '/enquiries/$enquiryId',
  component: EnquiryDetail,
});
```
3. Add `enquiriesRoute,` and `enquiryDetailRoute,` to the `protectedLayoutRoute.addChildren([...])` array (after `merchantDetailRoute,`).

- [ ] **Step 5: Add the nav entry**

In `apps/admin-portal/src/components/Layout.tsx`:
1. Add `Inbox` to the `lucide-react` import block (alongside `Store`, `Tag`).
2. Add this entry to the `navigation` array immediately after the `Products` entry:
```tsx
  { name: 'Enquiries', href: '/enquiries', icon: Inbox },
```

- [ ] **Step 6: Verify build**

Run: `pnpm --filter admin-portal build`
Expected: build succeeds, no `tsc` errors.

- [ ] **Step 7: Commit**

```bash
git rev-parse --abbrev-ref HEAD   # feat/merchant-partnership
git add apps/admin-portal/src/hooks/useEnquiries.ts apps/admin-portal/src/pages/enquiries/EnquiryList.tsx apps/admin-portal/src/pages/enquiries/EnquiryDetail.tsx apps/admin-portal/src/router.tsx apps/admin-portal/src/components/Layout.tsx
git commit -m "feat(partnership): admin Enquiries inbox + detail with per-vehicle quote/renew/lost actions"
```

---

## Task 3: Admin module — Gifts (voucher) page with mark-redeemed

**Files:**
- Create: `apps/admin-portal/src/hooks/useGifts.ts`
- Create: `apps/admin-portal/src/pages/gifts/GiftList.tsx`
- Modify: `apps/admin-portal/src/router.tsx`
- Modify: `apps/admin-portal/src/components/Layout.tsx`

**Interfaces:**
- Consumes: `GiftStatus`; `supabase`; RPC `mark_gift_redeemed`.
- Produces: hooks `useGifts`, `useMarkGiftRedeemed`; component `GiftList`; route `/gifts`.

- [ ] **Step 1: Create the hook**

Create `apps/admin-portal/src/hooks/useGifts.ts`:

```typescript
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { GiftStatus } from '@agent-system/shared-types';

export interface AdminGiftRow {
  id: string;
  value_amount: number;
  voucher_code: string;
  status: GiftStatus;
  issued_at: string;
  redeemed_at: string | null;
  expires_at: string | null;
  created_at: string;
  merchant: { id: string; name: string } | null;
  vehicle: {
    id: string;
    car_plate: string;
    enquiry: { customer_name: string; customer_phone: string } | null;
  } | null;
}

export function useGifts() {
  return useQuery({
    queryKey: ['gifts'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('gifts')
        .select(`
          id, value_amount, voucher_code, status, issued_at, redeemed_at, expires_at, created_at,
          merchant:merchants(id, name),
          vehicle:enquiry_vehicles(
            id, car_plate,
            enquiry:enquiries(customer_name, customer_phone)
          )
        `)
        .order('created_at', { ascending: false });

      if (error) throw error;
      return (data ?? []) as unknown as AdminGiftRow[];
    },
  });
}

export function useMarkGiftRedeemed() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.rpc('mark_gift_redeemed', { p_gift_id: id });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['gifts'] });
    },
  });
}
```

- [ ] **Step 2: Create the page**

Create `apps/admin-portal/src/pages/gifts/GiftList.tsx`:

```tsx
import { useMemo, useState } from 'react';
import {
  Button,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Badge,
  StatCard,
  StatCardGrid,
  TableSkeleton,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Label,
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  useToast,
} from '@agent-system/shared-ui';
import { Gift, Ticket, CheckCircle2 } from 'lucide-react';
import { GiftStatus } from '@agent-system/shared-types';
import { useGifts, useMarkGiftRedeemed, type AdminGiftRow } from '../../hooks/useGifts';

function fmtDateTime(value: string | null): string {
  if (!value) return '—';
  return new Date(value).toLocaleString('en-SG', { dateStyle: 'medium', timeStyle: 'short' });
}

function giftBadge(status: GiftStatus): { label: string; variant: 'warning' | 'success' | 'error' | 'neutral' } {
  switch (status) {
    case GiftStatus.REDEEMED:
      return { label: 'Redeemed', variant: 'success' };
    case GiftStatus.EXPIRED:
      return { label: 'Expired', variant: 'error' };
    case GiftStatus.VOID:
      return { label: 'Void', variant: 'neutral' };
    default:
      return { label: 'Issued', variant: 'warning' };
  }
}

export function GiftList() {
  const { toast } = useToast();
  const { data: gifts, isLoading } = useGifts();
  const markRedeemed = useMarkGiftRedeemed();

  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [redeemTarget, setRedeemTarget] = useState<AdminGiftRow | null>(null);

  const filtered = useMemo(
    () => (gifts ?? []).filter((g) => statusFilter === 'all' || g.status === statusFilter),
    [gifts, statusFilter]
  );

  const summary = useMemo(() => {
    const all = gifts ?? [];
    const sum = (rows: AdminGiftRow[]) => rows.reduce((s, g) => s + (Number(g.value_amount) || 0), 0);
    const issued = all.filter((g) => g.status === GiftStatus.ISSUED);
    const redeemed = all.filter((g) => g.status === GiftStatus.REDEEMED);
    return {
      totalAmount: sum(all),
      issuedAmount: sum(issued),
      issuedCount: issued.length,
      redeemedCount: redeemed.length,
    };
  }, [gifts]);

  const confirmRedeem = async () => {
    if (!redeemTarget) return;
    try {
      await markRedeemed.mutateAsync(redeemTarget.id);
      toast({ title: 'Voucher marked redeemed' });
    } catch (err: any) {
      toast({ title: 'Failed to redeem voucher', description: err.message, variant: 'error' });
    }
    setRedeemTarget(null);
  };

  return (
    <div className="flex flex-col gap-4 animate-fade-in">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">Gifts</h1>
        <p className="text-sm text-muted-foreground">
          Customer gold-gift vouchers. Each is created automatically when a vehicle renewal is confirmed; mark it
          redeemed once the customer claims it at the branch.
        </p>
      </div>

      <StatCardGrid columns={4}>
        <StatCard
          title="Total Gifts"
          value={`RM${summary.totalAmount.toFixed(2)}`}
          subtitle={`${gifts?.length ?? 0} voucher${(gifts?.length ?? 0) === 1 ? '' : 's'}`}
          icon={Gift}
          iconColor="text-emerald-600"
          iconBgColor="bg-emerald-100"
          loading={isLoading}
        />
        <StatCard
          title="Issued (unredeemed)"
          value={`RM${summary.issuedAmount.toFixed(2)}`}
          subtitle={`${summary.issuedCount} outstanding`}
          icon={Ticket}
          iconColor="text-amber-600"
          iconBgColor="bg-amber-100"
          loading={isLoading}
        />
        <StatCard
          title="Redeemed"
          value={summary.redeemedCount}
          subtitle="Claimed at branch"
          icon={CheckCircle2}
          iconColor="text-sky-600"
          iconBgColor="bg-sky-100"
          loading={isLoading}
        />
        <StatCard
          title="Total Count"
          value={gifts?.length ?? 0}
          subtitle="All vouchers"
          icon={Gift}
          iconColor="text-indigo-600"
          iconBgColor="bg-indigo-100"
          loading={isLoading}
        />
      </StatCardGrid>

      <Card>
        <CardHeader className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div className="space-y-1.5">
            <CardTitle>Vouchers</CardTitle>
            <CardDescription>Look up a voucher code and mark it redeemed.</CardDescription>
          </div>
          <div className="w-full sm:w-40">
            <Label className="text-sm font-medium">Status</Label>
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="mt-1">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Statuses</SelectItem>
                <SelectItem value={GiftStatus.ISSUED}>Issued</SelectItem>
                <SelectItem value={GiftStatus.REDEEMED}>Redeemed</SelectItem>
                <SelectItem value={GiftStatus.EXPIRED}>Expired</SelectItem>
                <SelectItem value={GiftStatus.VOID}>Void</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <TableSkeleton rows={6} columns={6} />
          ) : (
            <div className="overflow-auto rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow className="hover:bg-transparent">
                    <TableHead>Voucher Code</TableHead>
                    <TableHead>Customer</TableHead>
                    <TableHead>Merchant / Car</TableHead>
                    <TableHead className="text-right">Value</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filtered.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={6} className="text-center text-muted-foreground py-6">
                        No vouchers match the current filter.
                      </TableCell>
                    </TableRow>
                  ) : (
                    filtered.map((g) => {
                      const badge = giftBadge(g.status);
                      return (
                        <TableRow key={g.id}>
                          <TableCell className="font-mono font-medium">{g.voucher_code}</TableCell>
                          <TableCell>
                            <div className="text-sm text-foreground">{g.vehicle?.enquiry?.customer_name ?? '—'}</div>
                            <div className="text-xs text-muted-foreground">{g.vehicle?.enquiry?.customer_phone ?? ''}</div>
                          </TableCell>
                          <TableCell className="text-muted-foreground">
                            {g.merchant?.name ?? '—'}
                            <div className="text-xs">{g.vehicle?.car_plate ?? ''}</div>
                          </TableCell>
                          <TableCell className="text-right font-semibold text-emerald-600">
                            RM{Number(g.value_amount).toFixed(2)}
                          </TableCell>
                          <TableCell>
                            <Badge variant={badge.variant}>{badge.label}</Badge>
                            {g.status === GiftStatus.REDEEMED && g.redeemed_at && (
                              <div className="text-xs text-muted-foreground mt-1">{fmtDateTime(g.redeemed_at)}</div>
                            )}
                          </TableCell>
                          <TableCell className="text-right">
                            {g.status === GiftStatus.ISSUED && (
                              <Button
                                variant="ghost"
                                size="sm"
                                className="text-emerald-700 hover:text-emerald-800 hover:bg-emerald-50"
                                disabled={markRedeemed.isPending}
                                onClick={() => setRedeemTarget(g)}
                              >
                                <CheckCircle2 className="size-4 mr-1" />
                                Redeem
                              </Button>
                            )}
                          </TableCell>
                        </TableRow>
                      );
                    })
                  )}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      <AlertDialog open={!!redeemTarget} onOpenChange={(open) => !open && setRedeemTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Mark Voucher Redeemed</AlertDialogTitle>
            <AlertDialogDescription>
              Confirm the customer has claimed voucher <span className="font-mono">{redeemTarget?.voucher_code}</span>{' '}
              (RM{Number(redeemTarget?.value_amount ?? 0).toFixed(2)}). This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={confirmRedeem} className="bg-emerald-600 hover:bg-emerald-700">
              Mark Redeemed
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
```

- [ ] **Step 3: Register the route + nav**

In `apps/admin-portal/src/router.tsx`:
1. Import after the `EnquiryDetail` import:
```tsx
import { GiftList } from './pages/gifts/GiftList';
```
2. Add route after `enquiryDetailRoute`:
```tsx
const giftsRoute = createRoute({
  getParentRoute: () => protectedLayoutRoute,
  path: '/gifts',
  component: GiftList,
});
```
3. Add `giftsRoute,` to `protectedLayoutRoute.addChildren([...])`.

In `apps/admin-portal/src/components/Layout.tsx`:
1. Add `Gift` to the `lucide-react` import.
2. Add to the `navigation` array after the `Enquiries` entry:
```tsx
  { name: 'Gifts', href: '/gifts', icon: Gift },
```

- [ ] **Step 4: Verify build**

Run: `pnpm --filter admin-portal build`
Expected: build succeeds, no `tsc` errors.

- [ ] **Step 5: Commit**

```bash
git rev-parse --abbrev-ref HEAD   # feat/merchant-partnership
git add apps/admin-portal/src/hooks/useGifts.ts apps/admin-portal/src/pages/gifts/GiftList.tsx apps/admin-portal/src/router.tsx apps/admin-portal/src/components/Layout.tsx
git commit -m "feat(partnership): admin Gifts voucher page with mark-redeemed"
```

---

## Task 4: Admin module — Agent Commissions payout page

**Files:**
- Create: `apps/admin-portal/src/hooks/useMerchantCommissions.ts`
- Create: `apps/admin-portal/src/pages/commissions/MerchantCommissionList.tsx`
- Modify: `apps/admin-portal/src/router.tsx`
- Modify: `apps/admin-portal/src/components/Layout.tsx`

**Interfaces:**
- Consumes: `RewardStatus`; `supabase`; RPC `set_merchant_commission_status`.
- Produces: hooks `useMerchantCommissions`, `useSetMerchantCommissionStatus`; component `MerchantCommissionList`; route `/commissions`. Mirrors the existing `useRewards.ts` / `Rewards.tsx` payout-status pattern (Pay/Fail/Reset actions, fail-reason dialog, StatCards).

- [ ] **Step 1: Create the hook**

Create `apps/admin-portal/src/hooks/useMerchantCommissions.ts`:

```typescript
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { RewardStatus } from '@agent-system/shared-types';

export interface AdminCommissionRow {
  id: string;
  amount: number;
  status: RewardStatus;
  paid_at: string | null;
  failure_reason: string | null;
  created_at: string;
  agent: { id: string; name: string; agent_code: string; unit_name: string } | null;
  vehicle: {
    id: string;
    car_plate: string;
    enquiry: { customer_name: string; customer_phone: string } | null;
  } | null;
}

export function useMerchantCommissions() {
  return useQuery({
    queryKey: ['merchant-commissions'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('merchant_commissions')
        .select(`
          id, amount, status, paid_at, failure_reason, created_at,
          agent:agents(id, name, agent_code, unit_name),
          vehicle:enquiry_vehicles(
            id, car_plate,
            enquiry:enquiries(customer_name, customer_phone)
          )
        `)
        .order('created_at', { ascending: false });

      if (error) throw error;
      return (data ?? []) as unknown as AdminCommissionRow[];
    },
  });
}

export function useSetMerchantCommissionStatus() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      id,
      status,
      reason,
    }: {
      id: string;
      status: RewardStatus;
      reason?: string;
    }) => {
      const { error } = await supabase.rpc('set_merchant_commission_status', {
        p_id: id,
        p_status: status,
        p_failure_reason: reason ?? null,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['merchant-commissions'] });
    },
  });
}
```

- [ ] **Step 2: Create the page**

Create `apps/admin-portal/src/pages/commissions/MerchantCommissionList.tsx`:

```tsx
import { useMemo, useState } from 'react';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  Badge,
  Button,
  StatCard,
  StatCardGrid,
  TableSkeleton,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Label,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  useToast,
} from '@agent-system/shared-ui';
import { Banknote, Clock, CheckCircle2, XCircle, RotateCcw } from 'lucide-react';
import { RewardStatus } from '@agent-system/shared-types';
import {
  useMerchantCommissions,
  useSetMerchantCommissionStatus,
  type AdminCommissionRow,
} from '../../hooks/useMerchantCommissions';

function fmtDateTime(value: string | null): string {
  if (!value) return '—';
  return new Date(value).toLocaleString('en-SG', { dateStyle: 'medium', timeStyle: 'short' });
}

/** 'paid' === Issued/Sent. */
function statusDisplay(status: RewardStatus): { label: string; variant: 'pending' | 'paid' | 'error' } {
  switch (status) {
    case RewardStatus.PAID:
      return { label: 'Paid', variant: 'paid' };
    case RewardStatus.FAILED:
      return { label: 'Failed', variant: 'error' };
    default:
      return { label: 'Pending', variant: 'pending' };
  }
}

export function MerchantCommissionList() {
  const { toast } = useToast();
  const { data: rows, isLoading } = useMerchantCommissions();
  const setStatus = useSetMerchantCommissionStatus();

  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [failTarget, setFailTarget] = useState<AdminCommissionRow | null>(null);
  const [failReason, setFailReason] = useState('');

  const filtered = useMemo(
    () => (rows ?? []).filter((r) => statusFilter === 'all' || r.status === statusFilter),
    [rows, statusFilter]
  );

  const summary = useMemo(() => {
    const all = rows ?? [];
    const sum = (xs: AdminCommissionRow[]) => xs.reduce((s, r) => s + (Number(r.amount) || 0), 0);
    const pending = all.filter((r) => r.status !== RewardStatus.PAID && r.status !== RewardStatus.FAILED);
    const paid = all.filter((r) => r.status === RewardStatus.PAID);
    const failed = all.filter((r) => r.status === RewardStatus.FAILED);
    return {
      totalAmount: sum(all),
      pendingAmount: sum(pending),
      pendingCount: pending.length,
      paidAmount: sum(paid),
      paidCount: paid.length,
      failedCount: failed.length,
    };
  }, [rows]);

  const runUpdate = async (id: string, status: RewardStatus, reason?: string) => {
    try {
      await setStatus.mutateAsync({ id, status, reason });
      const verb =
        status === RewardStatus.PAID ? 'marked as paid' : status === RewardStatus.FAILED ? 'marked as failed' : 'reset to pending';
      toast({ title: `Commission ${verb}` });
    } catch (err: any) {
      toast({ title: 'Failed to update commission', description: err.message, variant: 'error' });
    }
  };

  const confirmFail = async () => {
    if (!failTarget) return;
    await runUpdate(failTarget.id, RewardStatus.FAILED, failReason.trim() || undefined);
    setFailTarget(null);
    setFailReason('');
  };

  return (
    <div className="flex flex-col gap-4 animate-fade-in">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">Agent Commissions</h1>
        <p className="text-sm text-muted-foreground">
          Partnership commissions owed to agents. Each is created automatically when an agent-sourced vehicle renewal
          is confirmed.
        </p>
      </div>

      <StatCardGrid columns={4}>
        <StatCard
          title="Total"
          value={`RM${summary.totalAmount.toFixed(2)}`}
          subtitle={`${rows?.length ?? 0} commission${(rows?.length ?? 0) === 1 ? '' : 's'}`}
          icon={Banknote}
          iconColor="text-emerald-600"
          iconBgColor="bg-emerald-100"
          loading={isLoading}
        />
        <StatCard
          title="Pending"
          value={`RM${summary.pendingAmount.toFixed(2)}`}
          subtitle={`${summary.pendingCount} awaiting payout`}
          icon={Clock}
          iconColor="text-amber-600"
          iconBgColor="bg-amber-100"
          loading={isLoading}
        />
        <StatCard
          title="Paid"
          value={`RM${summary.paidAmount.toFixed(2)}`}
          subtitle={`${summary.paidCount} settled`}
          icon={CheckCircle2}
          iconColor="text-sky-600"
          iconBgColor="bg-sky-100"
          loading={isLoading}
        />
        <StatCard
          title="Failed"
          value={summary.failedCount}
          subtitle="Need attention"
          icon={XCircle}
          iconColor="text-red-600"
          iconBgColor="bg-red-100"
          loading={isLoading}
        />
      </StatCardGrid>

      <Card>
        <CardHeader className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div className="space-y-1.5">
            <CardTitle>Commission Payouts</CardTitle>
            <CardDescription>Mark commissions paid or failed and track when each was settled.</CardDescription>
          </div>
          <div className="w-full sm:w-40">
            <Label className="text-sm font-medium">Status</Label>
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="mt-1">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Statuses</SelectItem>
                <SelectItem value={RewardStatus.PENDING}>Pending</SelectItem>
                <SelectItem value={RewardStatus.PAID}>Paid</SelectItem>
                <SelectItem value={RewardStatus.FAILED}>Failed</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <TableSkeleton rows={6} columns={5} />
          ) : (
            <div className="overflow-auto rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow className="hover:bg-transparent">
                    <TableHead>Unit / Agent</TableHead>
                    <TableHead>Customer / Car</TableHead>
                    <TableHead className="text-right">Amount</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filtered.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={5} className="text-center text-muted-foreground py-6">
                        No commissions match the current filter.
                      </TableCell>
                    </TableRow>
                  ) : (
                    filtered.map((r) => {
                      const display = statusDisplay(r.status);
                      const isPaid = r.status === RewardStatus.PAID;
                      const isFailed = r.status === RewardStatus.FAILED;
                      return (
                        <TableRow key={r.id}>
                          <TableCell>
                            <div className="text-sm font-medium text-foreground">{r.agent?.unit_name ?? '—'}</div>
                            <div className="text-xs text-muted-foreground">{r.agent?.name ?? ''}</div>
                          </TableCell>
                          <TableCell>
                            <div className="text-sm text-foreground">{r.vehicle?.enquiry?.customer_name ?? '—'}</div>
                            <div className="text-xs text-muted-foreground">{r.vehicle?.car_plate ?? ''}</div>
                          </TableCell>
                          <TableCell className="text-right font-semibold text-emerald-600">
                            RM{Number(r.amount).toFixed(2)}
                          </TableCell>
                          <TableCell>
                            <Badge variant={display.variant}>{display.label}</Badge>
                            {isPaid && r.paid_at && (
                              <div className="text-xs text-muted-foreground mt-1">{fmtDateTime(r.paid_at)}</div>
                            )}
                            {isFailed && r.failure_reason && (
                              <div className="text-xs text-red-600 mt-1" title={r.failure_reason}>{r.failure_reason}</div>
                            )}
                          </TableCell>
                          <TableCell className="text-right">
                            <div className="flex items-center justify-end gap-1">
                              {!isPaid && (
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  className="text-emerald-700 hover:text-emerald-800 hover:bg-emerald-50"
                                  disabled={setStatus.isPending}
                                  onClick={() => runUpdate(r.id, RewardStatus.PAID)}
                                >
                                  <CheckCircle2 className="size-4 mr-1" />
                                  Pay
                                </Button>
                              )}
                              {!isFailed && (
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  className="text-red-600 hover:text-red-700 hover:bg-red-50"
                                  disabled={setStatus.isPending}
                                  onClick={() => {
                                    setFailTarget(r);
                                    setFailReason('');
                                  }}
                                >
                                  <XCircle className="size-4 mr-1" />
                                  Fail
                                </Button>
                              )}
                              {(isPaid || isFailed) && (
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  className="text-muted-foreground hover:text-foreground"
                                  disabled={setStatus.isPending}
                                  onClick={() => runUpdate(r.id, RewardStatus.PENDING)}
                                >
                                  <RotateCcw className="size-4 mr-1" />
                                  Reset
                                </Button>
                              )}
                            </div>
                          </TableCell>
                        </TableRow>
                      );
                    })
                  )}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={!!failTarget} onOpenChange={(open) => !open && setFailTarget(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Mark Commission as Failed</DialogTitle>
            <DialogDescription>
              Record why this commission payout failed (e.g. invalid payout details). Shown to admins on the row.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="fail-reason">Reason (optional)</Label>
            <Input
              id="fail-reason"
              value={failReason}
              onChange={(e) => setFailReason(e.target.value)}
              placeholder="e.g. Bank account rejected"
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setFailTarget(null)}>Cancel</Button>
            <Button className="bg-red-600 hover:bg-red-700" onClick={confirmFail} disabled={setStatus.isPending}>
              {setStatus.isPending ? 'Saving...' : 'Mark Failed'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
```

- [ ] **Step 3: Register the route + nav**

In `apps/admin-portal/src/router.tsx`:
1. Import after the `GiftList` import:
```tsx
import { MerchantCommissionList } from './pages/commissions/MerchantCommissionList';
```
2. Add route after `giftsRoute`:
```tsx
const commissionsRoute = createRoute({
  getParentRoute: () => protectedLayoutRoute,
  path: '/commissions',
  component: MerchantCommissionList,
});
```
3. Add `commissionsRoute,` to `protectedLayoutRoute.addChildren([...])`.

In `apps/admin-portal/src/components/Layout.tsx`:
1. Add `Coins` to the `lucide-react` import.
2. Add to the `navigation` array after the `Gifts` entry:
```tsx
  { name: 'Commissions', href: '/commissions', icon: Coins },
```

- [ ] **Step 4: Verify build**

Run: `pnpm --filter admin-portal build`
Expected: build succeeds, no `tsc` errors.

- [ ] **Step 5: Commit**

```bash
git rev-parse --abbrev-ref HEAD   # feat/merchant-partnership
git add apps/admin-portal/src/hooks/useMerchantCommissions.ts apps/admin-portal/src/pages/commissions/MerchantCommissionList.tsx apps/admin-portal/src/router.tsx apps/admin-portal/src/components/Layout.tsx
git commit -m "feat(partnership): admin Agent Commissions payout page (pay/fail/reset)"
```

---

## Task 5: Admin module — Merchant Settlements payout page

**Files:**
- Create: `apps/admin-portal/src/hooks/useMerchantSettlements.ts`
- Create: `apps/admin-portal/src/pages/settlements/MerchantSettlementList.tsx`
- Modify: `apps/admin-portal/src/router.tsx`
- Modify: `apps/admin-portal/src/components/Layout.tsx`

**Interfaces:**
- Consumes: `RewardStatus`; `supabase`; RPC `set_merchant_settlement_status`.
- Produces: hooks `useMerchantSettlements`, `useSetMerchantSettlementStatus`; component `MerchantSettlementList`; route `/settlements`. This is the same payout-status UX as Task 4 with the **merchant** payable instead of the **agent** commission.

- [ ] **Step 1: Create the hook**

Create `apps/admin-portal/src/hooks/useMerchantSettlements.ts`:

```typescript
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { RewardStatus } from '@agent-system/shared-types';

export interface AdminSettlementRow {
  id: string;
  amount: number;
  status: RewardStatus;
  paid_at: string | null;
  failure_reason: string | null;
  created_at: string;
  merchant: { id: string; name: string } | null;
  vehicle: {
    id: string;
    car_plate: string;
    enquiry: { customer_name: string; customer_phone: string } | null;
  } | null;
}

export function useMerchantSettlements() {
  return useQuery({
    queryKey: ['merchant-settlements'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('merchant_settlements')
        .select(`
          id, amount, status, paid_at, failure_reason, created_at,
          merchant:merchants(id, name),
          vehicle:enquiry_vehicles(
            id, car_plate,
            enquiry:enquiries(customer_name, customer_phone)
          )
        `)
        .order('created_at', { ascending: false });

      if (error) throw error;
      return (data ?? []) as unknown as AdminSettlementRow[];
    },
  });
}

export function useSetMerchantSettlementStatus() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      id,
      status,
      reason,
    }: {
      id: string;
      status: RewardStatus;
      reason?: string;
    }) => {
      const { error } = await supabase.rpc('set_merchant_settlement_status', {
        p_id: id,
        p_status: status,
        p_failure_reason: reason ?? null,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['merchant-settlements'] });
    },
  });
}
```

- [ ] **Step 2: Create the page**

Create `apps/admin-portal/src/pages/settlements/MerchantSettlementList.tsx` as an exact copy of `MerchantCommissionList.tsx` (Task 4 Step 2) with these precise substitutions:
- Imports: `useMerchantSettlements`, `useSetMerchantSettlementStatus`, `type AdminSettlementRow` from `'../../hooks/useMerchantSettlements'`; swap the `Banknote` icon import for `Landmark` (keep `Clock`, `CheckCircle2`, `XCircle`, `RotateCcw`) and use `Landmark` in the "Total" `StatCard`.
- Component name: `MerchantSettlementList`; row type `AdminSettlementRow`; query hook `useMerchantSettlements()`; mutation hook `useSetMerchantSettlementStatus()`.
- Page title: `Merchant Settlements`; subtitle: `Payables RACC owes partner merchants. Each is created automatically when a vehicle renewal is confirmed.`
- Card title: `Settlement Payouts`; card description: `Mark settlements paid or failed and track when each was settled.`
- The first table column header `Unit / Agent` becomes `Merchant`; its cell renders `r.merchant?.name ?? '—'` (single line, no sub-line). Keep the `Customer / Car`, `Amount`, `Status`, `Actions` columns and all Pay/Fail/Reset logic identical (still using `RewardStatus` and `set_merchant_settlement_status` via the hook).
- Toast/dialog copy: replace the word "commission" with "settlement" (`Settlement ${verb}`, `Failed to update settlement`, `Mark Settlement as Failed`, `Record why this settlement payout failed...`).
- StatCard labels stay Total / Pending / Paid / Failed; `colSpan` stays `5`.

- [ ] **Step 3: Register the route + nav**

In `apps/admin-portal/src/router.tsx`:
1. Import after the `MerchantCommissionList` import:
```tsx
import { MerchantSettlementList } from './pages/settlements/MerchantSettlementList';
```
2. Add route after `commissionsRoute`:
```tsx
const settlementsRoute = createRoute({
  getParentRoute: () => protectedLayoutRoute,
  path: '/settlements',
  component: MerchantSettlementList,
});
```
3. Add `settlementsRoute,` to `protectedLayoutRoute.addChildren([...])`.

In `apps/admin-portal/src/components/Layout.tsx`:
1. Add `Landmark` to the `lucide-react` import.
2. Add to the `navigation` array after the `Commissions` entry:
```tsx
  { name: 'Settlements', href: '/settlements', icon: Landmark },
```

- [ ] **Step 4: Verify build**

Run: `pnpm --filter admin-portal build`
Expected: build succeeds, no `tsc` errors.

- [ ] **Step 5: Manual UI check (user runs the dev server)**

Run `pnpm dev:admin`, log in as `admin@test.com`. With at least one enquiry present (from Phase 2): open it under **Enquiries**, **Quote** a car, then **Renew** it. Confirm a voucher appears under **Gifts**, a row under **Settlements**, and (if the enquiry was agent-sourced) a row under **Commissions**. Mark the voucher redeemed; mark the settlement and commission paid, then failed (with a reason), then reset. Expected: every list refreshes and the enquiry flips to **Closed** once all its cars are renewed/lost.

- [ ] **Step 6: Commit**

```bash
git rev-parse --abbrev-ref HEAD   # feat/merchant-partnership
git add apps/admin-portal/src/hooks/useMerchantSettlements.ts apps/admin-portal/src/pages/settlements/MerchantSettlementList.tsx apps/admin-portal/src/router.tsx apps/admin-portal/src/components/Layout.tsx
git commit -m "feat(partnership): admin Merchant Settlements payout page (pay/fail/reset)"
```

---

## Phase 3 done — verification summary

- `npx supabase migration up` applies `20260628000010_merchant_pipeline_rpcs.sql`; `pg_proc` shows all 6 RPCs; the rolled-back functional test returns `renewed|600.00|10|1|400.00|77.00|closed` (split math, three ledgers, 10-char voucher, idempotency, enquiry roll-up); the non-admin call raises `42501`.
- `pnpm --filter admin-portal build` passes after each UI task.
- Admin can: browse the **Enquiries** inbox and open a detail; per vehicle **Record quotation** (`submitted→quoted`), **Mark renewed** (`confirm_vehicle_renewal` mints gift + settlement + agent commission when tied), **Mark lost**; the enquiry auto-closes when all cars are terminal; **Gifts** lists vouchers and marks them redeemed; **Commissions** and **Settlements** list payouts and set paid/failed/reset.

## Next phases (separate plans)

4. Reminders — `pg_cron` + `pg_net`, `enqueue_expiry_reminders`, `send-expiry-reminders` edge function (migration block `20260628000020..`).
5. Agent portal — propose merchant/branch, generate branch links, my enquiries & commissions (no migration).
</content>
</invoke>
