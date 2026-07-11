# Partnership Feedback Round 5 — Design

**Date:** 2026-07-11
**Source:** client PDF "Feedback Changes - 080726" (retest notes dated 8 Jul 2026)
**Scope:** agent portal, admin portal, public enquiry form, merchant portal, Supabase schema/RLS/RPC.

## Context

Round 4 (PR #15) and follow-ups (PRs #16–#18) shipped on 6 Jul. The client retested on 8 Jul.
Several "still not fix yet" items are stale screenshots of the pre-Jul-6 UI, but four are
genuine gaps and two are new requests. This spec addresses each PDF item explicitly.

Item status legend: **BUILD** = code change in this round; **REPLY** = already working,
answer the client with evidence; **DATA-FIX** = production/staging data correction.

---

## A. BUILD — Assign-partner dropdown scoped by `is_master` (PDF p1, CRITICAL)

**Problem:** `MyEnquiries.tsx` shows every active merchant with `created_by_agent_id IS NULL`
(i.e. all admin-created partners) to every agent. Client expects: Master Partners + the
agent's own partner(s) only.

**Schema:**
- `ALTER TABLE merchants ADD COLUMN is_master boolean NOT NULL DEFAULT false;`
- Backfill: `UPDATE merchants SET is_master = true WHERE user_id IS NOT NULL;`
  (POH KONG — the only merchant with portal login today.)

**Admin portal:** Partner setup (create/edit merchant) gets a "Master Partner" toggle.
Master partners are visible to all agents; non-master partners only to their own agent.

**Agent portal dropdown rule** (one helper, reused by the dropdown and My Partners page):
a merchant is *available to the agent* when it is `status = 'active'` AND any of:
1. `is_master = true`
2. `created_by_agent_id = agent.id` (agent's own proposal)
3. the agent holds a `branch_links` row into one of the merchant's branches
   (`branch_links.agent_id = agent.id` → `merchant_branches.merchant_id`).

**Server-side enforcement:** `assign_vehicle_merchant` RPC re-validates the same rule
(master OR own OR branch-linked) and raises an exception otherwise — the UI filter alone
is not a security boundary. Unit viewers assigning on unit members' rows are validated
against the *caller's* agent identity.

## B. BUILD — My Partners shows available partners for every agent (PDF p4 item 2)

`MyPartners.tsx` currently lists only merchants the agent proposed — empty for standard
agents. Rework it to list all *available* merchants per rule A, with columns:
Name, Contact, Branches, Source badge (Master / Proposed by you / Linked), Status.
Pending own proposals stay visible (current behaviour preserved). The
Propose Partnership button remains unit-viewer-only. Nav item already exists for all agents.

## C. REPLY (+ copy tweak) — Event Partners tab confusion (PDF p4 item 1)

Behaviour is correct: "Add Partner" on `/partners` creates an **event-recruitment
partner** (events subsystem), unrelated to partnership merchants. Nav was already renamed
"Event Partners" in Round 4. Add one clarifying line to the page description
("Recruitment partners for events — insurance partnership merchants are managed under
Partnership → My Partners") and answer the client's "is this wrong?" in the reply.

## D. REPLY — Get Quote flow (PDF p2)

Shipped 6 Jul: per-vehicle Assign, per-vehicle Get Quote button
(`useRequestQuote` → `send-quote-request` edge fn), admin email already contains
Agent & Unit section (agent, code, unit, unit admin) and Customer & Vehicle details,
plus document attachments. Per-quotation confirmation on renewal exists via
`confirm_vehicle_renewal`. Verify once on production, include current-UI screenshots in
the reply. No code change.

## E. BUILD — Per-partner form design in partner setup (PDF p3, NEW)

**Schema:** `ALTER TABLE merchants ADD COLUMN form_settings jsonb;` holding optional keys:
`header_image_url`, `header_logo_url`, `header_title`, `header_subtitle`, `footer_text`.

**Admin portal:** "Form Design" section inside Partner setup (merchant edit dialog/page).
Image uploads reuse the existing enquiry-form photo upload storage path/bucket.

**Public form (`Enquiry.tsx`), per-field resolution for branch-context forms:**
merchant `form_settings` value → global `system_settings` enquiry form value → hardcoded
default. Agent-context forms are unaffected (no merchant).

## F. BUILD — "Submitted via MERCHANT (branch)" on branch forms (PDF p6, NEW)

Branch-context forms stop rendering the merchant-specific header title
("POH KONG — Gold Gift Enquiry") and the long overlay sentence ("Renew your car insurance
at …"). Instead:
- Header title/subtitle: generic (global settings / merchant form_settings per item E).
- Merchant identity renders as the same small boxed chip style the agent form uses:
  `Submitted via POH KONG (HEADQUARTER — POH KONG)` — i.e.
  `Submitted via {merchant_name} ({branch_name})`.

## G. BUILD — Collision-proof event link card colors (PDF p5)

Round 4 shipped `resolveCardGradient` with an 8-color palette keyed by campaign-id hash;
two campaigns can hash to the same slot (likely what the client saw). Change the
list-rendering pages (My Links, All Links, Partner Links) to assign gradients per visible
list: hash each campaign id first; on collision, deterministically bump (ordered by
campaign id) to the next free palette slot. Campaign `panelColor` overrides still win.
Same list → same colors across reloads; different campaigns in one list are always
distinct (up to 8 concurrent, palette then cycles).

Implementation: new shared helper `assignCampaignGradients(campaigns) → Map<campaignId,
[from,to]>` in `shared-ui/utils/cardGradient.ts`; `resolveCardGradient` keeps handling the
override/luminance logic per campaign.

## H. BUILD — Branch Performance date filter + sorting (PDF p7)

Recent Leads table (merchant portal, `BranchPerformance.tsx`) already has branch + status
filters and a Staff ID column. Add:
- Submitted-date range filter (From / To date inputs, inclusive).
- Sort dropdown: Newest (default), Oldest, Staff ID, Branch.
Pure frontend over the existing `merchant_branch_leads` RPC result.

## I. BUILD — My Enquiries date-of-submission filter (PDF p8 item 1)

Add a submitted-date range filter (From / To) beside the existing sort/partner/status
controls in `MyEnquiries.tsx`, filtering on `enquiry.created_at`. Export honours the
visible (filtered) set, as it does today.

## J. BUILD + DATA-FIX — Unit Manager linked to a unit (PDF p8 item 2)

**Problem:** admin portal's AgentForm exposes `is_unit_manager` but always creates
top-level agents (`parent_agent_id IS NULL`), so a new Manager is its own empty unit and
sees none of the Unit Admin's data (`get_unit_root()` = own id).

**Fix:**
- AgentForm: when "Unit Manager" is checked, show a required **Unit** selector listing
  top-level agents (existing `useAgents` returns exactly those). Create/update passes
  `parent_agent_id` = selected unit admin's agent id and inherits that unit's `unit_name`.
- `create-agent` edge function accepts optional `parent_agent_id` (validated: must
  reference a top-level agent) and stores it.
- Editing an existing agent can set/unset the flag + unit the same way.
- **Data-fix:** link the client's already-created Manager account (staging + prod) to its
  intended unit (`parent_agent_id`, `unit_name`), after confirming which unit with the
  client or from context.

RLS already supports this: `is_unit_viewer` passes for `parent_agent_id IS NOT NULL AND
is_unit_manager`, and unit scoping uses `COALESCE(parent_agent_id, id)`.

## K. REPLY — IC dedup stays at 1-month window (PDF p8 item 3)

P0009 dedup with a 1-month rolling window shipped in PRs #16/#17 (deliberate: a permanent
lock would block next year's renewal). Reply as done, explaining the window.

---

## Error handling

- RPC-side partner-scope violation → clear exception message surfaced by the existing
  toast error path in MyEnquiries.
- `form_settings` is nullable/partial jsonb — every consumer falls back per-field; a
  malformed value never blanks the public form (defaults win).
- Date filters: empty From/To = unbounded; From > To yields an empty list (no crash).

## Testing

- No test runner in repo: gate with `pnpm -r typecheck` + `pnpm build` (per project memory).
- Staging smoke tests per item: dropdown contents as MARTIN KIM-equivalent standard agent
  (should see POH KONG only, not Tomei, unless linked/proposed); My Partners rendering;
  branch form chip copy; per-partner form design override + fallback; Manager account
  sees unit data after linking; Branch Performance + My Enquiries filters; two campaigns
  colliding on the old hash now render distinct colors.
- RLS check: agent token calling `assign_vehicle_merchant` with an out-of-scope merchant
  must fail.

## Rollout

Feature branch `feat/partnership-round-5` (branch-guard every commit — shared working
tree). Staging first: migrations via MCP `apply_migration` on `lyjdlietzmmejrxjvwgp`,
Render staging auto-deploys the branch. After smoke test: PR to `main`, prod migrations
via MCP `apply_migration` on `mjtdsevynrtcmafsnxsj` (never `db push`), Render prod
auto-deploys. Client reply document covers items C, D, K with evidence.
