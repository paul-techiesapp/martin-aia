# Partnership Feedback Changes — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship one round of merchant-partnership feedback: sidebar Events/Partnership regrouping, removal of the gift pool in favour of a standard 10% gift (= merchant payable), per-car partner confirmation at renewal, enquiries sort/filter/xlsx download (admin + agent), a "Get Quote" email flow, an admin-editable enquiry-form header/footer + PDPA T&C with mandatory fields + road tax, and a master successful-renewals report.

**Architecture:** Three additive SQL migrations (vehicle columns + gift-rate setting + `confirm_vehicle_renewal` rewrite; `system_settings.enquiry_form`/`admin_notification_email`; `submit_enquiry` road-tax) → shared-types + shared-ui export builders → admin portal UI → agent portal UI → one new Resend edge function → public enquiry form → staging deploy → Excel status sheet. The gift/settlement money flow is recomputed from `renewal_premium_amount × customer_gift_rate_pct`.

**Tech Stack:** React 18 + Vite + TS, TanStack Router/Query, shadcn/ui, react-hook-form + zod, Supabase (Postgres 15 + RLS + SECURITY DEFINER RPCs), Deno edge functions + Resend, `write-excel-file` (already a dep).

## Global Constraints

- **Branch:** all commits on `feat/merchant-partnership`. Branch-guard every commit (repo has concurrent-workflow branch thrash).
- **No test runner / no eslint** in this repo. Per-task verification cycle = `pnpm -r typecheck` then `pnpm build` (or `pnpm --filter <app> build`), plus the manual check named in the task. There is no `pnpm test`.
- **No new dependencies.** `pnpm add` re-trips a dual-zod tsc failure. `write-excel-file`, `jspdf`, `qrcode.react`, etc. are already present — reuse only.
- **Deploy target:** staging Supabase `lyjdlietzmmejrxjvwgp` only (via Supabase MCP `apply_migration` / `deploy_edge_function`). Never prod in this change set.
- **Migrations are additive.** Do not drop `merchants.gift_pool_amount` / `merchant_share_pct` (kept as dead columns). New migration prefixes start at `20260630000001`.
- **Single Supabase client:** apps import `supabase` from `@agent-system/shared-ui` (never local `createClient`).
- **Gift rule (verbatim):** customer gift value = `round(renewal_premium_amount × customer_gift_rate_pct / 100, 2)`; merchant settlement amount = the **same** value; default rate = 10.
- **Sidebar groups (verbatim labels):** `EVENTS` and `PARTNERSHIP`. Agent "Partners" (recruitment) belongs to EVENTS.
- **From-address** for Resend stays `RACC Partnership <enquiries@raccagency.com>`.

---

## Canonical interfaces (used across tasks)

Defined once here so every task uses identical names/types.

**SQL RPCs:**
- `confirm_vehicle_renewal(p_vehicle_id uuid, p_premium_amount numeric, p_merchant_id uuid) RETURNS void` — Task 1.
- `submit_enquiry(p_link_code text, p_customer_name text, p_customer_nric text, p_customer_phone text, p_customer_email text, p_vehicles jsonb) RETURNS uuid` — each vehicle object now includes `road_tax_renewal boolean` — Task 3.

**TypeScript types (`packages/shared-types`):**
```ts
// database.ts
export interface EnquiryFormSettings {
  header_logo_url: string;
  header_title: string;
  header_subtitle: string;
  footer_text: string;
  tnc_body: string;
  dpo_contact: string;
}
export interface SystemSettings {
  company_branding: CompanyBranding;
  card_template: CardTemplate;
  enquiry_form: EnquiryFormSettings;          // NEW
  admin_notification_email: string | null;    // NEW
  customer_gift_rate_pct: number;             // NEW
  updated_at: string;
}
// merchant.ts — EnquiryVehicle gains:
//   merchant_id?: string | null
//   renewal_premium_amount?: number | null
//   road_tax_renewal: boolean
//   quote_requested_at?: string | null
// Merchant — gift_pool_amount?: number; merchant_share_pct?: number  (optional/deprecated)
```

**Hooks:**
- `useConfirmVehicleRenewal()` → `mutateAsync({ vehicleId: string; premiumAmount: number; merchantId: string })` — Task 10.
- `useRequestQuote(agentId?: string)` → `mutateAsync({ enquiryId: string; vehicleId: string })` — Task 13.
- `useEnquiryFormSettings()` → `{ data?: EnquiryFormSettings; isLoading }` (public anon read) — Task 15.
- `useRenewalReport(filters)` → renewed-vehicle rows — Task 11.

**shared-ui export builders (`packages/shared-ui/src/utils/excelGenerator.ts`):**
- `buildEnquiriesWorkbook(rows: EnquiryExportRow[], meta?: { generatedAt?: string }): Promise<void>` — triggers `.xlsx` download.
- `buildRenewalsWorkbook(rows: RenewalExportRow[], meta?: { generatedAt?: string }): Promise<void>`.
```ts
export interface EnquiryExportRow {
  unit: string; agent: string; agentCode: string; partner: string;
  customer: string; phone: string; email: string; carPlate: string;
  insuranceExpiry: string; roadTax: string; vehicleStatus: string;
  enquiryStatus: string; received: string;
}
export interface RenewalExportRow {
  partner: string; unit: string; agent: string; customer: string;
  carPlate: string; renewedAt: string; premium: number; giftValue: number;
}
```

**Sidebar grouped nav model (both Layouts):**
```ts
type NavItem = { name: string; href: string; icon: LucideIcon; badge?: number };
type NavGroup = { label?: string; items: NavItem[] }; // label undefined => no header
```

---

## Phase 0 — Backend foundations

### Task 1: Migration — gift rate, vehicle columns, `confirm_vehicle_renewal` rewrite

**Files:**
- Create: `supabase/migrations/20260630000001_partnership_gift_rate.sql`

**Interfaces:**
- Produces: vehicle columns `renewal_premium_amount`, `merchant_id`, `road_tax_renewal`, `quote_requested_at`; `system_settings.customer_gift_rate_pct`; new `confirm_vehicle_renewal(uuid, numeric, uuid)`.
- Consumes: existing `enquiry_vehicles`, `merchants`, `gifts`, `merchant_settlements`, `enquiries`, `system_settings`, and helper `is_admin()`.

- [ ] **Step 1: Read the active RPC to preserve behaviour**

Read `supabase/migrations/20260629000010_enquiry_v2.sql:95-123` (active `confirm_vehicle_renewal`) and `supabase/migrations/20260627000003_merchant_ledgers.sql` (gifts/merchant_settlements columns) so the rewrite inserts the same columns those tables require (e.g. `gifts.value_amount`, status defaults, `merchant_settlements.amount`). Confirm `gifts` and `merchant_settlements` column names before writing inserts.

- [ ] **Step 2: Write the migration**

