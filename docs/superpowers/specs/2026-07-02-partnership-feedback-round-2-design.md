# Merchant Partnership — Feedback Round 2 Design

Date: 2026-07-02
Branch: `feat/merchant-partnership`
Builds on: `2026-06-30-partnership-feedback-changes-design.md` (round 1, now live on prod)

Status: **APPROVED (2026-07-02).** Item 3 = option (a) — add a Unit Manager role.
Defaults for items 6/7/8 confirmed. Items 1,2,4,5 as specified. Ready for implementation plan.

This documents 8 feedback items. Each: current state (grounded in code, with
file refs), the decision, and the implementation approach. No code is written until
this spec is approved.

---

## 1. Assign to Partner — per car (not per enquiry)

**Current:** The agent picks ONE partner for the whole enquiry. UI = a single Select in
the enquiry card header (`apps/agent-portal/src/pages/MyEnquiries.tsx` `EnquiryCard`,
~L114-153); calls `useAssignEnquiryMerchant` → RPC `assign_enquiry_merchant(p_enquiry_id,
p_merchant_id)` (`supabase/migrations/20260629000010_enquiry_v2.sql:82-92`) which writes
`enquiries.merchant_id`. The per-car column `enquiry_vehicles.merchant_id` already exists
(`20260630000001_partnership_gift_rate.sql:12`) and the read model already fetches per-car
`merchant` (`useMyEnquiries.ts:32`).

**Decision:** Move partner assignment to the vehicle level.

**Approach:**
- New migration: RPC `assign_vehicle_merchant(p_vehicle_id uuid, p_merchant_id uuid)` —
  agent-owned check via join `enquiry_vehicles → enquiries.agent_id = get_agent_id()`,
  merchant must be active; `UPDATE enquiry_vehicles SET merchant_id = p_merchant_id`.
  Keep the old `assign_enquiry_merchant` in place (harmless) or drop it — TBD low-risk;
  default: leave it, stop calling it.
- Hook: replace/keep `useAssignEnquiryMerchant`; add `useAssignVehicleMerchant({vehicleId, merchantId})`.
- UI: in `EnquiryCard`, move the partner Select+Assign into each vehicle row
  (the `enq.vehicles.map` loop); per-vehicle selection state; show assigned partner via
  `v.merchant?.name` (already fetched). Export already prefers per-car (`toEnquiryExportRows`).
- Admin renewal (`confirm_vehicle_renewal`) already per-car — unchanged.

---

## 2. Tie branch to any agent (not only Unit Admins)

**Current:** Branch-link dialog agent picker (`apps/admin-portal/src/pages/merchants/
MerchantDetail.tsx:117-132`) is populated by `useAgents()`
(`apps/admin-portal/src/hooks/useAgents.ts:9-16`), which filters `.is('parent_agent_id',
null)` → only top-level agents (= Unit Admins). Root cause of "only can choose Unit Admin".
`branch_links.agent_id` already accepts any agent id (no DB constraint issue).

**Decision:** Let the picker choose any active agent.

**Approach:** Add `useAllAgents()` (admin hook, no `parent_agent_id` filter, `status='active'`,
ordered by name) and use it only in `MerchantDetail.tsx` for the branch-link agent picker.
Leave `useAgents()` untouched (it backs the admin Agents list). No DB change.

---

## 3. Authority Level — Unit Manager vs Unit Admin  ⚠️ OPEN / BLOCKED

**Current:** There is **no role/level column** on `agents`. Authority is derived purely
from `parent_agent_id`: Unit Admin = `parent_agent_id IS NULL` (frontend calls it
`agent_admin`); sub-agent = has a parent. Unit-scoped visibility (view own unit) is granted
to unit admins via additive RLS (`20260617000001_unit_admin_report_rls.sql`) over the
`parent_agent_id` tree. **No "Unit Manager" exists anywhere** (zero code matches).
`unit_name` is free text, not used for scoping.

