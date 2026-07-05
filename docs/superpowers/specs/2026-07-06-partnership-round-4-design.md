# Partnership Feedback Round 4 — Design

**Date:** 2026-07-06
**Source:** "Feedback Changes - 5 Jul.pdf" (10 pages, several marked CRITICAL CHANGE)
**Branch:** `feat/partnership-round-4`
**Environments:** staging (`lyjdlietzmmejrxjvwgp`) first, then prod (`mjtdsevynrtcmafsnxsj`). Migrations applied via MCP `apply_migration` (never `db push`).

## Context

Round 4 of client feedback on the merchant gift-partner subsystem. Ground truth
established by codebase exploration:

- The Get Quote email (`send-quote-request`) already contains agent/unit/customer/vehicle info.
- The **admin portal** Enquiries page already has Unit > Agent > Partner > Status > Expiry > Received sort and a Download button; the PDF page-3 screenshot is the **agent portal** unit view, which lacks these.
- All four public forms share one `system_settings.form_branding.logo_url`, which round 3 pointed at the A-Z logo — event forms inherited the partnership logo (root cause of page 5).
- Two unrelated "partner" systems exist: event-recruitment `partners` (login accounts, tiers) vs partnership `merchants`. Page 8's confusion is IA/naming, not a data bug.
- Agents have no page listing merchants they proposed; `useAgentMerchants` returns all active merchants system-wide (RLS: `status='active' OR created_by_agent_id = get_agent_id()`).
- `is_unit_manager` (deputy) currently grants read-only unit access via `is_unit_viewer()` RLS.

## Decisions (user-confirmed)

1. Master Partner access = **real auth login** (`merchants.user_id`), not a secret link.
2. "Unit Manager access level" = deputy (`is_unit_manager`) gains **manage powers**, matching the unit boss inside the agent portal.
3. Form logos **split into two settings**: `form_branding.event_logo_url` (RACC) for event forms; existing `logo_url` (A-Z) stays for the partnership enquiry form. Data fix applied to staging + prod.
4. "Assign to partner confirmed per quotation on renewal" = **no change**; existing per-vehicle assign + admin renewal confirm flow verified.

## Item 1 — Scope agent "Assign partner" dropdown (CRITICAL)

**Requirement:** dropdown shows only master partners + the agent's own partners.

- **Client:** `MyEnquiries.tsx` filters `activeMerchants` to `created_by_agent_id === null || created_by_agent_id === myAgentId`.
- **Server:** `assign_enquiry_merchant()` RPC hardened: reject when the target merchant is neither master (`created_by_agent_id IS NULL`) nor created by the acting agent. Error code distinct (e.g. `P0008`).
- RLS SELECT policy on `merchants` unchanged (partner names must still render on unit-wide enquiry views and admin joins).
- Unit viewers acting on a sub-agent's enquiry follow the same rule relative to the **acting** agent.

## Item 2 — Get Quote email enrichment

Existing content verified (agent name/code, unit, unit admin, customer name/phone/email/NRIC, plate/expiry/road tax). Changes to `send-quote-request`:

- Include **assigned partner (merchant) name** row when the vehicle's enquiry has one.
- **Attach the vehicle's covernote/geran files** (rows in `enquiry_attachments` for that vehicle, downloaded from the private bucket, sent as Resend attachments, base64). Guard: skip files that would push total attachments past ~20MB; fall back to listing filenames.
- No flow changes; per-quotation confirm flow stays as-is.

## Item 3 — Agent portal unit view: sort / filter / download

For unit viewers on My Enquiries:

- Default sort: **Agent > Partner > Status (open first) > earliest expiry > received (newest)**. (No Unit key — a unit viewer sees one unit.) Non-viewers keep the current Partner > Status > Expiry > Received order.
- Add **Partner** and **Status (All/Open/Closed)** filter dropdowns beside the existing Agent filter.
- Add **Download report** button (unit viewers only) reusing `buildEnquiriesWorkbook` + `toEnquiryExportRows` from `@agent-system/shared-ui`, fed with the filtered rows.

## Item 4 — Agent can amend/upload enquiry files (CRITICAL)

Own enquiries only (not unit-wide):

- **UI:** per-vehicle Upload button in My Enquiries (accept image/PDF ≤10MB, same constraints as the bucket); new files appear in the attachment list. Delete button on attachments of own enquiries.
- **DB:** new RLS policies on `enquiry_attachments`: INSERT and DELETE for agents where the parent enquiry's `agent_id = get_agent_id()`. Storage: agent INSERT/DELETE policies on `enquiry-attachments` scoped to paths of own enquiries (path convention `enquiry/<enquiry_id>/...` — follow the existing upload path convention used by the public form).
- Existing files are never silently replaced; "amend" = upload new + delete old.

## Item 5 — Event forms use RACC logo (CRITICAL)

- `form_branding` JSONB gains `event_logo_url` (migration updates default + comment).
- `useFormBranding` exposes both; **Register / CheckOut / Display** render `event_logo_url`, falling back to the built-in RACC `<Logo>` when blank. **Enquiry** keeps current precedence (`logo_url` → `enquiry_form.header_logo_url` → merchant logo).
- Admin Settings FormBrandingCard: two labeled fields — "Event Forms Logo" and "Partnership Forms Logo".
- **Data fix (staging + prod):** `event_logo_url` = RACC logo URL (from `company-assets`), `logo_url` unchanged (A-Z v2).