```sql
-- 20260630000001_partnership_gift_rate.sql
-- Feedback: remove gift pool / merchant-share split. Customer gift = standard
-- rate (default 10%) of the car-insurance renewal premium; merchant settlement
-- equals that same gift value. Partner is confirmed per-car at renewal.

-- 1. Per-vehicle columns
ALTER TABLE enquiry_vehicles
  ADD COLUMN IF NOT EXISTS renewal_premium_amount NUMERIC(12,2),
  ADD COLUMN IF NOT EXISTS merchant_id UUID REFERENCES merchants(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS road_tax_renewal BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS quote_requested_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_enquiry_vehicles_merchant ON enquiry_vehicles(merchant_id);

-- 2. Global gift rate setting
ALTER TABLE system_settings
  ADD COLUMN IF NOT EXISTS customer_gift_rate_pct NUMERIC(5,2) NOT NULL DEFAULT 10
    CHECK (customer_gift_rate_pct >= 0 AND customer_gift_rate_pct <= 100);

-- 3. Rewrite confirm_vehicle_renewal: premium + per-car merchant -> gift = rate% of premium
CREATE OR REPLACE FUNCTION confirm_vehicle_renewal(
  p_vehicle_id   uuid,
  p_premium_amount numeric,
  p_merchant_id  uuid
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_enquiry_id uuid;
  v_rate    numeric;
  v_gift    numeric;
  v_open    int;
BEGIN
  IF NOT is_admin() THEN
    RAISE EXCEPTION 'Only admins can confirm renewals' USING ERRCODE = '42501';
  END IF;
  IF p_premium_amount IS NULL OR p_premium_amount < 0 THEN
    RAISE EXCEPTION 'Renewal premium must be >= 0' USING ERRCODE = 'P0001';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM merchants WHERE id = p_merchant_id AND status = 'active') THEN
    RAISE EXCEPTION 'Partner merchant must be active' USING ERRCODE = 'P0001';
  END IF;

  SELECT enquiry_id INTO v_enquiry_id FROM enquiry_vehicles
   WHERE id = p_vehicle_id AND status IN ('submitted','quoted');
  IF v_enquiry_id IS NULL THEN
    RAISE EXCEPTION 'Vehicle not found or not in a renewable state' USING ERRCODE = 'P0002';
  END IF;

  SELECT customer_gift_rate_pct INTO v_rate FROM system_settings LIMIT 1;
  v_rate := COALESCE(v_rate, 10);
  v_gift := round(p_premium_amount * v_rate / 100.0, 2);

  UPDATE enquiry_vehicles
     SET status = 'renewed',
         renewed_at = now(),
         renewed_by = auth.uid(),
         renewal_premium_amount = p_premium_amount,
         merchant_id = p_merchant_id,
         updated_at = now()
   WHERE id = p_vehicle_id;

  -- keep enquiry-level suggestion in sync if unset
  UPDATE enquiries SET merchant_id = p_merchant_id, updated_at = now()
   WHERE id = v_enquiry_id AND merchant_id IS NULL;

  -- customer gold gift
  INSERT INTO gifts (enquiry_vehicle_id, merchant_id, value_amount, status)
  VALUES (p_vehicle_id, p_merchant_id, v_gift, 'pending');

  -- merchant payable = same value
  INSERT INTO merchant_settlements (enquiry_vehicle_id, merchant_id, amount, status)
  VALUES (p_vehicle_id, p_merchant_id, v_gift, 'pending');

  -- close enquiry when no vehicles remain open
  SELECT count(*) INTO v_open FROM enquiry_vehicles
   WHERE enquiry_id = v_enquiry_id AND status IN ('submitted','quoted');
  IF v_open = 0 THEN
    UPDATE enquiries SET status = 'closed', updated_at = now() WHERE id = v_enquiry_id;
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION confirm_vehicle_renewal(uuid, numeric, uuid) TO authenticated;
```

> NOTE during Step 1: adjust the `INSERT INTO gifts (...)` and `INSERT INTO merchant_settlements (...)` column lists to the **actual** columns in `20260627000003_merchant_ledgers.sql` (e.g. if `gifts` requires `enquiry_id`, `merchant_branch_id`, or a different status enum default). The v2 RPC at `20260629000010_enquiry_v2.sql:111-119` is the source of truth for the exact insert shape — mirror it, only swapping the amount source to `v_gift` and the merchant source to `p_merchant_id`.

- [ ] **Step 3: Validate SQL locally (syntax)**

Run: `grep -c "confirm_vehicle_renewal" supabase/migrations/20260630000001_partnership_gift_rate.sql`
Expected: `1` (single CREATE OR REPLACE). Visual-check the insert column lists match Step 1 findings.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260630000001_partnership_gift_rate.sql
git commit -m "feat(partnership): gift rate setting + per-car renewal columns + 10% confirm_vehicle_renewal"
```

(Staging apply happens in Task 16 after all migrations exist.)

---

### Task 2: Migration — enquiry-form settings + admin notification email

**Files:**
- Create: `supabase/migrations/20260630000002_enquiry_form_settings.sql`

**Interfaces:**
- Produces: `system_settings.enquiry_form` JSONB (seeded PDPA), `system_settings.admin_notification_email` TEXT.

- [ ] **Step 1: Write the migration (PDPA text seeded verbatim from spec page 6)**

```sql
-- 20260630000002_enquiry_form_settings.sql
ALTER TABLE system_settings
  ADD COLUMN IF NOT EXISTS admin_notification_email TEXT;

ALTER TABLE system_settings
  ADD COLUMN IF NOT EXISTS enquiry_form JSONB NOT NULL DEFAULT jsonb_build_object(
    'header_logo_url', '',
    'header_title', 'Car Insurance Enquiry — Gold Gift on Renewal',
    'header_subtitle', 'Submit your details and our team will be in touch about your renewal and gold gift.',
    'footer_text', '© RACC Agency. All rights reserved.',
    'dpo_contact', 'dpo@raccagency.com',
    'tnc_body', $tnc$Personal Data Protection Act (PDPA)
Consent & Disclosure Clause

1. Collection and Purpose of Use
By submitting this form, you agree that we may collect, use, and process the personal data you provide for the following purposes:
• Communication: To contact you regarding your inquiries, updates, and relevant announcements.
• Fulfilling Requests: To process, manage, and fulfill your specific requests, orders, or transactions.
• Improving Our Services: To conduct internal research, analytics, and evaluation to enhance our products, services, and overall customer experience.

2. Disclosure to Third Parties
To effectively fulfill the purposes stated above, we may disclose and share your personal data with:
• Our trusted business partners who co-provide services or products with us.
• Third-party vendors, service providers, and contractors who perform functions on our behalf (e.g., IT service providers, delivery/logistics partners, data analysts).

Note: We require all third parties to strictly respect the security of your personal data and to treat it in accordance with applicable personal data protection laws. They are only permitted to process your data for specified purposes and in accordance with our instructions.

3. Your Rights and Withdrawal of Consent
You have the right to access, correct, or withdraw your consent for the use and disclosure of your personal data at any time. If you wish to do so, please contact our Data Protection Officer (DPO).$tnc$
  );
