# Partnership Feedback Changes — Design Spec

**Date:** 2026-06-30
**Branch:** `feat/merchant-partnership`
**Source:** `Feedback Changes.pdf` (6 pages, text + screenshots) + sidebar regrouping request.
**Deploy target:** Staging Supabase `lyjdlietzmmejrxjvwgp` only; Render frontends auto-deploy on push.

This spec covers one cohesive round of feedback on the merchant-partnership (car-insurance gold-gift) subsystem plus a sidebar reorganisation across the admin and agent portals.

---

## Decisions (locked with user)

1. **Gift model:** Remove the per-merchant gift *pool* and *merchant/customer split*. Customer gold-gift value = **`gift_rate_pct` × renewal premium** (default rate 10%, editable as one global setting). The merchant **settlement (payable RACC owes the partner) equals that same gift value**. Renewal premium is captured by admin at renewal confirmation.
2. **Partner assignment:** Becomes **per-car, confirmed at renewal**. The enquiry-level "Assign to Partnership" dropdown stays as a *suggestion* that pre-fills; admin confirms the binding partner per car when confirming a successful renewal.
3. **Header/Footer + T&C:** **Admin-editable**, stored in `system_settings` (anon-readable), with an editor under admin Settings. Public enquiry form reads it live.
4. **Deploy:** **Staging only.** Migrations applied + edge functions deployed to staging Supabase; prod untouched.

### Defaults (stated, vetoable — none vetoed)
- Agent "Partners" (recruitment) stays under the **Events** group, not Partnership.
- Dashboard sits ungrouped at top of each sidebar; Settings/Account ungrouped at bottom.
- "Get Quote" admin recipient = a new editable **Admin Notification Email** in Settings; function skips gracefully if unset.
- Successful-renewals report = a new **"Renewals" tab** in the admin Reports page (not a separate route).
- Enquiry form will **not** add an insurance-product selector (deliberately optional in v2).
- Road Tax = per-car required **"Road Tax Renewal? Yes/No"** choice.
- All in-app report downloads use `.xlsx` via the existing `packages/shared-ui/src/utils/excelGenerator.ts`.

---

## Background — current state (verified by code exploration)

- **"Partnerships" UI = `merchants` table.** Pool = `merchants.gift_pool_amount`; split = `merchants.merchant_share_pct` (customer share derived as `100 - pct`). Admin pages: `apps/admin-portal/src/pages/merchants/MerchantList.tsx` (list + create/edit dialog), `MerchantDetail.tsx`. Hooks: `apps/admin-portal/src/hooks/useMerchants.ts`. Types: `packages/shared-types/src/merchant.ts`.
- **Money flow** materialises at renewal in `confirm_vehicle_renewal`. The **active** definition is in `supabase/migrations/20260629000010_enquiry_v2.sql:95-123` (reads pool/share from `enquiries.merchant_id`; mints `gifts` (customer) + `merchant_settlements` (merchant); no agent commission). An older v1 in `20260628000010_merchant_pipeline_rpcs.sql:91-199` is overridden.
- **"Units" = agents.** No separate units table. Unit name = `agents.unit_name`; a unit-admin is an agent with `parent_agent_id IS NULL`. Enquiry → agent via `enquiries.agent_id`; partner via `enquiries.merchant_id`; expiry on child `enquiry_vehicles.insurance_expiry_date`; received = `enquiries.created_at`.
- **Enquiries:** admin list `apps/admin-portal/src/pages/enquiries/EnquiryList.tsx` (hook `useEnquiries`, ordered `created_at DESC`, selects only `merchant` + minimal vehicles — **no agent/unit fields**). Detail `EnquiryDetail.tsx` (Quote/Renew/Lost). Agent list `apps/agent-portal/src/pages/MyEnquiries.tsx` (`EnquiryCard`, `useMyEnquiries`, `useAssignEnquiryMerchant`). Status enums `packages/shared-types/src/enums.ts` (`EnquiryStatus` open/closed; `VehicleStatus` submitted/quoted/renewed/lost).
- **Public enquiry form:** `apps/public-pages/src/pages/Enquiry.tsx` (single file: fields, zod schema lines 29-46, per-vehicle multi-file uploader, `onSubmit` uploads then calls RPC `submit_enquiry`). Email optional; uploads optional + outside zod; no T&C; no road tax; header/footer hardcoded (only merchant logo varies via `get_enquiry_context`).
- **Attachments:** private bucket `enquiry-attachments` + table `enquiry_attachments` (`supabase/migrations/20260629000030_enquiry_attachments.sql`). Written only by `submit_enquiry` (SECURITY DEFINER).
- **system_settings:** single-row table (`supabase/migrations/20260326000002_system_settings.sql`), columns `company_branding JSONB`, `card_template JSONB`, `updated_at`. **Anon can read** (RLS `USING (true)`). Types in `packages/shared-types/src/database.ts`. Admin read/update hook `apps/admin-portal/src/hooks/useSystemSettings.ts`. Public-pages does **not** read it yet.
- **Reports:** admin `apps/admin-portal/src/pages/Reports.tsx` (Tabs: Overview / Attendees / Team Performance; CSV helper `downloadCsv` lines 64-77). No renewals report exists. Export utils: `packages/shared-ui/src/utils/excelGenerator.ts` (`write-excel-file`), `pdfGenerator.ts`.
- **Email edge functions:** in `supabase/functions/`; a `_shared/` dir exists. Best template = `send-enquiry-notification/index.ts` (loads enquiry+agent+vehicles, builds inline-HTML, `sendResendEmail` via Resend, `from` hardcoded `@raccagency.com`). Frontend-invoke pattern: `apps/admin-portal/src/hooks/useEmailReminders.ts` (`supabase.functions.invoke`). No admin-notification email + no `ADMIN_EMAIL` exist yet.
- **Sidebars:** admin `apps/admin-portal/src/components/Layout.tsx` (flat `navigation` array lines 25-39, rendered twice: desktop loop ~70-93, mobile loop ~130-154; pending-tier badge special-cased on Units). Agent `apps/agent-portal/src/components/Layout.tsx` (three role arrays: `agentAdminNavigation` 8-19, `agentNavigation` 21-29, `partnerNavigation` 31-35; single `SidebarContent` render). Neither has any grouping concept.
- Latest migration prefix: `20260629000030`. New migrations use `20260630000001+`.

