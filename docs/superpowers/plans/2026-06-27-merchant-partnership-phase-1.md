# Merchant Partnership — Phase 1: Schema & Admin Foundations — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Lay the complete database schema (enums, 9 tables, RLS, approve RPCs) for the merchant-partnership subsystem, and ship the admin CRUD for Merchants, Branches, and Insurance Products (incl. approving agent-proposed records).

**Architecture:** Three additive SQL migrations create all tables with `partners.sql`-style RLS (admin full access via `is_admin()`, agent scoping via `get_agent_id()`, anon kept out of enquiries). Shared types are added in a new `merchant.ts`. Admin UI copies the existing `useTiers.ts` / `TierList.tsx` hook+list+dialog pattern; routes are registered in `router.tsx` and nav in `Layout.tsx`.

**Tech Stack:** Supabase (Postgres 15 + RLS), React 18 + Vite + TypeScript, TanStack Router, TanStack Query, shadcn/ui (`@agent-system/shared-ui`), pnpm workspaces.

## Global Constraints

- **No test framework** in this repo. Verify frontend with `pnpm --filter admin-portal build` (runs `tsc && vite build`). Verify DB with `npx supabase db reset` + `psql` assertions. **Never add vitest/jest/any test runner.**
- **Local DB connection string:** `postgresql://postgres:postgres@127.0.0.1:54322/postgres` (requires `npx supabase start` first).
- **Migration filenames:** `supabase/migrations/YYYYMMDDNNNNNN_name.sql`, strictly increasing; the last existing is `20260625000001`. Use the three names in this plan as-is. Apply locally via `npx supabase db reset` (NOT `db push`); production is applied later via MCP `apply_migration`.
- **Reuse existing DB helpers — do NOT redefine:** trigger function `update_updated_at()`, and RLS helpers `is_admin()` (reads `app_metadata.role`) and `get_agent_id()`.
- **Naming:** database objects use `merchant*` / domain nouns; the word "partner" is reserved for the existing recruiter concept. UI labels this area **"Partnerships."**
- **Money:** all amounts `NUMERIC(10,2)`; `merchant_share_pct` is `NUMERIC(5,2)` constrained `0..100`; the customer-gift share is always derived as `100 - merchant_share_pct` (never stored).
- **Supabase client:** in `admin-portal`, import `supabase` from `../lib/supabase` (which re-exports the single shared-ui client). Never call `createClient`.
- **PDPA:** anon role gets **no SELECT** on `enquiries` / `enquiry_vehicles` (public writes come via a SECURITY DEFINER RPC in Phase 2).
- **Git:** work on branch `feat/merchant-partnership`; one commit per task; never commit to `main`.

---

## File Structure

**Created:**
- `supabase/migrations/20260627000001_merchant_core.sql` — enums + `merchants`, `merchant_branches`, `insurance_products`, `branch_links` + RLS + approve RPCs + seed products
- `supabase/migrations/20260627000002_merchant_enquiries.sql` — `enquiries`, `enquiry_vehicles` + dedup index + RLS
- `supabase/migrations/20260627000003_merchant_ledgers.sql` — `gifts`, `merchant_commissions`, `merchant_settlements` + RLS
- `packages/shared-types/src/merchant.ts` — all merchant-domain interfaces
- `apps/admin-portal/src/hooks/useInsuranceProducts.ts`
- `apps/admin-portal/src/hooks/useMerchants.ts`
- `apps/admin-portal/src/hooks/useMerchantBranches.ts`
- `apps/admin-portal/src/pages/insurance-products/InsuranceProductList.tsx`
- `apps/admin-portal/src/pages/merchants/MerchantList.tsx`
- `apps/admin-portal/src/pages/merchants/MerchantDetail.tsx`

**Modified:**
- `packages/shared-types/src/enums.ts` — add `MerchantStatus`, `EnquiryStatus`, `VehicleStatus`, `GiftStatus`
- `packages/shared-types/src/index.ts` — re-export `./merchant`
- `apps/admin-portal/src/router.tsx` — add 3 routes
- `apps/admin-portal/src/components/Layout.tsx` — add 2 nav entries

---

## Task 1: Migration — core merchant tables, RLS, approve RPCs

**Files:**
- Create: `supabase/migrations/20260627000001_merchant_core.sql`

**Interfaces:**
- Consumes: existing `agents(id)`, `tiers(id)`, `update_updated_at()`, `is_admin()`, `get_agent_id()`.
- Produces: tables `merchants`, `merchant_branches`, `insurance_products`, `branch_links`; enums `merchant_status`, `enquiry_status`, `vehicle_status`, `gift_status`; RPCs `approve_merchant(uuid)`, `approve_merchant_branch(uuid)`.

- [ ] **Step 1: Write the migration file**

Create `supabase/migrations/20260627000001_merchant_core.sql`:

```sql
-- ============================================================
-- Merchant Partnership — core tables, enums, RLS, approve RPCs
-- ============================================================

-- Enums (all four created here; used across phases)
CREATE TYPE merchant_status AS ENUM ('pending', 'active', 'inactive');
CREATE TYPE enquiry_status  AS ENUM ('open', 'closed');
CREATE TYPE vehicle_status  AS ENUM ('submitted', 'quoted', 'renewed', 'lost');
CREATE TYPE gift_status     AS ENUM ('issued', 'redeemed', 'expired', 'void');

-- merchants -------------------------------------------------
CREATE TABLE merchants (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name                TEXT NOT NULL,
  logo_url            TEXT,
  gift_pool_amount    NUMERIC(10,2) NOT NULL DEFAULT 0,
  merchant_share_pct  NUMERIC(5,2)  NOT NULL DEFAULT 0
                        CHECK (merchant_share_pct >= 0 AND merchant_share_pct <= 100),
  status              merchant_status NOT NULL DEFAULT 'pending',
  created_by_agent_id UUID REFERENCES agents(id) ON DELETE SET NULL,
  approved_by         UUID,
  approved_at         TIMESTAMPTZ,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_merchants_status ON merchants(status);
CREATE INDEX idx_merchants_created_by_agent ON merchants(created_by_agent_id);
CREATE TRIGGER merchants_updated_at
  BEFORE UPDATE ON merchants FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- merchant_branches ----------------------------------------
CREATE TABLE merchant_branches (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  merchant_id         UUID NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
  name                TEXT NOT NULL,
  address             TEXT,
  phone               TEXT,
  status              merchant_status NOT NULL DEFAULT 'pending',
  created_by_agent_id UUID REFERENCES agents(id) ON DELETE SET NULL,
  approved_by         UUID,
  approved_at         TIMESTAMPTZ,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_merchant_branches_merchant ON merchant_branches(merchant_id);
CREATE INDEX idx_merchant_branches_status ON merchant_branches(status);
CREATE TRIGGER merchant_branches_updated_at
  BEFORE UPDATE ON merchant_branches FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- insurance_products ---------------------------------------
CREATE TABLE insurance_products (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name        TEXT NOT NULL,
  is_active   BOOLEAN NOT NULL DEFAULT TRUE,
  sort_order  INTEGER NOT NULL DEFAULT 0,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TRIGGER insurance_products_updated_at
  BEFORE UPDATE ON insurance_products FOR EACH ROW EXECUTE FUNCTION update_updated_at();

INSERT INTO insurance_products (name, sort_order) VALUES
  ('Comprehensive', 1),
  ('Third Party, Fire & Theft', 2),
  ('Third Party', 3);

-- branch_links (per-agent shareable QR; agent_id NULL = house) 
CREATE TABLE branch_links (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  merchant_branch_id UUID NOT NULL REFERENCES merchant_branches(id) ON DELETE CASCADE,
  agent_id           UUID REFERENCES agents(id) ON DELETE SET NULL,
  link_code          TEXT NOT NULL UNIQUE,
  is_active          BOOLEAN NOT NULL DEFAULT TRUE,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_branch_links_branch ON branch_links(merchant_branch_id);
CREATE INDEX idx_branch_links_agent ON branch_links(agent_id);

-- approve RPCs ---------------------------------------------
CREATE OR REPLACE FUNCTION approve_merchant(merchant_uuid UUID)
RETURNS VOID AS $$
BEGIN
  IF NOT is_admin() THEN RAISE EXCEPTION 'Only admins can approve merchants'; END IF;
  UPDATE merchants
     SET status = 'active', approved_by = auth.uid(), approved_at = NOW()
   WHERE id = merchant_uuid;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION approve_merchant_branch(branch_uuid UUID)
RETURNS VOID AS $$
BEGIN
  IF NOT is_admin() THEN RAISE EXCEPTION 'Only admins can approve branches'; END IF;
  UPDATE merchant_branches
     SET status = 'active', approved_by = auth.uid(), approved_at = NOW()
   WHERE id = branch_uuid;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- RLS ------------------------------------------------------
ALTER TABLE merchants          ENABLE ROW LEVEL SECURITY;
ALTER TABLE merchant_branches  ENABLE ROW LEVEL SECURITY;
ALTER TABLE insurance_products ENABLE ROW LEVEL SECURITY;
ALTER TABLE branch_links       ENABLE ROW LEVEL SECURITY;

-- merchants policies
CREATE POLICY "Admin full access to merchants"
  ON merchants FOR ALL TO authenticated USING (is_admin());
CREATE POLICY "Agents read active or own merchants"
  ON merchants FOR SELECT TO authenticated
  USING (status = 'active' OR created_by_agent_id = get_agent_id());
CREATE POLICY "Agents propose merchants"
  ON merchants FOR INSERT TO authenticated
  WITH CHECK (created_by_agent_id = get_agent_id() AND status = 'pending');

-- merchant_branches policies
CREATE POLICY "Admin full access to merchant_branches"
  ON merchant_branches FOR ALL TO authenticated USING (is_admin());
CREATE POLICY "Agents read active or own branches"
  ON merchant_branches FOR SELECT TO authenticated
  USING (status = 'active' OR created_by_agent_id = get_agent_id());
CREATE POLICY "Agents propose branches"
  ON merchant_branches FOR INSERT TO authenticated
  WITH CHECK (created_by_agent_id = get_agent_id() AND status = 'pending');

-- insurance_products policies (anon read of active needed by the Phase 2 form)
CREATE POLICY "Admin full access to insurance_products"
  ON insurance_products FOR ALL TO authenticated USING (is_admin());
CREATE POLICY "Authenticated read active products"
  ON insurance_products FOR SELECT TO authenticated USING (is_active);
CREATE POLICY "Anon read active products"
  ON insurance_products FOR SELECT TO anon USING (is_active);

-- branch_links policies
CREATE POLICY "Admin full access to branch_links"
  ON branch_links FOR ALL TO authenticated USING (is_admin());
CREATE POLICY "Agents manage own branch_links"
  ON branch_links FOR ALL TO authenticated
  USING (agent_id = get_agent_id()) WITH CHECK (agent_id = get_agent_id());
```

- [ ] **Step 2: Apply migrations to a fresh local DB**

Run: `npx supabase db reset`
Expected: completes without error; output lists `20260627000001_merchant_core.sql` among applied migrations.

- [ ] **Step 3: Assert the schema exists**

Run:
```bash
psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" -c \
"SELECT to_regclass('public.merchants'), to_regclass('public.merchant_branches'), to_regclass('public.insurance_products'), to_regclass('public.branch_links');"
psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" -c \
"SELECT count(*) AS product_count FROM insurance_products;"
psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" -c \
"SELECT proname FROM pg_proc WHERE proname IN ('approve_merchant','approve_merchant_branch');"
```
Expected: all four `to_regclass` values non-NULL; `product_count = 3`; both RPC names listed.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260627000001_merchant_core.sql
git commit -m "feat(partnership): add merchant core tables, enums, RLS, approve RPCs"
```

---

## Task 2: Migration — enquiry tables + dedup index + RLS

**Files:**
- Create: `supabase/migrations/20260627000002_merchant_enquiries.sql`

**Interfaces:**
- Consumes: `branch_links(id)`, `merchant_branches(id)`, `insurance_products(id)`, `agents(id)`, `enquiry_status`, `vehicle_status`, `update_updated_at()`, `is_admin()`, `get_agent_id()`.
- Produces: tables `enquiries`, `enquiry_vehicles`; unique index `uq_enquiry_vehicle_dedup`.

- [ ] **Step 1: Write the migration file**

Create `supabase/migrations/20260627000002_merchant_enquiries.sql`:

```sql
-- ============================================================
-- Merchant Partnership — customer enquiries (header + vehicles)
-- ============================================================