```

- [ ] **Step 2: Sanity-check the JSON builds**

Run: `grep -c "enquiry_form" supabase/migrations/20260630000002_enquiry_form_settings.sql`
Expected: `1`. (The `$tnc$` dollar-quote avoids escaping the multi-line clause.)

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260630000002_enquiry_form_settings.sql
git commit -m "feat(settings): admin-editable enquiry-form header/footer + PDPA T&C + admin email"
```

---

### Task 3: Migration — `submit_enquiry` persists road tax

**Files:**
- Create: `supabase/migrations/20260630000003_submit_enquiry_roadtax.sql`

**Interfaces:**
- Consumes: current `submit_enquiry` body — copy it from `supabase/migrations/20260629000030_enquiry_attachments.sql:74-138` and add one field.
- Produces: `submit_enquiry` that reads `road_tax_renewal` from each `p_vehicles` element and stores it.

- [ ] **Step 1: Copy the current submit_enquiry, add road_tax**

Read `20260629000030_enquiry_attachments.sql:74-138`. Reproduce the entire function as `CREATE OR REPLACE`, changing only the per-vehicle INSERT to include `road_tax_renewal`:

```sql
-- inside the vehicles loop, the INSERT INTO enquiry_vehicles (...) VALUES (...)
-- add column road_tax_renewal and value COALESCE((v_vehicle->>'road_tax_renewal')::boolean, false)
INSERT INTO enquiry_vehicles (enquiry_id, merchant_branch_id, car_plate, insurance_expiry_date, road_tax_renewal /* ...existing cols... */)
VALUES (v_enquiry_id, /*...*/, (v_vehicle->>'car_plate'), (v_vehicle->>'expiry_date')::date,
        COALESCE((v_vehicle->>'road_tax_renewal')::boolean, false) /* ...existing values... */)
RETURNING id INTO v_vehicle_id;
```

Keep everything else identical (link resolution, attachments loop with `ON CONFLICT (storage_path) DO NOTHING`, `notify_agent_enquiry`, grants to `anon`). Preserve the exact existing column list — only add `road_tax_renewal`.

- [ ] **Step 2: Verify single definition + grant present**

Run: `grep -E "CREATE OR REPLACE FUNCTION submit_enquiry|GRANT EXECUTE ON FUNCTION submit_enquiry" supabase/migrations/20260630000003_submit_enquiry_roadtax.sql`
Expected: both lines present.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260630000003_submit_enquiry_roadtax.sql
git commit -m "feat(enquiry): submit_enquiry persists per-vehicle road_tax_renewal"
```

---

### Task 4: shared-types updates

**Files:**
- Modify: `packages/shared-types/src/database.ts`
- Modify: `packages/shared-types/src/merchant.ts`

**Interfaces:**
- Produces: `EnquiryFormSettings`, extended `SystemSettings`, `DEFAULT_ENQUIRY_FORM`; extended `EnquiryVehicle`; deprecated-optional `Merchant.gift_pool_amount`/`merchant_share_pct`.

- [ ] **Step 1: Edit `database.ts`**

Add `EnquiryFormSettings` interface and `DEFAULT_ENQUIRY_FORM` const (mirroring the migration seed), and add the three new fields to `SystemSettings` exactly as shown in the Canonical interfaces section above. Keep `CompanyBranding`/`CardTemplate` untouched.

- [ ] **Step 2: Edit `merchant.ts`**

On `EnquiryVehicle` add: `merchant_id?: string | null; renewal_premium_amount?: number | null; road_tax_renewal: boolean; quote_requested_at?: string | null`. On `Merchant` make `gift_pool_amount?: number` and `merchant_share_pct?: number` optional with a `/** @deprecated pool/split removed; see customer_gift_rate_pct */` comment.

- [ ] **Step 3: Verify build of the package**

Run: `pnpm --filter @agent-system/shared-types build`
Expected: success (or, if the package has no build step, `pnpm -r typecheck` clean for it).

- [ ] **Step 4: Commit**

```bash
git add packages/shared-types/src/database.ts packages/shared-types/src/merchant.ts
git commit -m "feat(types): enquiry-form settings + per-car renewal/roadtax fields; deprecate pool/split"
```

---

### Task 5: shared-ui Excel builders

**Files:**
- Modify: `packages/shared-ui/src/utils/excelGenerator.ts`

**Interfaces:**
- Consumes: `EnquiryExportRow`, `RenewalExportRow` (declared here, re-exported).
- Produces: `buildEnquiriesWorkbook`, `buildRenewalsWorkbook`.

- [ ] **Step 1: Read the existing generator**

Read `packages/shared-ui/src/utils/excelGenerator.ts` to copy the `generateRegistrantsWorkbook` pattern (dynamic import of `write-excel-file/browser`, `Column<T>[]` schema with bold headers, `result.toFile(fileName)`).

- [ ] **Step 2: Add the two builders + row types**

```ts
export interface EnquiryExportRow {
  unit: string; agent: string; agentCode: string; partner: string;
  customer: string; phone: string; email: string; carPlate: string;
  insuranceExpiry: string; roadTax: string; vehicleStatus: string;
  enquiryStatus: string; received: string;
}
export async function buildEnquiriesWorkbook(rows: EnquiryExportRow[], meta?: { generatedAt?: string }) {
  const writeXlsxFile = (await import('write-excel-file/browser')).default;
  const columns = [
    { column: 'Unit', value: (r: EnquiryExportRow) => r.unit },
    { column: 'Agent', value: (r: EnquiryExportRow) => r.agent },
    { column: 'Agent Code', value: (r: EnquiryExportRow) => r.agentCode },
    { column: 'Partner', value: (r: EnquiryExportRow) => r.partner },
    { column: 'Customer', value: (r: EnquiryExportRow) => r.customer },
    { column: 'Phone', value: (r: EnquiryExportRow) => r.phone },
    { column: 'Email', value: (r: EnquiryExportRow) => r.email },
    { column: 'Car Plate', value: (r: EnquiryExportRow) => r.carPlate },
    { column: 'Insurance Expiry', value: (r: EnquiryExportRow) => r.insuranceExpiry },
    { column: 'Road Tax', value: (r: EnquiryExportRow) => r.roadTax },
    { column: 'Vehicle Status', value: (r: EnquiryExportRow) => r.vehicleStatus },
    { column: 'Enquiry Status', value: (r: EnquiryExportRow) => r.enquiryStatus },
    { column: 'Received', value: (r: EnquiryExportRow) => r.received },
  ];
  const schema = columns.map((c) => ({ ...c, fontWeight: undefined as undefined }));
  await writeXlsxFile(rows, { schema, headerStyle: { fontWeight: 'bold' }, fileName: `enquiries-${meta?.generatedAt ?? 'export'}.xlsx` });
}

