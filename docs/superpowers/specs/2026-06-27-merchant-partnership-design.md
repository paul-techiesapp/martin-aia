# Merchant Partnership & Gold-Gift Subsystem — Design Spec

**Date:** 2026-06-27
**Status:** Approved design (pre-implementation-plan)
**Author:** brainstorming session (Claude + Paul)

## 1. Summary

A second product riding on the existing RACC "Agent Onboarding System" platform. RACC
partners with external **merchants** (e.g. Poh Kong, Tomei) who **gift gold** to customers
who renew their **vehicle insurance** through RACC. Agents (or admin) find the merchants;
each merchant has multiple branches; an agent shares a **branch QR**; a customer scans it
and submits a **car-insurance enquiry**. RACC admin produces the actual quotation
**externally** but **records** it in the system, which drives the **gold gift** to the
customer, the **agent commission**, and a **merchant settlement** — all payable only once the
customer's renewal is confirmed. Customers receive an **auto-reminder ~1 month before each
car's insurance expiry**.

This is a distinct domain from the existing recruitment flow and reuses the platform's
patterns (shareable links, public anon RPC, reward-status lifecycle, Resend/OneWaySMS) but
introduces three things the current system has never had: **percentage splits**, **multi-line
child records (N cars per enquiry)**, and **scheduled jobs (pg_cron)**.

## 2. Naming

The existing `partners` table + `business_partner` enum is an **internal recruiter** concept
and is NOT reused. All new tables are prefixed `merchant*` / domain-specific. The UI **labels**
this area "Partnership"; the database says `merchant`.

## 3. Decisions (locked)

| # | Decision | Choice |
|---|---|---|
| 1 | Accounting unit | **Per vehicle** — each car is its own quote/gift/commission/reminder line |
| 2 | Split parties | **Merchant share vs customer gift** |
| 3 | Split base | **Fixed pool amount per merchant** (same pool for every confirmed renewal) |
| 4 | Merchant share meaning | **Payable RACC owes the merchant** → `merchant_settlements` ledger |
| 5 | Customer gift | **System-issued redemption voucher** (unique code/QR), claimed at branch |
| 6 | Payable timing | **On confirmed renewal** (not at quotation) |
| 7 | Agent commission amount | Tied agent's existing **tier `reward_amount`** |
| 8 | Agent commission storage | Separate **`merchant_commissions`** ledger (not the existing `rewards` table) |
| 9 | Untied branch (no agent) | **No agent commission** |
| 10 | Reminder channel | **Email (Resend) + SMS/WhatsApp (OneWaySMS) to customer + notify tied agent** |
| 11 | Reminder timing | **~30 days before each car's expiry**, once (idempotent) |
| 12 | Voucher redemption | **Admin marks redeemed**; no merchant login |
| 13 | Insurance product field | **Admin-managed lookup table** |
| 14 | Dedup | **Standalone enquiry**, block exact dup `(branch, plate, expiry)` |
| 15 | Public access | Anon **insert-only**; no public SELECT on enquiries (PDPA) |
| 16 | Creation/approval | **Agents propose → admin approves**; admin can also create directly |
| 17 | Branch QR | **Static long-lived `link_code`** (printed signage), per-agent links like `agent_links` |

## 4. Data model

All amounts `NUMERIC(10,2)`. All tables get `created_at TIMESTAMPTZ DEFAULT now()`;
mutable tables also `updated_at`. Normalized columns (`*_normalized`) reuse
`_shared/nric-utils.ts` / `_shared/phone-utils.ts` logic (also implemented in SQL for the RPC).

### 4.1 `merchants`
- `id uuid pk`
- `name text not null`
- `logo_url text null`
- `gift_pool_amount numeric(10,2) not null default 0` — the fixed pool per confirmed renewal
- `merchant_share_pct numeric(5,2) not null default 0` — customer gift % is derived as `100 - merchant_share_pct`
- `status merchant_status not null default 'pending'` — `pending | active | inactive`
- `created_by_agent_id uuid null references agents(id)` — set when an agent proposes
- `approved_by uuid null` (admin auth uid), `approved_at timestamptz null`