CREATE TABLE enquiries (
  id                        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  branch_link_id            UUID NOT NULL REFERENCES branch_links(id),
  merchant_branch_id        UUID NOT NULL REFERENCES merchant_branches(id),
  agent_id                  UUID REFERENCES agents(id) ON DELETE SET NULL,
  customer_name             TEXT NOT NULL,
  customer_nric             TEXT NOT NULL,
  customer_nric_normalized  TEXT NOT NULL,
  customer_phone            TEXT NOT NULL,
  customer_phone_normalized TEXT NOT NULL,
  customer_email            TEXT,
  status                    enquiry_status NOT NULL DEFAULT 'open',
  created_at                TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at                TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_enquiries_branch ON enquiries(merchant_branch_id);
CREATE INDEX idx_enquiries_agent ON enquiries(agent_id);
CREATE INDEX idx_enquiries_status ON enquiries(status);
CREATE TRIGGER enquiries_updated_at
  BEFORE UPDATE ON enquiries FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TABLE enquiry_vehicles (
  id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  enquiry_id             UUID NOT NULL REFERENCES enquiries(id) ON DELETE CASCADE,
  merchant_branch_id     UUID NOT NULL REFERENCES merchant_branches(id),
  car_plate              TEXT NOT NULL,
  car_plate_normalized   TEXT NOT NULL,
  insurance_expiry_date  DATE NOT NULL,
  insurance_product_id   UUID NOT NULL REFERENCES insurance_products(id),
  status                 vehicle_status NOT NULL DEFAULT 'submitted',
  external_quotation_ref TEXT,
  quoted_at              TIMESTAMPTZ,
  quoted_by              UUID,
  renewed_at             TIMESTAMPTZ,
  renewed_by             UUID,
  lost_at                TIMESTAMPTZ,
  lost_reason            TEXT,
  reminder_sent_at       TIMESTAMPTZ,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_enquiry_vehicles_enquiry ON enquiry_vehicles(enquiry_id);
CREATE INDEX idx_enquiry_vehicles_status ON enquiry_vehicles(status);
CREATE INDEX idx_enquiry_vehicles_expiry ON enquiry_vehicles(insurance_expiry_date);
-- Block the exact same car (per branch) being submitted twice
CREATE UNIQUE INDEX uq_enquiry_vehicle_dedup
  ON enquiry_vehicles(merchant_branch_id, car_plate_normalized, insurance_expiry_date);
CREATE TRIGGER enquiry_vehicles_updated_at
  BEFORE UPDATE ON enquiry_vehicles FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- RLS (NO anon policies — Phase 2 public writes go through a SECURITY DEFINER RPC)
ALTER TABLE enquiries        ENABLE ROW LEVEL SECURITY;
ALTER TABLE enquiry_vehicles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admin full access to enquiries"
  ON enquiries FOR ALL TO authenticated USING (is_admin());
CREATE POLICY "Agents read own enquiries"
  ON enquiries FOR SELECT TO authenticated USING (agent_id = get_agent_id());

CREATE POLICY "Admin full access to enquiry_vehicles"
  ON enquiry_vehicles FOR ALL TO authenticated USING (is_admin());
CREATE POLICY "Agents read own enquiry_vehicles"
  ON enquiry_vehicles FOR SELECT TO authenticated
  USING (enquiry_id IN (SELECT id FROM enquiries WHERE agent_id = get_agent_id()));
```

- [ ] **Step 2: Apply and assert**

Run:
```bash
npx supabase db reset
psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" -c \
"SELECT to_regclass('public.enquiries'), to_regclass('public.enquiry_vehicles');"
psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" -c \
"SELECT indexname FROM pg_indexes WHERE indexname = 'uq_enquiry_vehicle_dedup';"
```
Expected: both tables non-NULL; the unique index `uq_enquiry_vehicle_dedup` listed.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260627000002_merchant_enquiries.sql
git commit -m "feat(partnership): add enquiry + enquiry_vehicle tables with dedup and RLS"
```

---

## Task 3: Migration — gift / commission / settlement ledgers + RLS

**Files:**
- Create: `supabase/migrations/20260627000003_merchant_ledgers.sql`

**Interfaces:**
- Consumes: `enquiry_vehicles(id)`, `merchants(id)`, `merchant_branches(id)`, `agents(id)`, `tiers(id)`, existing enum `reward_status`, `gift_status`, `update_updated_at()`, `is_admin()`, `get_agent_id()`.
- Produces: tables `gifts`, `merchant_commissions`, `merchant_settlements` (each `UNIQUE(enquiry_vehicle_id)`).

- [ ] **Step 1: Write the migration file**

Create `supabase/migrations/20260627000003_merchant_ledgers.sql`:

```sql
-- ============================================================
-- Merchant Partnership — payout ledgers (created on renewal)
-- ============================================================

-- gifts (customer gold voucher) ----------------------------
CREATE TABLE gifts (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  enquiry_vehicle_id UUID NOT NULL UNIQUE REFERENCES enquiry_vehicles(id) ON DELETE CASCADE,
  merchant_id        UUID NOT NULL REFERENCES merchants(id),
  merchant_branch_id UUID NOT NULL REFERENCES merchant_branches(id),
  value_amount       NUMERIC(10,2) NOT NULL,
  voucher_code       TEXT NOT NULL UNIQUE,
  status             gift_status NOT NULL DEFAULT 'issued',
  issued_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  redeemed_at        TIMESTAMPTZ,
  redeemed_by        UUID,
  expires_at         TIMESTAMPTZ,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_gifts_status ON gifts(status);
CREATE INDEX idx_gifts_merchant ON gifts(merchant_id);
CREATE TRIGGER gifts_updated_at
  BEFORE UPDATE ON gifts FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- merchant_commissions (agent payout ledger) ---------------
CREATE TABLE merchant_commissions (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  enquiry_vehicle_id UUID NOT NULL UNIQUE REFERENCES enquiry_vehicles(id) ON DELETE CASCADE,
  agent_id           UUID NOT NULL REFERENCES agents(id),
  tier_id            UUID REFERENCES tiers(id),
  amount             NUMERIC(10,2) NOT NULL,
  status             reward_status NOT NULL DEFAULT 'pending',
  paid_at            TIMESTAMPTZ,
  failure_reason     TEXT,
  set_by             UUID,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_merchant_commissions_agent ON merchant_commissions(agent_id);
CREATE INDEX idx_merchant_commissions_status ON merchant_commissions(status);
CREATE TRIGGER merchant_commissions_updated_at
  BEFORE UPDATE ON merchant_commissions FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- merchant_settlements (merchant payable ledger) -----------
CREATE TABLE merchant_settlements (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  enquiry_vehicle_id UUID NOT NULL UNIQUE REFERENCES enquiry_vehicles(id) ON DELETE CASCADE,
  merchant_id        UUID NOT NULL REFERENCES merchants(id),
  amount             NUMERIC(10,2) NOT NULL,
  status             reward_status NOT NULL DEFAULT 'pending',
  paid_at            TIMESTAMPTZ,
  failure_reason     TEXT,
  set_by             UUID,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_merchant_settlements_merchant ON merchant_settlements(merchant_id);
CREATE INDEX idx_merchant_settlements_status ON merchant_settlements(status);
CREATE TRIGGER merchant_settlements_updated_at
  BEFORE UPDATE ON merchant_settlements FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- RLS ------------------------------------------------------
ALTER TABLE gifts                ENABLE ROW LEVEL SECURITY;
ALTER TABLE merchant_commissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE merchant_settlements ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admin full access to gifts"
  ON gifts FOR ALL TO authenticated USING (is_admin());

CREATE POLICY "Admin full access to merchant_commissions"
  ON merchant_commissions FOR ALL TO authenticated USING (is_admin());
CREATE POLICY "Agents read own commissions"
  ON merchant_commissions FOR SELECT TO authenticated USING (agent_id = get_agent_id());

CREATE POLICY "Admin full access to merchant_settlements"
  ON merchant_settlements FOR ALL TO authenticated USING (is_admin());
```

- [ ] **Step 2: Apply and assert**

Run:
```bash
npx supabase db reset
psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" -c \
"SELECT to_regclass('public.gifts'), to_regclass('public.merchant_commissions'), to_regclass('public.merchant_settlements');"
psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" -c \
"SELECT conname FROM pg_constraint WHERE conname LIKE '%enquiry_vehicle_id%key' ORDER BY conname;"
```
Expected: all three tables non-NULL; three unique constraints on `enquiry_vehicle_id` listed (one per ledger).

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260627000003_merchant_ledgers.sql
git commit -m "feat(partnership): add gift/commission/settlement ledgers with RLS"
```

---

## Task 4: Shared types — enums + merchant interfaces

**Files:**
- Modify: `packages/shared-types/src/enums.ts`
- Create: `packages/shared-types/src/merchant.ts`
- Modify: `packages/shared-types/src/index.ts`

**Interfaces:**
- Produces: enums `MerchantStatus`, `EnquiryStatus`, `VehicleStatus`, `GiftStatus`; interfaces `Merchant`, `MerchantBranch`, `InsuranceProduct`, `BranchLink`, `Enquiry`, `EnquiryVehicle`, `Gift`, `MerchantCommission`, `MerchantSettlement` (consumed by all later hooks/pages).

- [ ] **Step 1: Append the new enums to `enums.ts`**

Append to `packages/shared-types/src/enums.ts`:

```typescript

export enum MerchantStatus {
  PENDING = 'pending',
  ACTIVE = 'active',
  INACTIVE = 'inactive',
}

export enum EnquiryStatus {
  OPEN = 'open',
  CLOSED = 'closed',
}

export enum VehicleStatus {
  SUBMITTED = 'submitted',
  QUOTED = 'quoted',
  RENEWED = 'renewed',
  LOST = 'lost',
}

export enum GiftStatus {
  ISSUED = 'issued',
  REDEEMED = 'redeemed',
  EXPIRED = 'expired',
  VOID = 'void',
}
```

- [ ] **Step 2: Create `merchant.ts` with all interfaces**

Create `packages/shared-types/src/merchant.ts`:

```typescript
import {
  MerchantStatus,
  EnquiryStatus,
  VehicleStatus,
  GiftStatus,
  RewardStatus,
} from './enums';

export interface Merchant {
  id: string;
  name: string;
  logo_url: string | null;
  gift_pool_amount: number;
  merchant_share_pct: number;
  status: MerchantStatus;
  created_by_agent_id: string | null;
  approved_by: string | null;
  approved_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface MerchantBranch {
  id: string;
  merchant_id: string;
  name: string;
  address: string | null;
  phone: string | null;
  status: MerchantStatus;
  created_by_agent_id: string | null;
  approved_by: string | null;
  approved_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface InsuranceProduct {
  id: string;
  name: string;
  is_active: boolean;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

export interface BranchLink {
  id: string;
  merchant_branch_id: string;
  agent_id: string | null;
  link_code: string;
  is_active: boolean;
  created_at: string;
}

export interface Enquiry {
  id: string;
  branch_link_id: string;
  merchant_branch_id: string;
  agent_id: string | null;
  customer_name: string;
  customer_nric: string;
  customer_nric_normalized: string;
  customer_phone: string;
  customer_phone_normalized: string;
  customer_email: string | null;
  status: EnquiryStatus;
  created_at: string;
  updated_at: string;
}

export interface EnquiryVehicle {
  id: string;
  enquiry_id: string;
  merchant_branch_id: string;
  car_plate: string;
  car_plate_normalized: string;
  insurance_expiry_date: string;
  insurance_product_id: string;
  status: VehicleStatus;
  external_quotation_ref: string | null;
  quoted_at: string | null;
  quoted_by: string | null;
  renewed_at: string | null;
  renewed_by: string | null;
  lost_at: string | null;
  lost_reason: string | null;
  reminder_sent_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface Gift {
  id: string;
  enquiry_vehicle_id: string;
  merchant_id: string;
  merchant_branch_id: string;
  value_amount: number;
  voucher_code: string;
  status: GiftStatus;
  issued_at: string;
  redeemed_at: string | null;
  redeemed_by: string | null;
  expires_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface MerchantCommission {
  id: string;
  enquiry_vehicle_id: string;
  agent_id: string;
  tier_id: string | null;
  amount: number;
  status: RewardStatus;
  paid_at: string | null;
  failure_reason: string | null;
  set_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface MerchantSettlement {
  id: string;
  enquiry_vehicle_id: string;
  merchant_id: string;
  amount: number;
  status: RewardStatus;
  paid_at: string | null;
  failure_reason: string | null;
  set_by: string | null;
  created_at: string;
  updated_at: string;
}
```

- [ ] **Step 3: Re-export from `index.ts`**

In `packages/shared-types/src/index.ts`, add the line `export * from './merchant';` so the file reads:

```typescript
export * from './enums';
export * from './database';
export * from './partner';
export * from './tier-request';
export * from './merchant';
```

- [ ] **Step 4: Verify it compiles**

Run: `pnpm --filter @agent-system/shared-types typecheck`
Expected: `tsc --noEmit` exits 0 with no errors. (`shared-types` is consumed as source — `main`/`types` point at `./src/index.ts` — so this directly validates the new file with no build step.)

- [ ] **Step 5: Commit**

```bash
git add packages/shared-types/src/enums.ts packages/shared-types/src/merchant.ts packages/shared-types/src/index.ts
git commit -m "feat(partnership): add merchant-domain enums and TypeScript interfaces"
```

---

## Task 5: Admin module — Insurance Products CRUD

**Files:**
- Create: `apps/admin-portal/src/hooks/useInsuranceProducts.ts`
- Create: `apps/admin-portal/src/pages/insurance-products/InsuranceProductList.tsx`
- Modify: `apps/admin-portal/src/router.tsx`
- Modify: `apps/admin-portal/src/components/Layout.tsx`

**Interfaces:**
- Consumes: `InsuranceProduct` type; `supabase` from `../lib/supabase`.
- Produces: hooks `useInsuranceProducts`, `useCreateInsuranceProduct`, `useUpdateInsuranceProduct`, `useDeleteInsuranceProduct`; component `InsuranceProductList`; route `/insurance-products`.

- [ ] **Step 1: Create the hook**

Create `apps/admin-portal/src/hooks/useInsuranceProducts.ts`:

```typescript
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import type { InsuranceProduct } from '@agent-system/shared-types';

export function useInsuranceProducts() {
  return useQuery({
    queryKey: ['insurance_products'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('insurance_products')
        .select('*')
        .order('sort_order', { ascending: true });

      if (error) throw error;
      return data as InsuranceProduct[];
    },
  });
}

export function useCreateInsuranceProduct() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (
      product: Omit<InsuranceProduct, 'id' | 'created_at' | 'updated_at'>
    ) => {
      const { data, error } = await supabase
        .from('insurance_products')
        .insert(product)
        .select()
        .single();

      if (error) throw error;
      return data as InsuranceProduct;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['insurance_products'] });
    },
  });
}

export function useUpdateInsuranceProduct() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, ...updates }: Partial<InsuranceProduct> & { id: string }) => {
      const { data, error } = await supabase
        .from('insurance_products')
        .update(updates)
        .eq('id', id)
        .select()
        .single();

      if (error) throw error;
      return data as InsuranceProduct;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['insurance_products'] });
    },
  });
}