export interface RenewalExportRow {
  partner: string; unit: string; agent: string; customer: string;
  carPlate: string; renewedAt: string; premium: number; giftValue: number;
}
export async function buildRenewalsWorkbook(rows: RenewalExportRow[], meta?: { generatedAt?: string }) {
  const writeXlsxFile = (await import('write-excel-file/browser')).default;
  const schema = [
    { column: 'Partner', value: (r: RenewalExportRow) => r.partner },
    { column: 'Unit', value: (r: RenewalExportRow) => r.unit },
    { column: 'Agent', value: (r: RenewalExportRow) => r.agent },
    { column: 'Customer', value: (r: RenewalExportRow) => r.customer },
    { column: 'Car Plate', value: (r: RenewalExportRow) => r.carPlate },
    { column: 'Renewed At', value: (r: RenewalExportRow) => r.renewedAt },
    { column: 'Renewal Premium (RM)', type: Number, value: (r: RenewalExportRow) => r.premium },
    { column: 'Gift / Settlement (RM)', type: Number, value: (r: RenewalExportRow) => r.giftValue },
  ];
  await writeXlsxFile(rows, { schema, headerStyle: { fontWeight: 'bold' }, fileName: `renewals-${meta?.generatedAt ?? 'export'}.xlsx` });
}
```

> Match the EXACT options the existing `generateRegistrantsWorkbook` passes (the `schema`/`headerStyle`/`fileName` keys and `Column` typing from `write-excel-file`). If the existing code uses a different schema shape, conform to it rather than the sketch above.

- [ ] **Step 3: Export from package index if needed**

Ensure `packages/shared-ui/src/index.ts` re-exports the new functions/types if the package exports utils there (follow how `generateRegistrantsWorkbook` is exported).

- [ ] **Step 4: Verify**

Run: `pnpm --filter @agent-system/shared-ui build` (or `pnpm -r typecheck`)
Expected: success.

- [ ] **Step 5: Commit**

```bash
git add packages/shared-ui/src/utils/excelGenerator.ts packages/shared-ui/src/index.ts
git commit -m "feat(shared-ui): xlsx builders for enquiries + renewals reports"
```

---

## Phase 1 — Admin portal

### Task 6: Admin sidebar — Events / Partnership groups

**Files:**
- Modify: `apps/admin-portal/src/components/Layout.tsx`

**Interfaces:**
- Consumes: existing lucide icons + pending-tier badge value.
- Produces: grouped nav rendered identically in desktop + mobile.

- [ ] **Step 1: Replace the flat `navigation` array with grouped data**

```ts
const navGroups: NavGroup[] = [
  { items: [{ name: 'Dashboard', href: '/', icon: LayoutDashboard }] },
  { label: 'Events', items: [
    { name: 'Events', href: '/campaigns', icon: Calendar },
    { name: 'Units', href: '/agents', icon: Users },
    { name: 'Tiers', href: '/tiers', icon: BadgeCheck },
    { name: 'Reports', href: '/reports', icon: BarChart3 },
    { name: 'Rewards', href: '/rewards', icon: Award },
    { name: 'PDF Export', href: '/pdf-export', icon: FileText },
    { name: 'Check-In', href: '/check-in', icon: ScanLine },
  ]},
  { label: 'Partnership', items: [
    { name: 'Partnerships', href: '/merchants', icon: Store },
    { name: 'Enquiries', href: '/enquiries', icon: Inbox },
    { name: 'Gifts', href: '/gifts', icon: Gift },
    { name: 'Settlements', href: '/settlements', icon: Landmark },
  ]},
  { items: [{ name: 'Settings', href: '/settings', icon: Settings }] },
];
```

- [ ] **Step 2: Extract a single `renderNav(groups)` helper**

Replace BOTH the desktop loop (~lines 70-93) and the mobile loop (~lines 130-154) with a call to one helper that maps groups → optional `<p className="px-3 pt-4 pb-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground">{group.label}</p>` then maps `group.items` with the existing active-state `Link` markup. Preserve the Units pending-tier badge: when `item.href === '/agents'` and `pendingCount > 0`, render the existing badge.

- [ ] **Step 3: Verify**

Run: `pnpm --filter admin-portal build`
Expected: success. Manual: load admin, confirm two labelled groups + Dashboard/Settings ungrouped, badge still on Units, both desktop and mobile drawers match.

- [ ] **Step 4: Commit**

```bash
git add apps/admin-portal/src/components/Layout.tsx
git commit -m "feat(admin): group sidebar into Events and Partnership sections"
```

---

### Task 7: Partnerships — remove pool + split

**Files:**
- Modify: `apps/admin-portal/src/pages/merchants/MerchantList.tsx`
- Modify: `apps/admin-portal/src/pages/merchants/MerchantDetail.tsx`
- Modify: `apps/admin-portal/src/hooks/useMerchants.ts`

**Interfaces:**
- Consumes: `useSystemSettings` (for the gift-rate display value) — read-only here.
- Produces: pool/split-free Partnership UI.

- [ ] **Step 1: `MerchantList.tsx` — drop columns + form fields**

Remove the `Pool (RM)` and `Merchant / Customer` `<th>`/`<td>` (lines ~210-213, 223, 225). Remove `gift_pool_amount` + `merchant_share_pct` from `formData` (lines 55-60), the two dialog inputs (lines 153-180), and the live helper line (176-179). Add a subtitle/info under the page title: `Customers receive a gold gift worth {rate}% of their car-insurance renewal.` where `rate` comes from `useSystemSettings().data?.customer_gift_rate_pct ?? 10`.

- [ ] **Step 2: `MerchantDetail.tsx` — drop pool/split display**

Remove lines ~274 and ~279 (Gift pool / merchant-customer split). Replace with one info line referencing the gift rate.

- [ ] **Step 3: `useMerchants.ts` — drop fields from payloads**

In `useCreateMerchant`/`useUpdateMerchant` remove `gift_pool_amount` and `merchant_share_pct` from the insert/update objects (lines ~38-78). Leave the columns alone in the DB (defaults handle them).

- [ ] **Step 4: Verify**

Run: `pnpm --filter admin-portal build` then `pnpm -r typecheck`
Expected: success. Manual: Partnerships list shows Name/Status/Actions only; create/edit dialog shows Name + Logo URL only.

- [ ] **Step 5: Commit**

```bash
git add apps/admin-portal/src/pages/merchants/MerchantList.tsx apps/admin-portal/src/pages/merchants/MerchantDetail.tsx apps/admin-portal/src/hooks/useMerchants.ts
git commit -m "feat(admin): remove gift pool + merchant/customer split from Partnerships"
```

---

### Task 8: Admin Settings — enquiry form editor + gift rate + admin email

**Files:**
- Modify: `apps/admin-portal/src/hooks/useSystemSettings.ts`
- Modify: the admin settings page (find via `/settings` route in `apps/admin-portal/src/router.tsx`; likely `apps/admin-portal/src/pages/Settings.tsx` or a `settings/` dir)

**Interfaces:**
- Consumes: extended `SystemSettings` type (Task 4).
- Produces: persisted `enquiry_form`, `admin_notification_email`, `customer_gift_rate_pct`.

- [ ] **Step 1: Locate the settings page**

Run: `grep -n "settings" apps/admin-portal/src/router.tsx` and open the resolved component. Read `useSystemSettings.ts` to see the current read/update shape.

- [ ] **Step 2: Extend the update hook**

Ensure `useUpdateSystemSettings` (or equivalent) accepts and writes `enquiry_form`, `admin_notification_email`, `customer_gift_rate_pct`. If it does a partial update by spreading the payload, no change beyond types is needed; otherwise add the fields explicitly.

- [ ] **Step 3: Add an "Enquiry Form & Gifts" settings card**

Add a section with controls bound to the loaded settings:
- `Customer Gift Rate (%)` — number input → `customer_gift_rate_pct`.
- `Admin Notification Email` — email input → `admin_notification_email`.
- `Header Logo URL`, `Header Title`, `Header Subtitle`, `Footer Text`, `DPO Contact` — text inputs → `enquiry_form.*`.
- `Terms & Conditions (PDPA) Body` — `<textarea>` → `enquiry_form.tnc_body`.
Save calls the update mutation. Follow the existing settings-card styling (mirror the card-template editor if present).

- [ ] **Step 4: Verify**

Run: `pnpm --filter admin-portal build`
Expected: success. Manual: edit a field, save, reload → persists.

- [ ] **Step 5: Commit**

```bash
git add apps/admin-portal/src/hooks/useSystemSettings.ts apps/admin-portal/src/pages/Settings.tsx
git commit -m "feat(admin): settings editor for enquiry-form header/footer/T&C, gift rate, admin email"
```

---

### Task 9: Admin Enquiries — join, multi-key sort, filters, xlsx download

**Files:**
- Modify: `apps/admin-portal/src/hooks/useEnquiries.ts`
- Modify: `apps/admin-portal/src/pages/enquiries/EnquiryList.tsx`
- Create: `apps/admin-portal/src/pages/enquiries/enquirySort.ts` (shared comparator + export-row mapper)

**Interfaces:**
- Consumes: `buildEnquiriesWorkbook`, `EnquiryExportRow` (Task 5).
- Produces: `compareEnquiries`, `toEnquiryExportRows` reused by agent portal? (No — agent has its own data shape; keep this admin-local but mirror the comparator logic in Task 13.)

- [ ] **Step 1: Extend the list query**

In `useEnquiries` (lines 46-63) change the `.select(...)` to:
```ts
.select(`id, customer_name, customer_phone, customer_email, status, created_at, merchant_id,
  agent:agents(id, name, agent_code, unit_name, parent_agent_id),
  merchant:merchants(id, name),
  vehicles:enquiry_vehicles(id, status, insurance_expiry_date, road_tax_renewal, car_plate)`)