---

## Design by feedback item

### A. Sidebar regrouping (Events / Partnership) — both portals

Introduce a grouped nav model: an array of `{ label?: string; items: NavItem[] }`. A `label` of `undefined` renders items with no section header (top/bottom). Render a small uppercase muted section header above each labelled group. Preserve the existing active-state styling and the Units pending-tier badge.

**Admin** (`apps/admin-portal/src/components/Layout.tsx`) — refactor the two render loops to iterate groups (extract a single `renderNav(groups)` helper to avoid divergence):
- *(ungrouped, top)* Dashboard → `/`
- **EVENTS:** Events `/campaigns`, Units `/agents`, Tiers `/tiers`, Reports `/reports`, Rewards `/rewards`, PDF Export `/pdf-export`, Check-In `/check-in`
- **PARTNERSHIP:** Partnerships `/merchants`, Enquiries `/enquiries`, Gifts `/gifts`, Settlements `/settlements`
- *(ungrouped, bottom)* Settings `/settings`

**Agent** (`apps/agent-portal/src/components/Layout.tsx`) — group `agentAdminNavigation`; apply the same grouping shape to `agentNavigation` (subset) and leave `partnerNavigation` flat (only 3 cross-cutting items):
- *(top)* Dashboard `/`
- **EVENTS:** Events `/campaigns`, My Links `/my-links`, Rewards `/rewards`, My Agents `/my-agents`, Team Report `/team-report`, Partners `/partners`
- **PARTNERSHIP:** My Link `/my-link` (enquiry link), My Enquiries `/my-enquiries`
- *(bottom)* Account `/account`

No route changes; nav only.

### B. Partnerships — remove pool, standard 10% gift (P1 + P2)

**DB migration `20260630000001_partnership_gift_rate.sql`:**
- `ALTER TABLE enquiry_vehicles ADD COLUMN renewal_premium_amount NUMERIC(12,2)` — the total car-insurance renewal value, set at confirmation.
- `ALTER TABLE enquiry_vehicles ADD COLUMN merchant_id UUID REFERENCES merchants(id) ON DELETE SET NULL` — per-car partner (item C). Index it.
- `ALTER TABLE enquiry_vehicles ADD COLUMN road_tax_renewal BOOLEAN NOT NULL DEFAULT false` — item G.
- `ALTER TABLE enquiry_vehicles ADD COLUMN quote_requested_at TIMESTAMPTZ` — item E.
- `ALTER TABLE system_settings ADD COLUMN customer_gift_rate_pct NUMERIC(5,2) NOT NULL DEFAULT 10 CHECK (customer_gift_rate_pct >= 0 AND customer_gift_rate_pct <= 100)`.
- `merchants.gift_pool_amount` / `merchant_share_pct` are **retained as dead columns** (default 0; CHECK kept) — no drop, to avoid breaking the overridden v1 RPC and historical rows. They simply stop being read/written by app code.