export function useDeleteInsuranceProduct() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('insurance_products').delete().eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['insurance_products'] });
    },
  });
}
```

- [ ] **Step 2: Create the list page**

Create `apps/admin-portal/src/pages/insurance-products/InsuranceProductList.tsx`:

```tsx
import { useState } from 'react';
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
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  Input,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  TableSkeleton,
} from '@agent-system/shared-ui';
import { Plus, Pencil, Trash2 } from 'lucide-react';
import {
  useInsuranceProducts,
  useCreateInsuranceProduct,
  useUpdateInsuranceProduct,
  useDeleteInsuranceProduct,
} from '../../hooks/useInsuranceProducts';
import type { InsuranceProduct } from '@agent-system/shared-types';

export function InsuranceProductList() {
  const { data: products, isLoading, error } = useInsuranceProducts();
  const createProduct = useCreateInsuranceProduct();
  const updateProduct = useUpdateInsuranceProduct();
  const deleteProduct = useDeleteInsuranceProduct();

  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editing, setEditing] = useState<InsuranceProduct | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [formData, setFormData] = useState({ name: '', is_active: true, sort_order: 0 });

  const handleOpenDialog = (product?: InsuranceProduct) => {
    if (product) {
      setEditing(product);
      setFormData({
        name: product.name,
        is_active: product.is_active,
        sort_order: product.sort_order,
      });
    } else {
      setEditing(null);
      setFormData({ name: '', is_active: true, sort_order: 0 });
    }
    setIsDialogOpen(true);
  };

  const handleSave = async () => {
    try {
      if (editing) {
        await updateProduct.mutateAsync({ id: editing.id, ...formData });
      } else {
        await createProduct.mutateAsync(formData);
      }
      setIsDialogOpen(false);
    } catch (err) {
      console.error('Failed to save product:', err);
    }
  };

  const confirmDelete = () => {
    if (deleteId) {
      deleteProduct.mutate(deleteId);
      setDeleteId(null);
    }
  };

  if (error) {
    return (
      <Card>
        <CardContent className="py-4">
          <p className="text-destructive">Error loading products: {error.message}</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="flex flex-col gap-4 animate-fade-in">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">Insurance Products</h1>
          <p className="text-sm text-muted-foreground">Products customers can choose on the enquiry form</p>
        </div>
        <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
          <DialogTrigger asChild>
            <Button onClick={() => handleOpenDialog()}>
              <Plus className="size-4 mr-1.5" />
              New Product
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{editing ? 'Edit Product' : 'Create Product'}</DialogTitle>
              <DialogDescription>
                {editing ? 'Update the product name, status, and order.' : 'Add a car-insurance product option.'}
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4">
              <div>
                <Label>Name</Label>
                <Input
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  placeholder="Comprehensive"
                />
              </div>
              <div>
                <Label>Status</Label>
                <Select
                  value={formData.is_active ? 'active' : 'inactive'}
                  onValueChange={(v) => setFormData({ ...formData, is_active: v === 'active' })}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="active">Active</SelectItem>
                    <SelectItem value="inactive">Inactive</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Sort Order</Label>
                <Input
                  type="number"
                  value={formData.sort_order}
                  onChange={(e) =>
                    setFormData({ ...formData, sort_order: parseInt(e.target.value, 10) || 0 })
                  }
                />
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setIsDialogOpen(false)}>Cancel</Button>
              <Button onClick={handleSave} disabled={createProduct.isPending || updateProduct.isPending}>
                {createProduct.isPending || updateProduct.isPending ? 'Saving...' : 'Save'}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>All Products</CardTitle>
          <CardDescription>{products?.length ?? 0} products</CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <TableSkeleton rows={4} columns={4} />
          ) : products?.length === 0 ? (
            <p className="text-sm text-muted-foreground">No products yet. Create your first product.</p>
          ) : (
            <div className="overflow-auto rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow className="hover:bg-transparent">
                    <TableHead>Name</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Sort Order</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {products?.map((product) => (
                    <TableRow key={product.id}>
                      <TableCell className="font-medium">{product.name}</TableCell>
                      <TableCell className="capitalize text-muted-foreground">
                        {product.is_active ? 'active' : 'inactive'}
                      </TableCell>
                      <TableCell className="text-right">{product.sort_order}</TableCell>
                      <TableCell className="text-right">
                        <div className="flex items-center justify-end gap-2">
                          <Button variant="ghost" size="sm" onClick={() => handleOpenDialog(product)} aria-label="Edit product">
                            <Pencil className="size-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => setDeleteId(product.id)}
                            disabled={deleteProduct.isPending}
                            aria-label="Delete product"
                          >
                            <Trash2 className="size-4 text-destructive" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      <AlertDialog open={!!deleteId} onOpenChange={(open) => !open && setDeleteId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Product</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete this product? This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={confirmDelete} className="bg-red-600 hover:bg-red-700">Delete</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
```

- [ ] **Step 3: Register the route**

In `apps/admin-portal/src/router.tsx`:
1. Add the import after the `TierList` import:
```tsx
import { InsuranceProductList } from './pages/insurance-products/InsuranceProductList';
```
2. Add the route definition after `tiersRoute`:
```tsx
const insuranceProductsRoute = createRoute({
  getParentRoute: () => protectedLayoutRoute,
  path: '/insurance-products',
  component: InsuranceProductList,
});
```
3. Add `insuranceProductsRoute,` to the `protectedLayoutRoute.addChildren([...])` array (after `tiersRoute,`).

- [ ] **Step 4: Add the nav entry**

In `apps/admin-portal/src/components/Layout.tsx`:
1. Add `Tag` to the `lucide-react` import (alongside the existing icons).
2. Add this entry to the `navigation` array (after the `Tiers` entry):
```tsx
  { name: 'Products', href: '/insurance-products', icon: Tag },
```

- [ ] **Step 5: Verify build**

Run: `pnpm --filter admin-portal build`
Expected: build succeeds, no `tsc` errors.

- [ ] **Step 6: Manual UI check (user runs the dev server)**

Run `pnpm dev:admin`, log in as `admin@test.com`, open `/insurance-products`. Expected: the three seeded products (Comprehensive / Third Party, Fire & Theft / Third Party) list; create/edit/delete work.

- [ ] **Step 7: Commit**

```bash
git add apps/admin-portal/src/hooks/useInsuranceProducts.ts apps/admin-portal/src/pages/insurance-products/InsuranceProductList.tsx apps/admin-portal/src/router.tsx apps/admin-portal/src/components/Layout.tsx
git commit -m "feat(partnership): admin Insurance Products CRUD module"
```

---

## Task 6: Admin module — Merchants CRUD + approval

**Files:**
- Create: `apps/admin-portal/src/hooks/useMerchants.ts`
- Create: `apps/admin-portal/src/pages/merchants/MerchantList.tsx`
- Modify: `apps/admin-portal/src/router.tsx`
- Modify: `apps/admin-portal/src/components/Layout.tsx`

**Interfaces:**
- Consumes: `Merchant`, `MerchantStatus`; `supabase`.
- Produces: hooks `useMerchants`, `useMerchant`, `useCreateMerchant`, `useUpdateMerchant`, `useDeleteMerchant`, `useApproveMerchant`; component `MerchantList`; route `/merchants`.

- [ ] **Step 1: Create the hook**

Create `apps/admin-portal/src/hooks/useMerchants.ts`:

```typescript
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { MerchantStatus, type Merchant } from '@agent-system/shared-types';

export function useMerchants() {
  return useQuery({
    queryKey: ['merchants'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('merchants')
        .select('*')
        .order('created_at', { ascending: false });

      if (error) throw error;
      return data as Merchant[];
    },
  });
}

export function useMerchant(id: string) {
  return useQuery({
    queryKey: ['merchants', id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('merchants')
        .select('*')
        .eq('id', id)
        .single();

      if (error) throw error;
      return data as Merchant;
    },
    enabled: !!id,
  });
}

// Admin-created merchants go live immediately (status active).
export function useCreateMerchant() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (
      merchant: Pick<Merchant, 'name' | 'logo_url' | 'gift_pool_amount' | 'merchant_share_pct'>
    ) => {
      const { data, error } = await supabase
        .from('merchants')
        .insert({ ...merchant, status: MerchantStatus.ACTIVE })
        .select()
        .single();

      if (error) throw error;
      return data as Merchant;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['merchants'] });
    },
  });
}