**Decision: option (a) — add a real Unit Manager role with the same unit-view rights as
Unit Admin.** Chosen structure (additive, backward-compatible, no disruption to the
existing hierarchy):
- Keep **Unit Admin** exactly as-is: still derived = agent with `parent_agent_id IS NULL`.
- Add `agents.is_unit_manager BOOLEAN NOT NULL DEFAULT false` — a flag any agent can carry.
- **Unit-wide view** is granted to `parent_agent_id IS NULL OR is_unit_manager`, scoped to
  the agent's **unit root** = `COALESCE(parent_agent_id, id)`. A unit manager therefore sees
  every agent/registration/reward/attendance in the same unit tree they belong to — same
  view level as the unit admin.
- Add helper `get_unit_root()` = `COALESCE((SELECT parent_agent_id FROM agents WHERE
  id = get_agent_id()), get_agent_id())`; extend the existing unit-scope SELECT RLS
  (`20260617000001_unit_admin_report_rls.sql` set: registrations, rewards, attendance,
  agent_links, agents) so unit managers get the same visibility, keyed on unit root.
- **Assignment:** admin toggles "Unit Manager" in the admin-portal agent form
  (`AgentForm.tsx`); persisted on the `agents` row. (Optionally the unit admin can toggle it
  on their own sub-agents — default NO, admin-only, to keep it simple.)
- **Frontend:** agent-portal `useAuth` exposes a `unit_manager` capability; a unit manager
  sees the same unit-scoped pages a unit admin does (Team Report etc.) but NOT sub-agent
  management (create/delete sub-agents stays unit-admin-only per `create-sub-agent`).

**Note:** this is my recommended concrete model under the approved option (a); flag if the
org actually needs unit managers to be structural peers rather than a view-grant flag.

---

## 4. My Enquiry QR — "Save as photo"

**Current:** `apps/agent-portal/src/pages/MyEnquiryLink.tsx` renders `QRCodeSVG` (L58) with a
"Copy Link" button (L62-72). No download anywhere in the repo. `qrcode` pkg is a dependency
(`apps/agent-portal/package.json:25`); `pdfGenerator.ts:44-50` already uses
`QRCode.toDataURL(...)`.

**Decision:** Add a "Save as photo" outline button beside "Copy Link".

**Approach:** `import QRCode from 'qrcode'`; handler `QRCode.toDataURL(enquiryUrl(code),
{width:512, margin:1})` → anchor-click download (idiom from `Reports.tsx:76-79`),
filename `my-enquiry-qr.png`; `Download` icon (lucide) + toast. On-screen QR stays SVG.

---

## 5. Renewal admin email → `azrisk1234@gmail.com`

**Current:** One admin-recipient field: `system_settings.admin_notification_email`
(`20260630000002_enquiry_form_settings.sql:7-8`), consumed by `send-quote-request`
(Get Quote). No separate "renewal" recipient exists. Edited in admin Settings
(`Settings.tsx` EnquiryFormSettingsCard, L320-328).

**Decision:** Set `admin_notification_email = 'azrisk1234@gmail.com'` (data, per-env: prod
`mjtdsevynrtcmafsnxsj`; also staging). Its role expands per item 6 (below) to be the
catch-all recipient for enquiry notifications, not just Get Quote.

**Approach:** Data update via MCP `execute_sql` (UPDATE system_settings). Admin can still
change it in the Settings UI.

---

## 6. All enquiries must email respective agents (+ admin catch-all)  ✅ default

**Current:** `send-enquiry-notification` emails ONLY the single tied agent
(`enquiries.agent_id`); skips if no agent. `submit_enquiry` only calls
`notify_agent_enquiry` `IF v_agent_id IS NOT NULL` (`20260630000003_submit_enquiry_roadtax.sql:67`).
Gap: branch/house-link enquiries with no tied agent email nobody.

**Decision (✅ default — confirm):** Every enquiry notifies (a) the tied agent when present,
AND (b) always the admin catch-all (`admin_notification_email`). Nothing slips through.