## Item 6 — Photo header/footer on enquiry form (CRITICAL)

- `enquiry_form` settings gain `header_image_url`, `footer_image_url`.
- Admin Settings: **file-upload widgets** for both (reuse the Company Logo upload pattern → `company-assets` bucket, e.g. `form-images/enquiry-header.<ext>`), with helper text documenting standard dimensions: **header 1600×400 (4:1), footer 1600×200 (8:1)**; PNG/JPEG, ≤2MB.
- Public Enquiry form: header image renders full-width above the title block; footer image renders full-width above the footer text. `object-contain`, responsive `w-full h-auto`.
- Scope: enquiry form only (event forms unchanged this round).

## Item 7 — Master Partner login + Staff ID (CRITICAL)

### 7a. Merchant login ("Branch Performance")

- **DB:** `merchants.user_id UUID UNIQUE REFERENCES auth.users(id)` (nullable).
- **Edge function `create-merchant-user`** (mirrors `create-partner`): admin-only; creates an auth user with `app_metadata.role='merchant'`, links `merchants.user_id`. Also support unlink/reset.
- **Admin UI:** Merchant Detail gains a "Portal Access" card — create login (email + temp password), show linked email, revoke.
- **Agent portal auth:** `useAuth` resolves a third role `merchant` (lookup `merchants.user_id`). Merchant role sees a single nav item **Branch Performance**.
- **Stats:** SECURITY DEFINER RPC `merchant_branch_stats()` — callable only by the linked merchant user — returns per-branch: branch name/status, total leads, leads this month, last submission timestamp. Counts **only** enquiries with `branch_link_id IS NOT NULL` (submitted through branch links); agent-assigned leads (`assign_enquiry_merchant`) excluded. **No customer PII in the payload.**
- Merchant RLS beyond the RPC: none (merchant user cannot read enquiries directly).

### 7b. Staff ID field on branch enquiry form

- `enquiries.staff_id TEXT` (nullable).
- `submit_enquiry()` gains optional `p_staff_id`; stored on the enquiry.
- Public Enquiry form: "Staff ID" input shown **only when link kind = 'branch'**; optional.
- Surfaced: admin enquiry list detail row + report export column; available for future per-staff merchant stats.

## Item 8 — Event vs partnership partner separation (CRITICAL)

- Rename agent portal nav + page title "Partners" → **"Event Partners"**, kept in the EVENTS group (answers the client's "is this wrong?" — the two partner systems are now visually distinct).
- New agent portal page **"My Partners"** under PARTNERSHIP: lists merchants where `created_by_agent_id = me` (any status) — name, status badge (pending/active/inactive), contact person/phone, branch names, proposed date. The **Propose Partner** action moves here (kept accessible from My Enquiries too).

## Item 9 — Distinct event link card colors

- `InvitationCard` (shared-ui) accepts optional `gradientFrom`/`gradientTo` (and keeps the current defaults).
- MyLinks computes colors per link: if the campaign has `card_template_overrides` colors, use the effective template's primary/secondary (matches the printed PDF card); else pick from a **curated 8-gradient palette deterministically by campaign id hash** — same event always same color, different events very likely different.

## Item 10 — Sorting options + Unit Manager manage powers (CRITICAL)

### 10a. My Enquiries sort dropdown

Options: Default (current smart sort) / Received newest / Expiry soonest / Status / Partner / Customer A-Z. Client-side, applies to both agent and unit views (after unit default sort of Item 3).

### 10b. Unit Manager deputy manage powers

Deputy (`is_unit_manager=true`) matches the unit boss (`agent_admin`) inside the agent portal:

- **Nav gating:** My Agents + Event Partners pages shown to `isUnitViewer` (was `agent_admin`-only).
- **Enquiry actions on unit rows:** assign partner, Get Quote, upload files no longer `readOnly` for deputies. Server side: `assign_enquiry_merchant()` and the attachment policies extended from "own enquiry" to "enquiry of a unit member" **when the actor is a unit viewer** (`is_unit_viewer()` + enquiry agent in `unit_member_ids()`).
- Get Quote edge function authorizes unit viewers for unit members' enquiries.
- Header label: deputy shows **"Unit Admin"** (round-3 naming: Unit Manager > Unit Admin > Agents); boss keeps "Unit Manager".
- Event-partner creation (`create-partner` edge fn) permitted for deputies.

## Non-goals

- No change to reward/gift math, settlements, event flows.
- No merchant self-service beyond the read-only stats page.
- No header/footer images on event forms this round.
- No RLS tightening of merchant SELECT (names must render across views).

## Rollout

1. Migrations (numbered `202607060000xx`) applied to staging via MCP; verify; then prod.
2. Edge functions: redeploy `send-quote-request`; deploy new `create-merchant-user`; update `send-enquiry-notification` only if staff_id included in notification (nice-to-have, optional).
3. Data fixes (both envs): `form_branding.event_logo_url` = RACC logo URL.
4. Frontend: single PR `feat/partnership-round-4` → main → Render auto-deploy (prod). Staging Render sites track the feature branch — push branch to update staging.
5. Verify: typecheck + build all apps (no test runner in repo).