export function useUpdateMerchant() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, ...updates }: Partial<Merchant> & { id: string }) => {
      const { data, error } = await supabase
        .from('merchants')
        .update(updates)
        .eq('id', id)
        .select()
        .single();

      if (error) throw error;
      return data as Merchant;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['merchants'] });
      queryClient.invalidateQueries({ queryKey: ['merchants', data.id] });
    },
  });
}

export function useDeleteMerchant() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('merchants').delete().eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['merchants'] });
    },
  });
}

export function useApproveMerchant() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.rpc('approve_merchant', { merchant_uuid: id });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['merchants'] });
    },
  });
}
```

- [ ] **Step 2: Create the list page**

Create `apps/admin-portal/src/pages/merchants/MerchantList.tsx`:

```tsx
import { useState } from 'react';
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
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
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
} from '@agent-system/shared-ui';
import { Plus, Pencil, Trash2, Check } from 'lucide-react';
import {
  useMerchants,
  useCreateMerchant,
  useUpdateMerchant,
  useDeleteMerchant,
  useApproveMerchant,
} from '../../hooks/useMerchants';
import { MerchantStatus, type Merchant } from '@agent-system/shared-types';

export function MerchantList() {
  const { data: merchants, isLoading, error } = useMerchants();
  const createMerchant = useCreateMerchant();
  const updateMerchant = useUpdateMerchant();
  const deleteMerchant = useDeleteMerchant();
  const approveMerchant = useApproveMerchant();

  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editing, setEditing] = useState<Merchant | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [formData, setFormData] = useState({
    name: '',
    logo_url: '',
    gift_pool_amount: 0,
    merchant_share_pct: 0,
  });

  const handleOpenDialog = (merchant?: Merchant) => {
    if (merchant) {
      setEditing(merchant);
      setFormData({
        name: merchant.name,
        logo_url: merchant.logo_url ?? '',
        gift_pool_amount: merchant.gift_pool_amount,
        merchant_share_pct: merchant.merchant_share_pct,
      });
    } else {
      setEditing(null);
      setFormData({ name: '', logo_url: '', gift_pool_amount: 0, merchant_share_pct: 0 });
    }
    setIsDialogOpen(true);
  };

  const handleSave = async () => {
    const payload = {
      name: formData.name,
      logo_url: formData.logo_url.trim() === '' ? null : formData.logo_url.trim(),
      gift_pool_amount: formData.gift_pool_amount,
      merchant_share_pct: formData.merchant_share_pct,
    };
    try {
      if (editing) {
        await updateMerchant.mutateAsync({ id: editing.id, ...payload });
      } else {
        await createMerchant.mutateAsync(payload);
      }
      setIsDialogOpen(false);
    } catch (err) {
      console.error('Failed to save merchant:', err);
    }
  };

  const confirmDelete = () => {
    if (deleteId) {
      deleteMerchant.mutate(deleteId);
      setDeleteId(null);
    }
  };

  if (error) {
    return (
      <Card>
        <CardContent className="py-4">
          <p className="text-destructive">Error loading merchants: {error.message}</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="flex flex-col gap-4 animate-fade-in">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">Partnerships</h1>
          <p className="text-sm text-muted-foreground">Gift-partner merchants and their gold-gift split</p>
        </div>
        <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
          <DialogTrigger asChild>
            <Button onClick={() => handleOpenDialog()}>
              <Plus className="size-4 mr-1.5" />
              New Partnership
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{editing ? 'Edit Partnership' : 'Create Partnership'}</DialogTitle>
              <DialogDescription>
                Set the fixed gift pool and the merchant share. The customer gift is the remainder.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4">
              <div>
                <Label>Merchant Name</Label>
                <Input
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  placeholder="Poh Kong"
                />
              </div>
              <div>
                <Label>Logo URL (optional)</Label>
                <Input
                  value={formData.logo_url}
                  onChange={(e) => setFormData({ ...formData, logo_url: e.target.value })}
                  placeholder="https://..."
                />
              </div>
              <div>
                <Label>Gift Pool Amount (RM)</Label>
                <Input
                  type="number"
                  value={formData.gift_pool_amount}
                  onChange={(e) =>
                    setFormData({ ...formData, gift_pool_amount: parseFloat(e.target.value) || 0 })
                  }
                />
              </div>
              <div>
                <Label>Merchant Share (%)</Label>
                <Input
                  type="number"
                  min={0}
                  max={100}
                  value={formData.merchant_share_pct}
                  onChange={(e) =>
                    setFormData({ ...formData, merchant_share_pct: parseFloat(e.target.value) || 0 })
                  }
                />
                <p className="text-xs text-muted-foreground mt-1">
                  Customer gift share: {Math.max(0, 100 - formData.merchant_share_pct)}% (RM
                  {((formData.gift_pool_amount * Math.max(0, 100 - formData.merchant_share_pct)) / 100).toFixed(2)})
                </p>
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setIsDialogOpen(false)}>Cancel</Button>
              <Button onClick={handleSave} disabled={createMerchant.isPending || updateMerchant.isPending}>
                {createMerchant.isPending || updateMerchant.isPending ? 'Saving...' : 'Save'}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>All Partnerships</CardTitle>
          <CardDescription>{merchants?.length ?? 0} merchants</CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <TableSkeleton rows={5} columns={5} />
          ) : merchants?.length === 0 ? (
            <p className="text-sm text-muted-foreground">No partnerships yet. Create your first merchant.</p>
          ) : (
            <div className="overflow-auto rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow className="hover:bg-transparent">
                    <TableHead>Name</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Pool (RM)</TableHead>
                    <TableHead className="text-right">Merchant / Customer</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {merchants?.map((merchant) => (
                    <TableRow key={merchant.id}>
                      <TableCell className="font-medium">
                        <Link to="/merchants/$merchantId" params={{ merchantId: merchant.id }} className="hover:underline">
                          {merchant.name}
                        </Link>
                      </TableCell>
                      <TableCell className="capitalize text-muted-foreground">{merchant.status}</TableCell>
                      <TableCell className="text-right">RM{merchant.gift_pool_amount.toFixed(2)}</TableCell>
                      <TableCell className="text-right text-muted-foreground">
                        {merchant.merchant_share_pct}% / {100 - merchant.merchant_share_pct}%
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex items-center justify-end gap-2">
                          {merchant.status === MerchantStatus.PENDING && (
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => approveMerchant.mutate(merchant.id)}
                              disabled={approveMerchant.isPending}
                              aria-label="Approve merchant"
                            >
                              <Check className="size-4 text-emerald-600" />
                            </Button>
                          )}
                          <Button variant="ghost" size="sm" onClick={() => handleOpenDialog(merchant)} aria-label="Edit merchant">
                            <Pencil className="size-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => setDeleteId(merchant.id)}
                            disabled={deleteMerchant.isPending}
                            aria-label="Delete merchant"
                          >
                            <Trash2 className="size-4 text-destructive" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      <AlertDialog open={!!deleteId} onOpenChange={(open) => !open && setDeleteId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Partnership</AlertDialogTitle>
            <AlertDialogDescription>
              Deleting a merchant also deletes its branches and links. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={confirmDelete} className="bg-red-600 hover:bg-red-700">Delete</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
```

- [ ] **Step 3: Register the route + nav**

In `apps/admin-portal/src/router.tsx`:
1. Import after the `InsuranceProductList` import:
```tsx
import { MerchantList } from './pages/merchants/MerchantList';
```
2. Add route after `insuranceProductsRoute`:
```tsx
const merchantsRoute = createRoute({
  getParentRoute: () => protectedLayoutRoute,
  path: '/merchants',
  component: MerchantList,
});
```
3. Add `merchantsRoute,` to `protectedLayoutRoute.addChildren([...])`.

In `apps/admin-portal/src/components/Layout.tsx`:
1. Add `Store` to the `lucide-react` import.
2. Add to the `navigation` array (before the `Products` entry):
```tsx
  { name: 'Partnerships', href: '/merchants', icon: Store },
```

- [ ] **Step 4: Verify build**

Run: `pnpm --filter admin-portal build`
Expected: build succeeds, no `tsc` errors.

- [ ] **Step 5: Commit**

```bash
git add apps/admin-portal/src/hooks/useMerchants.ts apps/admin-portal/src/pages/merchants/MerchantList.tsx apps/admin-portal/src/router.tsx apps/admin-portal/src/components/Layout.tsx
git commit -m "feat(partnership): admin Merchants list, create/edit, and approval"
```

---

## Task 7: Admin module — Merchant detail + Branches CRUD + approval

**Files:**
- Create: `apps/admin-portal/src/hooks/useMerchantBranches.ts`
- Create: `apps/admin-portal/src/pages/merchants/MerchantDetail.tsx`
- Modify: `apps/admin-portal/src/router.tsx`

**Interfaces:**
- Consumes: `MerchantBranch`, `MerchantStatus`, `Merchant`; `useMerchant` (Task 6); `supabase`.
- Produces: hooks `useMerchantBranches`, `useCreateMerchantBranch`, `useUpdateMerchantBranch`, `useDeleteMerchantBranch`, `useApproveMerchantBranch`; component `MerchantDetail`; route `/merchants/$merchantId`.

- [ ] **Step 1: Create the branches hook**

Create `apps/admin-portal/src/hooks/useMerchantBranches.ts`:

```typescript
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { MerchantStatus, type MerchantBranch } from '@agent-system/shared-types';

export function useMerchantBranches(merchantId: string) {
  return useQuery({
    queryKey: ['merchant_branches', merchantId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('merchant_branches')
        .select('*')
        .eq('merchant_id', merchantId)
        .order('created_at', { ascending: true });

      if (error) throw error;
      return data as MerchantBranch[];
    },
    enabled: !!merchantId,
  });
}

export function useCreateMerchantBranch() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (
      branch: Pick<MerchantBranch, 'merchant_id' | 'name' | 'address' | 'phone'>
    ) => {
      const { data, error } = await supabase
        .from('merchant_branches')
        .insert({ ...branch, status: MerchantStatus.ACTIVE })
        .select()
        .single();

      if (error) throw error;
      return data as MerchantBranch;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['merchant_branches', data.merchant_id] });
    },
  });
}