**RPC rewrite `confirm_vehicle_renewal`** (new definition supersedes the v2 one; same migration):
```
confirm_vehicle_renewal(p_vehicle_id uuid, p_premium_amount numeric, p_merchant_id uuid)
```
- Admin-only (mirror existing guard).
- Validate vehicle is `submitted`|`quoted`; `p_premium_amount >= 0`; `p_merchant_id` is an active merchant.
- `v_rate := (SELECT customer_gift_rate_pct FROM system_settings LIMIT 1)`.
- `v_gift := round(p_premium_amount * v_rate / 100, 2)`.
- Set vehicle `status='renewed'`, `renewed_at`, `renewed_by`, `renewal_premium_amount=p_premium_amount`, `merchant_id=p_merchant_id`.
- Also write `enquiries.merchant_id = p_merchant_id` if still null (keeps existing list joins working) — but the per-car `merchant_id` is authoritative for ledgers.
- Insert `gifts` row `value_amount = v_gift` (customer), linked to vehicle + merchant.
- Insert `merchant_settlements` row `amount = v_gift` (merchant payable), linked to vehicle + merchant.
- Close the parent enquiry when all its vehicles are terminal (preserve existing behaviour).
- No agent commission (matches current v2 behaviour).

**UI:**
- `MerchantList.tsx`: remove the `Pool (RM)` and `Merchant / Customer` table columns; remove `gift_pool_amount` + `merchant_share_pct` from `formData`, dialog inputs, and the live helper line. Partnership form = Name + Logo URL (+ status via existing approve flow). Add a static subtitle/info: "Customers receive a gold gift worth {rate}% of their car-insurance renewal."
- `MerchantDetail.tsx`: remove pool/split display lines; show the gift-rate info instead.
- `useMerchants.ts`: drop `gift_pool_amount`/`merchant_share_pct` from create/update payloads.
- `packages/shared-types/src/merchant.ts`: mark those two fields optional/deprecated on `Merchant`; the create/update input types drop them.
- A small **Gift Rate** field is exposed in admin Settings (see item F's settings editor) writing `system_settings.customer_gift_rate_pct`.

### C. Per-car partner confirmation (Q1)

- `enquiry_vehicles.merchant_id` added (item B).
- Admin `EnquiryDetail.tsx` renewal-confirm dialog gains: a **Renewal premium (RM)** numeric input and a **Partner** `Select` (active merchants), pre-filled from `enquiry.merchant_id` (the enquiry-level suggestion) when present. Shows live computed gift = `premium × rate%`. Confirm calls the new `confirm_vehicle_renewal(vehicle, premium, merchant)`.
- `useConfirmVehicleRenewal` hook signature updated to pass `p_premium_amount`, `p_merchant_id`.
- Agent enquiry-level "Assign to Partnership" remains as a suggestion (unchanged behaviour, still writes `enquiries.merchant_id` via `assign_enquiry_merchant`).

### D. Enquiries — default sort + download report (E1, E2; admin + agent)

**Admin (`EnquiryList.tsx` + `useEnquiries`):**
- Extend the list select to join `agent:agents(id, name, agent_code, unit_name, parent_agent_id)` and vehicles `(id, status, insurance_expiry_date, merchant:merchants(name))`, plus `merchant:merchants(id,name)`.
- Default **multi-key sort** in a `useMemo`: Unit (`agent.unit_name`) → Agent (`agent.name`) → Partner (`merchant.name`) → Status (open before closed) → earliest vehicle `insurance_expiry_date` → Received (`created_at` desc). Nulls (House/unassigned) sort last within each key.
- Add filter dropdowns: **Unit**, **Agent**, **Partner**, **Status** (existing Status dropdown retained; new ones derive options from the loaded rows). Filters are additive; sort stays applied.
- **Download report** button → `.xlsx` via `excelGenerator` pattern. One row per car. Columns: Unit, Agent, Agent Code, Partner, Customer, Phone, Email, Car Plate, Insurance Expiry, Road Tax, Vehicle Status, Enquiry Status, Received. Filename `enquiries-YYYY-MM-DD.xlsx`. Honors current filters + sort.

**Agent (`MyEnquiries.tsx` + `useMyEnquiries`):**
- Apply the same multi-key sort to the card list (the agent's own data; for an `agent_admin` it already spans their unit where applicable).
- Add a **Download** button producing the same `.xlsx` (scoped to the rows shown). Reuse a shared builder.

**Shared export builder:** add `buildEnquiriesWorkbook(rows, meta)` to `packages/shared-ui/src/utils/excelGenerator.ts` (mirrors `generateRegistrantsWorkbook`) so both portals reuse it.

### E. "Get Quote" flow (Q2)

- Per-car **Get Quote** button in agent `MyEnquiries.tsx` `EnquiryCard` vehicle table (visible when vehicle `status='submitted'` and no `quote_requested_at`). After request, show a muted "Quote requested {time}" and disable the button.
- New hook `useRequestQuote(agentId)` → `supabase.functions.invoke('send-quote-request', { body: { enquiry_id, vehicle_id } })`; on success invalidate `['my-enquiries', agentId]`.
- New RPC or direct stamp: the function (service-role) sets `enquiry_vehicles.quote_requested_at = now()` after sending. (Edge function does the stamp so it's atomic with send; alternatively a tiny `request_quote(p_vehicle_id)` RPC stamps + the function only emails — chosen: function stamps to keep one round-trip.)
- **New edge function `supabase/functions/send-quote-request/index.ts`** modeled on `send-enquiry-notification`:
  - Auth: accept either a valid user JWT (agent invoking) — verify via anon client `auth.getUser` — or service-role bearer. (Frontend invoke passes the user session automatically.)
  - Load enquiry + `agent:agents(name, agent_code, unit_name, parent_agent_id)` + the specific vehicle.
  - Resolve **unit info**: agent's `unit_name`; if `parent_agent_id` set, also fetch parent (unit admin) name.
  - Recipient: `system_settings.admin_notification_email`; if empty → graceful skip (200 with `{skipped:true}`), matching existing pattern. `from` = `RACC Partnership <enquiries@raccagency.com>` (reuse).
  - Email HTML includes: **Agent & Unit** (agent name, code, unit name, unit admin), **Customer** (name, phone, email, NRIC), **Vehicle** (plate, insurance expiry, road tax Y/N), and a note "Agent has requested a quote."
  - Stamp `quote_requested_at`, return JSON.
  - Reuse `_shared` CORS/helpers if present; otherwise inline like siblings.

### F. Admin Settings editor (header/footer + T&C + gift rate + admin email)

**DB migration `20260630000002_enquiry_form_settings.sql`:**
- `ALTER TABLE system_settings ADD COLUMN enquiry_form JSONB NOT NULL DEFAULT '{...}'` with shape:
  ```json
  {
    "header_logo_url": "",        // optional; falls back to shared Logo
    "header_title": "Car Insurance Enquiry — Gold Gift on Renewal",
    "header_subtitle": "Submit your details and our team will be in touch.",
    "footer_text": "© RACC Agency. ...",
    "tnc_body": "<full PDPA text from page 6>",
    "dpo_contact": "dpo@raccagency.com"
  }
  ```
  Seeded with the page-6 PDPA clause (DPO placeholder filled with `dpo_contact`).
- `ALTER TABLE system_settings ADD COLUMN admin_notification_email TEXT` (nullable) — item E recipient.
- `customer_gift_rate_pct` already added in migration B.
- (RLS unchanged — anon read already allowed, so public form can read `enquiry_form`.)

**Types:** extend `packages/shared-types/src/database.ts` — add `EnquiryFormSettings` interface, `DEFAULT_ENQUIRY_FORM`, and add `enquiry_form`, `admin_notification_email`, `customer_gift_rate_pct` to `SystemSettings`.

**Admin Settings UI** (`apps/admin-portal/src/pages/Settings.tsx` or the existing settings page): add a card/section "Enquiry Form" with inputs for header logo URL, header title, subtitle, footer text, a textarea for T&C body, DPO contact, plus "Customer Gift Rate (%)" and "Admin Notification Email". Save via `useSystemSettings` update (extend to write the new columns).

### G. Public enquiry form changes (O2)

`apps/public-pages/src/pages/Enquiry.tsx`:
- **All fields mandatory:** `customer_email` → required valid email in `enquirySchema`. Per-vehicle **Covernote/Geran upload required** — add a submit gate: each vehicle must have ≥1 file in `vehicleFiles`; surface an inline error and keep the submit button disabled until satisfied (files live outside RHF, so add explicit validation state). Relabel the uploader "Covernote / Geran (required)".
- **Road Tax:** per-vehicle required choice "Road Tax Renewal?" Yes/No (radio group, default unset → must pick). Add `road_tax_renewal: boolean` to per-vehicle schema; pass through to `submit_enquiry`.
- **T&C:** scrollable block rendering `enquiry_form.tnc_body` + required "I accept" `Checkbox` (reuse `Register.tsx:44-45,393-427` pattern with `ScrollArea` + `Checkbox` from shared-ui). zod `.refine` requires acceptance.
- **Customizable Header & Footer:** new public hook `useEnquiryFormSettings()` (anon select `enquiry_form` from `system_settings`). Header renders `header_logo_url || merchant logo || shared Logo`, `header_title`, `header_subtitle`; per-link merchant branding still overlays for branch QR links (merchant name/logo take precedence when present). Footer renders `footer_text`. Loading fallback = current hardcoded copy.

**Backend `submit_enquiry` update (migration `20260630000003_submit_enquiry_roadtax.sql`):** redefine `submit_enquiry` to accept `road_tax_renewal` inside each `p_vehicles` element and insert it into `enquiry_vehicles`. Keep all prior behaviour (dual-link resolve, attachments loop, `notify_agent_enquiry`). The form continues to require ≥1 attachment per vehicle on the **client**; the RPC remains tolerant (server-side enforcement optional — client-gated for now, noted in spec).

### H. Successful-renewals report (O1)

- New **"Renewals" tab** in `apps/admin-portal/src/pages/Reports.tsx`.
- New hook `useRenewalReport(filters)` querying renewed vehicles: `enquiry_vehicles` where `status='renewed'`, join `enquiry:enquiries(customer_name, customer_phone, created_at, agent:agents(name, agent_code, unit_name))`, `merchant:merchants(name)`, and the minted `gifts.value_amount` / `merchant_settlements.amount` (or recompute from `renewal_premium_amount × rate`). Fields: Partnership, Unit, Agent, Customer, Car Plate, Renewed At (Timeline), Renewal Premium (Value), Gift Value, Settlement Value.
- Filters/sort: Partnership, Unit, Agent, Timeline (date range over `renewed_at`), Value (sort asc/desc). Reuse the report's existing date-range control where possible.
- **Download** `.xlsx` (`buildRenewalsWorkbook` in `excelGenerator.ts`).

### I. Deliverable — Excel status sheet

At the end, generate `docs/feedback/2026-06-30-feedback-changes-status.xlsx` (and hand the path to the user) with columns: #, Page, Feedback Item, Area, What Changed, Files/Migrations, Status. Generated via a Node/python script using a spreadsheet lib; committed to the repo.

---

## Migrations summary (new, staging-applied in order)

1. `20260630000001_partnership_gift_rate.sql` — vehicle columns (premium, merchant_id, road_tax_renewal, quote_requested_at), `system_settings.customer_gift_rate_pct`, rewrite `confirm_vehicle_renewal(uuid, numeric, uuid)`.
2. `20260630000002_enquiry_form_settings.sql` — `system_settings.enquiry_form` JSONB (seeded PDPA), `admin_notification_email`.
3. `20260630000003_submit_enquiry_roadtax.sql` — redefine `submit_enquiry` to persist `road_tax_renewal`.

## Edge functions

- **New:** `send-quote-request` (Resend email to admin; stamps `quote_requested_at`). Deploy to staging.

## Out of scope

- Dropping dead `merchants` pool/share columns (kept for safety).
- Adding an insurance-product selector to the public form.
- Server-side hard enforcement of mandatory attachments (client-gated; RPC stays tolerant).
- Prod deployment (staging only).
- Agent commission on renewal (remains absent, matching current behaviour).

## Verification

- `pnpm -r typecheck` and `pnpm build` (no test runner / eslint in this repo — per project memory).
- Manual staging walkthrough: create partnership (no pool fields), submit public enquiry (all-mandatory + road tax + T&C + required upload), agent Get Quote → admin email, admin confirm renewal with premium+partner → gift/settlement = 10%, enquiries sort/filter/download, renewals report download, both sidebars grouped.

## Risks / notes

- `confirm_vehicle_renewal` is redefined (3rd definition). Must match the call sites' new signature exactly; old 2-arg/0-extra callers must be updated in the same change set (`useConfirmVehicleRenewal`, `EnquiryDetail.tsx`).
- `shared-types` `Enquiry`/`EnquiryVehicle` are already stale vs migrations; update them to include `merchant_id`, `renewal_premium_amount`, `road_tax_renewal`, `quote_requested_at`.
- Keep all commits on `feat/merchant-partnership` (repo has concurrent-workflow branch thrash — branch-guard every commit).
- `write-excel-file` is already a dependency (used by `excelGenerator.ts`); do not add new deps (zod single-version constraint — avoid `pnpm add`).