```
Update `EnquiryListRow` type accordingly (add `agent`, vehicle fields).

- [ ] **Step 2: Write `enquirySort.ts`**

```ts
import type { EnquiryExportRow } from '@agent-system/shared-ui';

const statusRank = (s: string) => (s === 'open' ? 0 : 1);
const cmp = (a: string, b: string) => a.localeCompare(b);

export function earliestExpiry(v?: { insurance_expiry_date: string }[]) {
  if (!v?.length) return '9999-12-31';
  return v.map((x) => x.insurance_expiry_date).filter(Boolean).sort()[0] ?? '9999-12-31';
}

export function compareEnquiries(a: any, b: any): number {
  const unit = cmp(a.agent?.unit_name ?? '~', b.agent?.unit_name ?? '~'); if (unit) return unit;
  const agent = cmp(a.agent?.name ?? '~', b.agent?.name ?? '~'); if (agent) return agent;
  const partner = cmp(a.merchant?.name ?? '~', b.merchant?.name ?? '~'); if (partner) return partner;
  const st = statusRank(a.status) - statusRank(b.status); if (st) return st;
  const ex = cmp(earliestExpiry(a.vehicles), earliestExpiry(b.vehicles)); if (ex) return ex;
  return cmp(b.created_at, a.created_at); // received: newest first
}

const fmt = (d?: string) => (d ? new Date(d).toLocaleDateString('en-SG') : '');