export function useUpdateMerchantBranch() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, ...updates }: Partial<MerchantBranch> & { id: string }) => {
      const { data, error } = await supabase
        .from('merchant_branches')
        .update(updates)
        .eq('id', id)
        .select()
        .single();

      if (error) throw error;
      return data as MerchantBranch;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['merchant_branches', data.merchant_id] });
    },
  });
}

export function useDeleteMerchantBranch(merchantId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('merchant_branches').delete().eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['merchant_branches', merchantId] });
    },
  });
}

export function useApproveMerchantBranch(merchantId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.rpc('approve_merchant_branch', { branch_uuid: id });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['merchant_branches', merchantId] });
    },
  });
}
```

- [ ] **Step 2: Create the detail page**

Create `apps/admin-portal/src/pages/merchants/MerchantDetail.tsx`:

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
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
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
} from '@agent-system/shared-ui';
import { Plus, Pencil, Trash2, Check, ArrowLeft } from 'lucide-react';
import { useMerchant } from '../../hooks/useMerchants';
import {
  useMerchantBranches,
  useCreateMerchantBranch,
  useUpdateMerchantBranch,
  useDeleteMerchantBranch,
  useApproveMerchantBranch,
} from '../../hooks/useMerchantBranches';
import { MerchantStatus, type MerchantBranch } from '@agent-system/shared-types';

export function MerchantDetail() {
  const { merchantId } = useParams({ strict: false }) as { merchantId: string };
  const { data: merchant } = useMerchant(merchantId);
  const { data: branches, isLoading, error } = useMerchantBranches(merchantId);
  const createBranch = useCreateMerchantBranch();
  const updateBranch = useUpdateMerchantBranch();
  const deleteBranch = useDeleteMerchantBranch(merchantId);
  const approveBranch = useApproveMerchantBranch(merchantId);

  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editing, setEditing] = useState<MerchantBranch | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [formData, setFormData] = useState({ name: '', address: '', phone: '' });

  const handleOpenDialog = (branch?: MerchantBranch) => {
    if (branch) {
      setEditing(branch);
      setFormData({ name: branch.name, address: branch.address ?? '', phone: branch.phone ?? '' });
    } else {
      setEditing(null);
      setFormData({ name: '', address: '', phone: '' });
    }
    setIsDialogOpen(true);
  };

  const handleSave = async () => {
    const payload = {
      name: formData.name,
      address: formData.address.trim() === '' ? null : formData.address.trim(),
      phone: formData.phone.trim() === '' ? null : formData.phone.trim(),
    };
    try {
      if (editing) {
        await updateBranch.mutateAsync({ id: editing.id, ...payload });
      } else {
        await createBranch.mutateAsync({ merchant_id: merchantId, ...payload });
      }
      setIsDialogOpen(false);
    } catch (err) {
      console.error('Failed to save branch:', err);
    }
  };

  const confirmDelete = () => {
    if (deleteId) {
      deleteBranch.mutate(deleteId);
      setDeleteId(null);
    }
  };

  if (error) {
    return (
      <Card>
        <CardContent className="py-4">
          <p className="text-destructive">Error loading branches: {error.message}</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="flex flex-col gap-4 animate-fade-in">
      <div>
        <Link to="/merchants" className="inline-flex items-center text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft className="size-4 mr-1" />
          Back to Partnerships
        </Link>
      </div>

      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">{merchant?.name ?? 'Merchant'}</h1>
          <p className="text-sm text-muted-foreground">
            Pool RM{merchant?.gift_pool_amount?.toFixed(2) ?? '0.00'} ·{' '}
            {merchant?.merchant_share_pct ?? 0}% merchant / {100 - (merchant?.merchant_share_pct ?? 0)}% customer
          </p>
        </div>
        <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
          <DialogTrigger asChild>
            <Button onClick={() => handleOpenDialog()}>
              <Plus className="size-4 mr-1.5" />
              New Branch
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{editing ? 'Edit Branch' : 'Create Branch'}</DialogTitle>
              <DialogDescription>An outlet where customers can be referred.</DialogDescription>
            </DialogHeader>
            <div className="space-y-4">
              <div>
                <Label>Branch Name</Label>
                <Input
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  placeholder="Poh Kong — Sunway Pyramid"
                />
              </div>
              <div>
                <Label>Address (optional)</Label>
                <Input
                  value={formData.address}
                  onChange={(e) => setFormData({ ...formData, address: e.target.value })}
                />
              </div>
              <div>
                <Label>Phone (optional)</Label>
                <Input
                  value={formData.phone}
                  onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                />
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setIsDialogOpen(false)}>Cancel</Button>
              <Button onClick={handleSave} disabled={createBranch.isPending || updateBranch.isPending}>
                {createBranch.isPending || updateBranch.isPending ? 'Saving...' : 'Save'}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Branches</CardTitle>
          <CardDescription>{branches?.length ?? 0} branches</CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <TableSkeleton rows={4} columns={4} />
          ) : branches?.length === 0 ? (
            <p className="text-sm text-muted-foreground">No branches yet. Add the first outlet.</p>
          ) : (
            <div className="overflow-auto rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow className="hover:bg-transparent">
                    <TableHead>Name</TableHead>
                    <TableHead>Phone</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {branches?.map((branch) => (
                    <TableRow key={branch.id}>
                      <TableCell className="font-medium">{branch.name}</TableCell>
                      <TableCell className="text-muted-foreground">{branch.phone ?? '—'}</TableCell>
                      <TableCell className="capitalize text-muted-foreground">{branch.status}</TableCell>
                      <TableCell className="text-right">
                        <div className="flex items-center justify-end gap-2">
                          {branch.status === MerchantStatus.PENDING && (
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => approveBranch.mutate(branch.id)}
                              disabled={approveBranch.isPending}
                              aria-label="Approve branch"
                            >
                              <Check className="size-4 text-emerald-600" />
                            </Button>
                          )}
                          <Button variant="ghost" size="sm" onClick={() => handleOpenDialog(branch)} aria-label="Edit branch">
                            <Pencil className="size-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => setDeleteId(branch.id)}
                            disabled={deleteBranch.isPending}
                            aria-label="Delete branch"
                          >
                            <Trash2 className="size-4 text-destructive" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      <AlertDialog open={!!deleteId} onOpenChange={(open) => !open && setDeleteId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Branch</AlertDialogTitle>
            <AlertDialogDescription>
              Deleting a branch also deletes its links. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={confirmDelete} className="bg-red-600 hover:bg-red-700">Delete</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
```