### 4.2 `merchant_branches`
- `id uuid pk`, `merchant_id uuid not null references merchants(id) on delete cascade`
- `name text not null`, `address text null`, `phone text null`
- `status merchant_status not null default 'pending'`
- `created_by_agent_id uuid null references agents(id)`, `approved_by uuid null`, `approved_at timestamptz null`

### 4.3 `branch_links` (mirrors `agent_links`)
- `id uuid pk`, `merchant_branch_id uuid not null references merchant_branches(id) on delete cascade`
- `agent_id uuid null references agents(id)` — **null = house/untied → no agent commission**
- `link_code text not null unique` — stable short code used in the public URL
- `is_active boolean not null default true`

### 4.4 `insurance_products` (lookup)
- `id uuid pk`, `name text not null`, `is_active boolean not null default true`, `sort_order int not null default 0`

### 4.5 `enquiries` (submission header)
- `id uuid pk`
- `branch_link_id uuid not null references branch_links(id)`
- `merchant_branch_id uuid not null references merchant_branches(id)` — denormalized at submit
- `agent_id uuid null references agents(id)` — **snapshot** of `branch_links.agent_id` at submit time
- `customer_name text not null`
- `customer_nric text not null`, `customer_nric_normalized text not null`
- `customer_phone text not null`, `customer_phone_normalized text not null`
- `customer_email text null`
- `status enquiry_status not null default 'open'` — roll-up only: `open | closed` (auto-`closed` when every child vehicle is `renewed` or `lost`)

### 4.6 `enquiry_vehicles` (**unit of accounting**)
- `id uuid pk`, `enquiry_id uuid not null references enquiries(id) on delete cascade`
- `merchant_branch_id uuid not null references merchant_branches(id)` — denormalized for the unique index
- `car_plate text not null`, `car_plate_normalized text not null`
- `insurance_expiry_date date not null`
- `insurance_product_id uuid not null references insurance_products(id)`
- `status vehicle_status not null default 'submitted'` — `submitted | quoted | renewed | lost`
- `external_quotation_ref text null`, `quoted_at timestamptz null`, `quoted_by uuid null`
- `renewed_at timestamptz null`, `renewed_by uuid null`
- `lost_at timestamptz null`, `lost_reason text null`
- `reminder_sent_at timestamptz null` — idempotency flag for the cron
- **Partial unique index:** `unique (merchant_branch_id, car_plate_normalized, insurance_expiry_date)`

### 4.7 `gifts` (customer voucher) — created on `renewed`
- `id uuid pk`, `enquiry_vehicle_id uuid not null unique references enquiry_vehicles(id)`
- `merchant_id uuid not null`, `merchant_branch_id uuid not null`
- `value_amount numeric(10,2) not null` — `gift_pool_amount × (100 - merchant_share_pct)/100`
- `voucher_code text not null unique`
- `status gift_status not null default 'issued'` — `issued | redeemed | expired | void`
- `issued_at timestamptz`, `redeemed_at timestamptz null`, `redeemed_by uuid null`
- `expires_at timestamptz null` (optional voucher validity window)

### 4.8 `merchant_commissions` (agent ledger) — created on `renewed` when `agent_id` is set
- `id uuid pk`, `enquiry_vehicle_id uuid not null unique references enquiry_vehicles(id)`
- `agent_id uuid not null references agents(id)`
- `tier_id uuid null references tiers(id)` — snapshot of source tier
- `amount numeric(10,2) not null` — agent's `tiers.reward_amount` at time of renewal
- `status reward_status not null default 'pending'` — reuse existing enum (`pending | confirmed | paid | failed`)
- `paid_at timestamptz null`, `failure_reason text null`, `set_by uuid null`

### 4.9 `merchant_settlements` (merchant payable ledger) — created on `renewed`
- `id uuid pk`, `enquiry_vehicle_id uuid not null unique references enquiry_vehicles(id)`
- `merchant_id uuid not null references merchants(id)`
- `amount numeric(10,2) not null` — `gift_pool_amount × merchant_share_pct/100`
- `status reward_status not null default 'pending'`
- `paid_at timestamptz null`, `failure_reason text null`, `set_by uuid null`