export function toEnquiryExportRows(rows: any[]): EnquiryExportRow[] {
  const out: EnquiryExportRow[] = [];
  for (const e of rows) {
    const base = {
      unit: e.agent?.unit_name ?? '', agent: e.agent?.name ?? 'House',
      agentCode: e.agent?.agent_code ?? '', partner: e.merchant?.name ?? 'Unassigned',
      customer: e.customer_name ?? '', phone: e.customer_phone ?? '', email: e.customer_email ?? '',
      enquiryStatus: e.status, received: fmt(e.created_at),
    };
    const vs = e.vehicles ?? [];
    if (!vs.length) { out.push({ ...base, carPlate: '', insuranceExpiry: '', roadTax: '', vehicleStatus: '' }); continue; }
    for (const v of vs) out.push({ ...base, carPlate: v.car_plate ?? '', insuranceExpiry: fmt(v.insurance_expiry_date), roadTax: v.road_tax_renewal ? 'Yes' : 'No', vehicleStatus: v.status });
  }
  return out;
}
```
(`'~'` sentinel sorts nulls/House last alphabetically.)

- [ ] **Step 3: Wire sort + filters + download into `EnquiryList.tsx`**

- Apply `.slice().sort(compareEnquiries)` after the existing status filter in the `useMemo`.
- Add filter `Select`s for Unit / Agent / Partner (options derived from loaded rows via `Array.from(new Set(...))`), alongside the existing Status select.
- Add a "Download report" `Button` calling `buildEnquiriesWorkbook(toEnquiryExportRows(filteredSorted), { generatedAt: new Date().toISOString().slice(0,10) })`.
- Optionally surface Unit/Agent columns in the table now that the data is joined (Source cell can show `agent?.name` instead of just "Agent").

- [ ] **Step 4: Verify**

Run: `pnpm --filter admin-portal build`
Expected: success. Manual: list is grouped by Unit→Agent→Partner→Status→Expiry→Received; filters narrow rows; Download produces an `.xlsx` opening with the 13 columns.

- [ ] **Step 5: Commit**

```bash
git add apps/admin-portal/src/hooks/useEnquiries.ts apps/admin-portal/src/pages/enquiries/EnquiryList.tsx apps/admin-portal/src/pages/enquiries/enquirySort.ts
git commit -m "feat(admin): enquiries default multi-key sort, filters, and xlsx export"
```

---

### Task 10: Admin Enquiry detail — renewal premium + per-car partner

**Files:**
- Modify: `apps/admin-portal/src/hooks/useEnquiries.ts` (the `useConfirmVehicleRenewal` mutation)
- Modify: `apps/admin-portal/src/pages/enquiries/EnquiryDetail.tsx`

**Interfaces:**
- Consumes: new RPC `confirm_vehicle_renewal(uuid, numeric, uuid)` (Task 1); active merchants list.
- Produces: `useConfirmVehicleRenewal().mutateAsync({ vehicleId, premiumAmount, merchantId })`.

- [ ] **Step 1: Update the mutation**

```ts
export function useConfirmVehicleRenewal() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ vehicleId, premiumAmount, merchantId }:
      { vehicleId: string; premiumAmount: number; merchantId: string }) => {
      const { error } = await supabase.rpc('confirm_vehicle_renewal', {
        p_vehicle_id: vehicleId, p_premium_amount: premiumAmount, p_merchant_id: merchantId,
      });
      if (error) throw error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['enquiries'] }); qc.invalidateQueries({ queryKey: ['enquiry'] }); },
  });
}
```

- [ ] **Step 2: Build the renewal-confirm dialog**

Replace the current confirm action (lines ~347) with a dialog containing: a **Renewal premium (RM)** number input, a **Partner** `Select` (active merchants from a `useMerchants()`-style active list; default-select `enquiry.merchant_id` if set), and a live read-only line `Customer gift: RM {(premium * rate / 100).toFixed(2)} ({rate}%)` using `useSystemSettings().data?.customer_gift_rate_pct ?? 10`. Confirm button calls `mutateAsync({ vehicleId, premiumAmount: Number(premium), merchantId })`, disabled until premium ≥ 0 and a partner is chosen. Map RPC errors (`42501`, `P0001`, `P0002`) to friendly toasts.

- [ ] **Step 3: Remove stale split display**

The detail page lines ~171-177 ("Split: pool RM… X% merchant/Y% customer") must be removed/replaced with the gift-rate line.

- [ ] **Step 4: Verify**

Run: `pnpm --filter admin-portal build`
Expected: success. Manual (after staging apply in Task 16): confirming a renewal with premium=1000 + a partner mints gift=RM100 and a settlement=RM100.

- [ ] **Step 5: Commit**

```bash
git add apps/admin-portal/src/hooks/useEnquiries.ts apps/admin-portal/src/pages/enquiries/EnquiryDetail.tsx
git commit -m "feat(admin): renewal confirm captures premium + per-car partner, gift = rate%"
```

---

### Task 11: Admin Reports — Renewals tab

**Files:**
- Create: `apps/admin-portal/src/hooks/useRenewalReport.ts`
- Modify: `apps/admin-portal/src/pages/Reports.tsx`

**Interfaces:**
- Consumes: `buildRenewalsWorkbook`, `RenewalExportRow` (Task 5).
- Produces: `useRenewalReport(filters)`.

- [ ] **Step 1: Write the hook**

```ts
export interface RenewalFilters { merchantId?: string; unit?: string; agentId?: string; from?: string; to?: string; sortValueDesc?: boolean; }
export function useRenewalReport(filters: RenewalFilters) {
  return useQuery({
    queryKey: ['renewal-report', filters],
    queryFn: async () => {
      let q = supabase.from('enquiry_vehicles')
        .select(`id, car_plate, renewed_at, renewal_premium_amount, merchant_id,
          merchant:merchants(name),
          enquiry:enquiries(customer_name, agent:agents(name, agent_code, unit_name))`)
        .eq('status', 'renewed');
      if (filters.from) q = q.gte('renewed_at', filters.from);
      if (filters.to) q = q.lte('renewed_at', filters.to);
      if (filters.merchantId) q = q.eq('merchant_id', filters.merchantId);
      const { data, error } = await q;
      if (error) throw error;
      return data ?? [];
    },
  });
}
```
Unit/agent filtering and value-sort are applied client-side in the page (Supabase can't filter on the nested `agent.unit_name` easily).

- [ ] **Step 2: Add a "Renewals" tab to Reports.tsx**

Add a `TabsTrigger`/`TabsContent` "Renewals". Render a filter row (Partner select, Unit select, Agent select, date range reusing the existing control, a Value sort toggle), a table (Partner, Unit, Agent, Customer, Plate, Renewed At, Premium, Gift), and a Download button computing `giftValue = round(premium * rate/100, 2)` and calling `buildRenewalsWorkbook`.

- [ ] **Step 3: Verify**

Run: `pnpm --filter admin-portal build`
Expected: success. Manual: tab lists renewed cars, filters work, download produces `renewals-*.xlsx`.

- [ ] **Step 4: Commit**

```bash
git add apps/admin-portal/src/hooks/useRenewalReport.ts apps/admin-portal/src/pages/Reports.tsx
git commit -m "feat(admin): successful-renewals report tab with filters + xlsx"
```

---

## Phase 2 — Agent portal

### Task 12: Agent sidebar — Events / Partnership groups

**Files:**
- Modify: `apps/agent-portal/src/components/Layout.tsx`

- [ ] **Step 1: Convert the role arrays to grouped form**

For `agentAdminNavigation` produce:
```ts
const agentAdminGroups: NavGroup[] = [
  { items: [{ name: 'Dashboard', href: '/', icon: LayoutDashboard }] },
  { label: 'Events', items: [
    { name: 'Events', href: '/campaigns', icon: CalendarDays },
    { name: 'My Links', href: '/my-links', icon: Link2 },
    { name: 'Rewards', href: '/rewards', icon: Award },
    { name: 'My Agents', href: '/my-agents', icon: UserCog },
    { name: 'Team Report', href: '/team-report', icon: ClipboardList },
    { name: 'Partners', href: '/partners', icon: Users },
  ]},
  { label: 'Partnership', items: [
    { name: 'My Link', href: '/my-link', icon: QrCode },
    { name: 'My Enquiries', href: '/my-enquiries', icon: Inbox },
  ]},
  { items: [{ name: 'Account', href: '/account', icon: KeyRound }] },
];
```
For `agentNavigation` (plain agent) group the subset it contains the same way (Dashboard top; Events: Events/My Links/Rewards; Partnership: My Link/My Enquiries if present; Account bottom). Leave `partnerNavigation` flat.

- [ ] **Step 2: Update `SidebarContent` to render groups**

Change the single render to iterate `NavGroup[]` with the same labelled-header markup as admin Task 6, selecting the right group set by role.

- [ ] **Step 3: Verify**

Run: `pnpm --filter agent-portal build`
Expected: success. Manual: agent_admin sidebar shows Events + Partnership groups; plain agent + partner roles still render.

- [ ] **Step 4: Commit**

```bash
git add apps/agent-portal/src/components/Layout.tsx
git commit -m "feat(agent): group sidebar into Events and Partnership sections"
```

---

### Task 13: Agent My Enquiries — sort, download, Get Quote

**Files:**
- Modify: `apps/agent-portal/src/pages/MyEnquiries.tsx`
- Modify: `apps/agent-portal/src/hooks/useMyEnquiries.ts`
- Create: `apps/agent-portal/src/hooks/useRequestQuote.ts`

**Interfaces:**
- Consumes: `buildEnquiriesWorkbook`/`toEnquiryExportRows`-equivalent, edge function `send-quote-request` (Task 14).
- Produces: `useRequestQuote(agentId)`.

- [ ] **Step 1: Extend `useMyEnquiries` select**

Add `road_tax_renewal, quote_requested_at, car_plate` to the `vehicles:enquiry_vehicles(...)` select and `customer_email` to the header select so export + Get Quote have the data.

- [ ] **Step 2: Apply the same multi-key sort to the card list**

Reuse the comparator logic from Task 9 (copy a small `compareEnquiries` into a local `apps/agent-portal/src/pages/myEnquiriesSort.ts`, adapted to the agent row shape — agent has no `agent.unit_name` join, so the unit/agent keys collapse; sort by Partner → Status → earliest Expiry → Received). Sort the array before mapping to `EnquiryCard`s.

- [ ] **Step 3: Add a Download button**

Build `EnquiryExportRow[]` from the agent's enquiries (unit/agent come from the logged-in `agent` context; partner from `merchant`) and call `buildEnquiriesWorkbook`.

- [ ] **Step 4: Write `useRequestQuote`**

```ts
import { supabase } from '../lib/supabase';
import { useMutation, useQueryClient } from '@tanstack/react-query';
export function useRequestQuote(agentId?: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ enquiryId, vehicleId }: { enquiryId: string; vehicleId: string }) => {
      const { data, error } = await supabase.functions.invoke('send-quote-request', { body: { enquiry_id: enquiryId, vehicle_id: vehicleId } });
      if (error) throw error;
      return data;
    },
    onSuccess: () => { if (agentId) qc.invalidateQueries({ queryKey: ['my-enquiries', agentId] }); },
  });
}
```

- [ ] **Step 5: Add the Get Quote button to the per-car table**

In `EnquiryCard`'s vehicle table, add an action cell: when `v.status === 'submitted' && !v.quote_requested_at`, render a `Get Quote` button calling `requestQuote.mutateAsync({ enquiryId: enq.id, vehicleId: v.id })` with a loading state; when `v.quote_requested_at` is set, render muted `Quote requested {fmt}`. Toast on success/error.

- [ ] **Step 6: Verify**

Run: `pnpm --filter agent-portal build`
Expected: success. Manual (post-deploy): clicking Get Quote emails admin and flips the cell to "Quote requested".

- [ ] **Step 7: Commit**

```bash
git add apps/agent-portal/src/pages/MyEnquiries.tsx apps/agent-portal/src/hooks/useMyEnquiries.ts apps/agent-portal/src/hooks/useRequestQuote.ts apps/agent-portal/src/pages/myEnquiriesSort.ts
git commit -m "feat(agent): My Enquiries sort + xlsx download + per-car Get Quote"
```

---

## Phase 3 — Edge function

### Task 14: `send-quote-request` edge function

**Files:**
- Create: `supabase/functions/send-quote-request/index.ts`

**Interfaces:**
- Consumes: `enquiries`, `agents` (+parent), `enquiry_vehicles`, `system_settings.admin_notification_email`; Resend.
- Produces: an email to admin + stamps `enquiry_vehicles.quote_requested_at`.

- [ ] **Step 1: Read the template**

Read `supabase/functions/send-enquiry-notification/index.ts` in full and `supabase/functions/_shared/` (if it has CORS/Resend helpers, import them; else inline as the sibling does).

- [ ] **Step 2: Write the function**

Implement `Deno.serve` that:
- Handles OPTIONS (CORS).
- Parses `{ enquiry_id, vehicle_id }`.
- Auth: accept the caller's JWT (frontend `functions.invoke` forwards it) — create a Supabase client with the `Authorization` header and verify `auth.getUser()`; reject if neither a valid user nor the service-role bearer.
- Create a service-role client to read data (bypass RLS): load enquiry (`customer_name, customer_nric, customer_phone, customer_email, agent:agents(name, agent_code, unit_name, parent_agent_id)`) and the vehicle (`car_plate, insurance_expiry_date, road_tax_renewal`). If `parent_agent_id`, fetch parent agent `name` as "Unit Admin".
- Read `admin_notification_email` from `system_settings`. If empty/unset → return `200 { skipped: true, reason: 'no admin email configured' }` (graceful, matches `send-enquiry-notification` skip pattern). If `RESEND_API_KEY` unset → same graceful skip.
- Build inline-HTML (reuse `esc()` from the template) with sections: **Agent & Unit** (name, code, unit_name, unit admin), **Customer** (name, phone, email, NRIC), **Vehicle** (plate, expiry, Road Tax Yes/No), and "The agent has requested a quote."
- `sendResendEmail({ from: 'RACC Partnership <enquiries@raccagency.com>', to: adminEmail, subject: 'Quote requested — {customer} / {plate}', html })`.
- After a successful send, `update enquiry_vehicles set quote_requested_at = now() where id = vehicle_id` (service-role client).
- Return JSON `{ ok: true }`.

- [ ] **Step 3: Verify it parses**

Run: `deno check supabase/functions/send-quote-request/index.ts` if `deno` is available; otherwise visual review against the sibling (no bare imports beyond what siblings use).

- [ ] **Step 4: Commit**

```bash
git add supabase/functions/send-quote-request/index.ts
git commit -m "feat(functions): send-quote-request emails admin with agent/unit/customer/vehicle"
```

---

## Phase 4 — Public enquiry form

### Task 15: Enquiry form — mandatory fields, road tax, T&C, header/footer

**Files:**
- Modify: `apps/public-pages/src/pages/Enquiry.tsx`
- Create: `apps/public-pages/src/hooks/useEnquiryFormSettings.ts`

**Interfaces:**
- Consumes: `EnquiryFormSettings` (Task 4), anon read of `system_settings.enquiry_form`.
- Produces: `useEnquiryFormSettings()`.

- [ ] **Step 1: Write the public settings hook**

```ts
import { supabase } from '../lib/supabase';
import { useQuery } from '@tanstack/react-query';
import { DEFAULT_ENQUIRY_FORM, type EnquiryFormSettings } from '@agent-system/shared-types';
export function useEnquiryFormSettings() {
  return useQuery({
    queryKey: ['enquiry-form-settings'],
    queryFn: async (): Promise<EnquiryFormSettings> => {
      const { data, error } = await supabase.from('system_settings').select('enquiry_form').limit(1).single();
      if (error) throw error;
      return { ...DEFAULT_ENQUIRY_FORM, ...(data?.enquiry_form ?? {}) };
    },
  });
}
```

- [ ] **Step 2: Make all fields mandatory in the zod schema**

```ts
const enquirySchema = z.object({
  customer_name: z.string().min(2, 'Name must be at least 2 characters'),
  customer_nric: z.string().min(6, 'NRIC / MyKad is required'),
  customer_phone: z.string().min(8, 'Phone number must be at least 8 characters'),
  customer_email: z.string().email('A valid email is required'),           // now REQUIRED
  acceptedTerms: z.literal(true, { errorMap: () => ({ message: 'You must accept the Terms & Conditions' }) }),
  vehicles: z.array(z.object({
    car_plate: z.string().min(1, 'Car plate is required'),
    insurance_expiry_date: z.string().min(1, 'Expiry date is required'),
    road_tax_renewal: z.enum(['yes', 'no'], { errorMap: () => ({ message: 'Select Yes or No for Road Tax' }) }),
  })).min(1, 'Add at least one vehicle'),
});
```
Set RHF defaults: `customer_email: ''`, `acceptedTerms: false`, each vehicle `road_tax_renewal: undefined`.

- [ ] **Step 3: Require ≥1 Covernote/Geran file per vehicle (outside RHF)**

Add a `fileErrors` state. In `onSubmit`, before upload, validate every vehicle has ≥1 file in `vehicleFiles[vField.id]`; if not, set an inline error under that vehicle and abort. Also reflect in the submit gate: `disabled = isSubmitting || !form.formState.isValid || !allVehiclesHaveFiles`. Relabel the uploader "Covernote / Geran (required)".

- [ ] **Step 4: Render T&C block + checkbox**

Import `Checkbox`, `ScrollArea` from `@agent-system/shared-ui`. Render `settings.tnc_body` (with `dpo_contact` substituted into the DPO line) inside a bordered scroll area, then a `Checkbox` bound to RHF `acceptedTerms`. Mirror `apps/public-pages/src/pages/Register.tsx:393-427`.

- [ ] **Step 5: Add Road Tax Yes/No per vehicle**

In each vehicle block add a required radio/segmented control bound to `vehicles.${index}.road_tax_renewal` (`'yes'`/`'no'`). Pass to submit: in `onSubmit`'s `p_vehicles` map, add `road_tax_renewal: v.road_tax_renewal === 'yes'`.

- [ ] **Step 6: Customizable header/footer**

Call `useEnquiryFormSettings()`. Header: logo = `settings.header_logo_url || merchant_logo_url || <Logo/>`; title = branch merchant name when present else `settings.header_title`; subtitle = `settings.header_subtitle` (branch/agent overlay copy still applies as today). Add a footer element rendering `settings.footer_text`. While loading, fall back to current hardcoded copy.

- [ ] **Step 7: Verify**

Run: `pnpm --filter public-pages build`
Expected: success. Manual (post-deploy): submit blocked until email valid, every car has a Road Tax choice + ≥1 document, and T&C accepted; header/footer reflect Settings.

- [ ] **Step 8: Commit**

```bash
git add apps/public-pages/src/pages/Enquiry.tsx apps/public-pages/src/hooks/useEnquiryFormSettings.ts
git commit -m "feat(public): mandatory fields + required covernote/geran + road tax + PDPA T&C + custom header/footer"
```

---

## Phase 5 — Deploy + verify + deliverable

### Task 16: Apply migrations + deploy function to staging

**Files:** none (operational).

- [ ] **Step 1: Apply migrations in order to staging via Supabase MCP**

Using project `lyjdlietzmmejrxjvwgp`, `apply_migration` for `20260630000001`, then `...0002`, then `...0003` (in that order). After each, no error.

- [ ] **Step 2: Deploy the edge function**

`deploy_edge_function` `send-quote-request` to staging. Confirm it appears in `list_edge_functions`.

- [ ] **Step 3: Smoke-check schema**

`execute_sql` on staging: `select customer_gift_rate_pct, admin_notification_email, enquiry_form->>'header_title' from system_settings;` and `select column_name from information_schema.columns where table_name='enquiry_vehicles' and column_name in ('renewal_premium_amount','merchant_id','road_tax_renewal','quote_requested_at');`
Expected: rate=10, the four columns present.

- [ ] **Step 4: Set the admin notification email on staging (optional)**

If the user provides an address: `update system_settings set admin_notification_email = '<addr>';` so Get Quote emails actually send on staging.

### Task 17: Full typecheck + build

- [ ] **Step 1: Typecheck the monorepo**

Run: `pnpm -r typecheck`
Expected: clean.

- [ ] **Step 2: Build all apps**

Run: `pnpm build`
Expected: all three apps build.

- [ ] **Step 3: Commit any fixups**

```bash
git add -A && git commit -m "chore: typecheck/build fixups for partnership feedback changes" || echo "nothing to fix"
```

### Task 18: Excel status sheet deliverable

**Files:**
- Create: `docs/feedback/2026-06-30-feedback-changes-status.xlsx`
- Create: `scripts/build-feedback-status-xlsx.mjs` (generator, committed for reproducibility)

- [ ] **Step 1: Write a Node generator using the existing `write-excel-file` dep**

Columns: `#`, `Page`, `Feedback Item`, `Area`, `What Changed`, `Files / Migrations`, `Status`. One row per feedback item (P1, P2, E1, E2, Q1, Q2, O1, O2a-d, sidebar). Run with `node scripts/build-feedback-status-xlsx.mjs` to emit the `.xlsx`.