**Approach:**
- Migration: change `submit_enquiry` to call `notify_agent_enquiry(v_enquiry_id)`
  unconditionally (drop the `IF v_agent_id IS NOT NULL` guard).
- `send-enquiry-notification`: after the (existing) agent email, also send to
  `system_settings.admin_notification_email` when set; make "no tied agent" a non-skip
  (still email admin). Keep graceful degradation (RESEND unset → skip).
- (If the user later prefers "agent + unit admin" instead of admin catch-all, swap the
  second recipient for `agent.parent_agent_id`'s email — the quote-request fn already
  resolves parent.)

---

## 7. Unit Admin create partner  ✅ default

**Current:** RLS "Agents propose merchants" allows an agent to insert a `merchants` row with
`status='pending'` + `created_by_agent_id=get_agent_id()`
(`20260627000001_merchant_core.sql:112-114`); `approve_merchant()` (admin-only) flips to
active. Agent hooks `useProposeMerchant`/`useProposeBranch` exist
(`useAgentMerchants.ts:30,55`) but are **wired to no UI**. Admin approval UI: needs a
"pending merchants → approve" action (admin `MerchantList` currently creates active
merchants; approval of pending ones may need adding).

**Decision (✅ default — confirm):** Wire a "Propose Partner" flow for Unit Admins
(`agent_admin` only). Proposed partner is `pending`; an admin approves it before it's
usable. Restricted to unit admins.

**Approach:**
- Agent-portal: a "Propose Partner" form/dialog on the Partnerships page, gated to
  `role === 'agent_admin'`, using existing `useProposeMerchant` (status pending).
- Admin-portal: ensure pending merchants are visible and approvable (list pending +
  "Approve" button calling `approve_merchant`). Add if missing.
- No DB change needed (RLS + RPC already exist).

---

## 8. Header/Footer for ALL public forms (Events + Partnership)  ✅ default

**Current:** Only the partnership enquiry form is configurable, via
`system_settings.enquiry_form` JSONB (logo/title/subtitle/footer/tnc/dpo), edited in admin
Settings, rendered in `public-pages/Enquiry.tsx`. The events forms
(`Register.tsx`, `CheckOut.tsx`, `Display.tsx`) have **hardcoded** logos/titles and no
footer; they read no settings.

**Decision (✅ default — confirm):** Introduce a single admin-managed **shared branding**
(logo + footer) applied to ALL public forms (events + partnership); keep each form's own
built-in title. Partnership's `enquiry_form` keeps its extra fields (title/subtitle/tnc).

**Approach:**
- Migration: add `system_settings.form_branding` JSONB `{ logo_url, footer_text }`
  (anon-readable, defaults to current brand). (Alternative if user picks option 2/3:
  full per-form header sets.)
- Admin Settings: a "Form Branding" card (logo URL + footer text) + update hook.
- Public read hook (like `useEnquiryFormSettings`) exposing `form_branding`.
- Wire logo+footer into `Register.tsx`, `CheckOut.tsx`, `Display.tsx`, and reuse in
  `Enquiry.tsx` (its own title/subtitle/tnc stay from `enquiry_form`).

---

## Cross-cutting

- **DB deploys:** new migrations applied to prod via MCP `apply_migration` (per
  [[prod-migration-apply-method]]); parity with staging afterward.
- **Edge fns:** `send-enquiry-notification` redeploy (item 6). `verify_jwt=false` preserved.
- **Frontend:** merge to `main` → Render redeploys the 3 `racc-*` sites.
- **Sequencing:** items 1,2,4,5,6,7,8 are independent of item 3 and can proceed once the
  ✅ defaults are confirmed; item 3 lands separately after its decision.

## Resolved decisions (2026-07-02)
1. **Item 3** — option (a): add Unit Manager role via additive `is_unit_manager` flag (see §3).
2. Items 6, 7, 8 — ✅ defaults confirmed.
3. Item 1 — leave `assign_enquiry_merchant` dormant (don't drop); agent UI uses the new
   per-vehicle RPC.
4. Items 1, 2, 4, 5 — proceed as specified.