### 4.10 New enums
- `merchant_status`: `pending | active | inactive`
- `enquiry_status`: `open | closed`
- `vehicle_status`: `submitted | quoted | renewed | lost`
- `gift_status`: `issued | redeemed | expired | void`
- (`reward_status` reused for the two money ledgers.)

## 5. Per-vehicle lifecycle & the payout trigger

```
submitted ──(admin: record external quotation)──▶ quoted ──(admin: mark renewed/paid)──▶ renewed
    │                                                  │
    └────────────────(admin: mark lost)───────────────┴──▶ lost
```

A single transactional `SECURITY DEFINER` function `confirm_vehicle_renewal(vehicle_id)`
(admin-only) performs, atomically:
1. Set `enquiry_vehicles.status = 'renewed'`, stamp `renewed_at/renewed_by`.
2. Insert `gifts` (value = customer share of the merchant pool, unique `voucher_code`, `issued`).
3. If the enquiry's `agent_id` is not null: insert `merchant_commissions`
   (amount = the agent's current `tiers.reward_amount`, `pending`).
4. Insert `merchant_settlements` (amount = merchant share of the pool, `pending`).

Idempotent via the `unique (enquiry_vehicle_id)` constraints on all three child ledgers.

Status transitions on the three ledgers/voucher reuse the existing **`set_reward_status`
pattern** (admin RPC stamping `paid_at` / `failure_reason`); the gift uses
`mark_gift_redeemed(gift_id)` (admin-only).

## 6. Flows

### 6.1 Agent shares a branch (agent portal)
Browse approved merchants/branches → create a `branch_links` row (own `link_code`) → share
`{VITE_PUBLIC_PAGES_URL}/public/enquiry/{link_code}` as link/QR. Mirrors `MyLinks.tsx`.

### 6.2 Customer enquiry (public, no auth)
Route `/public/enquiry/:linkCode` resolves the branch_link (active only) → shows merchant/branch
branding → form: customer fields + **dynamic multi-car field array** (plate, expiry `date`,
product `<Select>` from active `insurance_products`). Submit calls `submit_enquiry()`
(`SECURITY DEFINER`, granted to `anon`) which: validates, normalizes NRIC/phone, snapshots the
branch's `agent_id`, inserts the `enquiries` header + N `enquiry_vehicles`, enforces the
per-branch dup rule (friendly error), returns success → thank-you page. Mirrors `Register.tsx`
+ `register_attendee`.

### 6.3 Admin pipeline (admin portal)
"Enquiries" inbox (list + detail). Per-vehicle actions: **Record quotation** (`submitted→quoted`,
optional external ref), **Mark renewed** (`confirm_vehicle_renewal`), **Mark lost**. Payout
surfaces: **Gifts** (mark redeemed), **Merchant Settlements** + **Agent Commissions**
(set `paid/failed`), each copying the existing Rewards page UX.

## 7. Auto expiry reminder (net-new scheduling)

No scheduler exists today. Add:
- **`pg_cron`** + **`pg_net`** extensions (enabled when deploying to prod).
- A daily cron → RPC `enqueue_expiry_reminders()` selecting `enquiry_vehicles` where
  `insurance_expiry_date = current_date + interval '30 days'`, `reminder_sent_at IS NULL`,
  status in `('submitted','quoted')`. (Daily run + the `reminder_sent_at` flag guarantee
  once-only delivery even if the window is later widened to a range.)
- The RPC invokes a new edge function **`send-expiry-reminders`** (service-role) via `pg_net`,
  which sends the customer **Resend email + OneWaySMS** and notifies the tied agent
  (Asia/Singapore formatting per existing edge-fn convention), then stamps `reminder_sent_at`.

Idempotency is the `reminder_sent_at` flag; per-vehicle expiry means a 2-car customer can get
two reminders at different dates.

## 8. Security / RLS

- **Admin:** full access on all new tables via `is_admin()` (`app_metadata.role`).
- **Agents** (scoped by `get_agent_id()`): SELECT own `branch_links`, enquiries/vehicles where
  `enquiries.agent_id = get_agent_id()`, own `merchant_commissions`; INSERT `pending`
  merchants/branches and own `branch_links` (on approved branches). Read approved
  merchants/branches for browsing.
- **Anon (public):** INSERT-only via `submit_enquiry` (no SELECT on `enquiries`/`enquiry_vehicles`
  — PDPA). Narrow SELECT on the resolved `branch_links` row (+ its merchant/branch display fields)
  and on active `insurance_products` to render the form.

## 9. Frontend surfaces

- **admin-portal:** Merchants (+ split config + approvals), Branches, Insurance Products,
  Enquiries inbox, Gifts/Vouchers, Merchant Settlements, Agent Commissions. Each follows the
  `AgentList.tsx` / `AgentForm.tsx` / `use[Entity].ts` pattern; routes added to `router.tsx`;
  types in `packages/shared-types`.
- **agent-portal:** "Partnerships" (browse + propose merchant/branch, generate & share branch QR)
  and "My Enquiries & Commissions."
- **public-pages:** the `/public/enquiry/:linkCode` form + thank-you.

## 10. Implementation phasing (for the writing-plans step)

1. **Schema & admin foundations** — enums, all tables, RLS, helper functions; Merchants /
   Branches / Insurance Products admin CRUD + approvals.
2. **Public capture** — `branch_links`, public enquiry route, `submit_enquiry` RPC + dedup.
3. **Admin pipeline & ledgers** — vehicle state machine, `confirm_vehicle_renewal`, gifts +
   commissions + settlements, status RPCs, admin payout/redemption UIs.
4. **Reminders** — `pg_cron` + `pg_net`, `enqueue_expiry_reminders`, `send-expiry-reminders`
   edge function (email + SMS + agent notify).
5. **Agent portal** — propose merchant/branch, generate branch links, my enquiries/commissions.

## 11. v1 simplifications (explicitly out of scope for v1)

- **Quotation modeled as fields/status on the vehicle**, not a separate `quotations` table (no
  multi-quote history per car).
- **Redemption is admin-only** — branch verifies the voucher code with RACC out-of-band; no
  branch login and no public voucher-scan in v1 (both are clean future add-ons; the voucher code
  can later carry an HMAC like the check-in QR).
- **No customer master record** — enquiries are standalone; only exact-dup `(branch, plate,
  expiry)` is blocked.
- **No merchant self-service login.**

## 12. Build & deploy notes

- Developed/tested against **local Supabase** (`npx supabase`), since a hosted staging
  environment was shelved (cost).
- Migrations applied to **prod** via MCP `apply_migration` (NOT `db push`), per existing repo
  convention; `pg_cron`/`pg_net` enabled at that point.
- Three Render static sites auto-deploy from `main` on merge.

## 13. Key files to copy from

- `supabase/migrations/20260313000001_shareable_links_redesign.sql` — links + `register_attendee` RPC
- `supabase/migrations/20260618000001_rewards_on_completion.sql`, `20260623000001_reward_status_tracking.sql` — reward lifecycle + `set_reward_status`
- `apps/public-pages/src/pages/Register.tsx` — public form (zod + react-hook-form + normalization)
- `apps/agent-portal/src/pages/MyLinks.tsx` — link generation/sharing
- `supabase/functions/send-email-reminders/index.ts` — Resend + Asia/Singapore formatting
- `supabase/functions/_shared/{nric,phone}-utils.ts` — format-agnostic matching
- `supabase/functions/generate-qr-token/index.ts` — HMAC (future voucher hardening)

## 14. Open questions / risks to revisit

- **Voucher redemption proof:** admin-only marking means RACC trusts an out-of-band branch
  confirmation. If fraud/throughput becomes a concern, add branch login or public HMAC scan.
- **Merchant settlement reconciliation:** v1 tracks a payable per renewal; bulk
  settlement/export by merchant may be wanted later.
- **OneWaySMS template:** the expiry-reminder SMS needs a pre-registered template ID
  (like template 2502 for checkout OTP) before go-live.