- [ ] **Step 2: Generate + verify the file exists and is non-empty**

Run: `node scripts/build-feedback-status-xlsx.mjs && python3 -c "import os;print(os.path.getsize('docs/feedback/2026-06-30-feedback-changes-status.xlsx'))"`
Expected: a byte count > 0.

- [ ] **Step 3: Commit**

```bash
git add docs/feedback/2026-06-30-feedback-changes-status.xlsx scripts/build-feedback-status-xlsx.mjs
git commit -m "docs(feedback): Excel status sheet for partnership feedback changes"
```

---

## Self-Review

**Spec coverage:**
- Sidebar Events/Partnership (both portals) → Tasks 6, 12. ✓
- Remove pool + split, standard 10% gift = merchant payable → Tasks 1, 4, 7, 10. ✓
- Per-car partner confirmed at renewal → Tasks 1, 10. ✓
- Enquiries default sort + filter + download (admin) → Task 9; (agent) → Task 13. ✓
- Get Quote → email admin w/ agent+unit+customer+vehicle → Tasks 13, 14. ✓
- Successful-renewals report (Partnership/Unit/Agent/Timeline/Value + download) → Task 11. ✓
- Enquiry form: all mandatory incl. covernote/geran → Task 15; T&C (PDPA page 6) → Tasks 2, 15; customizable header/footer → Tasks 2, 8, 15; road tax → Tasks 1, 3, 15. ✓
- Admin Settings editor → Task 8. ✓
- Staging deploy → Task 16; verify → Task 17; Excel deliverable → Task 18. ✓

**Placeholder scan:** SQL inserts in Task 1 flagged to be reconciled with the real ledger columns during Step 1 (not a placeholder — an explicit reconciliation step against a named source). No "TBD/TODO".

**Type consistency:** `confirm_vehicle_renewal(uuid, numeric, uuid)` ↔ `useConfirmVehicleRenewal({ vehicleId, premiumAmount, merchantId })` (Tasks 1, 10) ✓. `EnquiryExportRow`/`RenewalExportRow` defined in Task 5, consumed in Tasks 9, 11, 13 ✓. `EnquiryFormSettings` defined Task 4, consumed Tasks 8, 15 ✓. `useRequestQuote({ enquiryId, vehicleId })` ↔ function body `{ enquiry_id, vehicle_id }` (Tasks 13, 14) ✓. `NavGroup`/`NavItem` (Tasks 6, 12) ✓.

## Execution

Subagent-driven (recommended): fresh subagent per task with review between, on `feat/merchant-partnership`. Phase 0 tasks (1-5) gate everything else; Tasks 6-11 (admin) and 12-13 (agent) can parallelize after Phase 0; Task 14 before agent Get Quote can be exercised; Task 15 after Tasks 2/4; Tasks 16-18 last and sequential.