- [ ] **Step 3: Register the route**

In `apps/admin-portal/src/router.tsx`:
1. Import after the `MerchantList` import:
```tsx
import { MerchantDetail } from './pages/merchants/MerchantDetail';
```
2. Add route after `merchantsRoute`:
```tsx
const merchantDetailRoute = createRoute({
  getParentRoute: () => protectedLayoutRoute,
  path: '/merchants/$merchantId',
  component: MerchantDetail,
});
```
3. Add `merchantDetailRoute,` to `protectedLayoutRoute.addChildren([...])` (after `merchantsRoute,`).

- [ ] **Step 4: Verify build**

Run: `pnpm --filter admin-portal build`
Expected: build succeeds, no `tsc` errors.

- [ ] **Step 5: Manual UI check (user runs the dev server)**

In `pnpm dev:admin`, create a Partnership, open it, add a Branch, edit and delete a Branch. Expected: all operations persist and the branch list refreshes.

- [ ] **Step 6: Commit**

```bash
git add apps/admin-portal/src/hooks/useMerchantBranches.ts apps/admin-portal/src/pages/merchants/MerchantDetail.tsx apps/admin-portal/src/router.tsx
git commit -m "feat(partnership): admin Merchant detail with Branches CRUD and approval"
```

---

## Phase 1 done — verification summary

- `npx supabase db reset` applies all three migrations cleanly; 9 new tables + 4 enums + 2 approve RPCs exist; `insurance_products` seeded with 3 rows.
- `pnpm --filter admin-portal build` passes.
- Admin can: manage Insurance Products; create/edit/approve/delete Merchants; open a merchant and manage its Branches.

## Next phases (separate plans, written when Phase 1 is merged)

2. Public capture — `branch_links` generation + `/public/enquiry/:linkCode` route + `submit_enquiry` RPC (anon, dedup, agent snapshot).
3. Admin pipeline — vehicle state machine, `confirm_vehicle_renewal` (mints gift + commission + settlement), status RPCs, payout/redemption UIs.
4. Reminders — `pg_cron` + `pg_net`, `enqueue_expiry_reminders`, `send-expiry-reminders` edge function.
5. Agent portal — propose merchant/branch, generate branch links, my enquiries & commissions.
