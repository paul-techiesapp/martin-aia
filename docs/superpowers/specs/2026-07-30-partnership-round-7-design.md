# Partnership Round 7 — Unit Enquiry Summary + Row-Cap Tally Fix

**Date:** 2026-07-30
**Branch:** `feat/partnership-round-7`, cut from `feat/partnership-round-6` (round 6 is on staging awaiting
sign-off and has not merged to main; round 7 builds on its unit-viewer roles and Team Report).

## Problem

Two requests came out of the 2026-07-30 feedback round.

**1. Numbers do not tally between admin, unit and agent views.**

Reported with screenshots: agent DOO CHANG CHEAK's own portal lists 2 enquiries (Isaac Ong Ing Rong,
9 Jul; Pang Way Hoon, 23 Jul). The unit manager (DR88 – TRACY) sees both. The admin portal, filtered to
unit DR88, shows only Pang Way Hoon — a browser search for "doo chang" finds a single hit.

Root cause, confirmed against production (`mjtdsevynrtcmafsnxsj`) on 2026-07-30:

| Fact | Value |
| --- | --- |
| Enquiries in production | 1,507 |
| Rows the admin portal receives | 1,000 (PostgREST `max-rows` default) |
| Oldest enquiry admin can see | 2026-07-18 05:53 UTC |
| Enquiries invisible to admin | 507 |
| DR88 true total | 266 (admin displays ~168) |
| DOO CHANG CHEAK true total | 2 |

`useEnquiries()` (`apps/admin-portal/src/hooks/useEnquiries.ts:79-91`) issues an unbounded `.select()`.
PostgREST caps the response server-side and returns HTTP 200 with a partial array — no error is raised, so
React Query caches 1,000 of 1,507 rows. Every filter, count and export in `EnquiryList.tsx` is then computed
over that truncated set. Isaac Ong's 9 Jul enquiry predates the cutoff, so admin never receives the row.

The cap is applied after `order by created_at desc` but before client-side filtering, so each unit loses a
different fraction of its history (J771: 179 of 499; DR88: 102 of 266). There is no constant offset, which is
why the discrepancy looks arbitrary.

The agent and unit views are correct. Only admin is wrong.

This is not confined to enquiries. No `.range()` or `.limit()` call exists in any admin or agent hook.
`enquiry_attachments` (1,992 rows) and `enquiry_vehicles` (1,832) are already over the cap; `registrations`
(729) crosses it soon, which will silently corrupt the Event reports.

**2. No per-unit enquiry summary.**

Requested as "a summary same like Event Team performance, got total number of customer filling up form for
each unit", and as "each team car enquiries summaries" in the feedback deck. Today the Reports page has
Overview, Attendees, Team Performance, Partners and Renewals tabs, but nothing aggregates enquiries by unit.

## Out of scope

The feedback PDF contains further items (pages 2–5, 7): Master vs Unit partnership grouping, showing which
unit uploaded a partnership request, unit and agent on the partnership detail, per-partnership T&C column and
footer image, a Branch column in admin Enquiries, and an iPad "copy my-cars link" failure affecting 3 of 5
iPads. The user confirmed these are not part of this round. The iPad copy failure is a genuine defect and
should be raised as its own item later.

## Part 1 — Stop the truncation

### Approach

A shared `fetchAll()` helper that pages through a PostgREST query in 1,000-row chunks until a short page is
returned.

Two correctness requirements:

- **Deterministic ordering.** Paging over `order by created_at desc` alone is unsafe: `created_at` values can
  tie, and PostgREST gives no stable ordering among tied rows, so a row can appear on two pages or on none.
  Every paged query orders by `(created_at desc, id desc)`. For tables without `created_at`, `id` alone.
- **Runaway guard.** Paging stops at 50,000 rows and logs a console warning. A caller that hits this has a
  query that should be aggregated server-side instead.

The helper lives in `packages/shared-ui` beside the existing `supabase` client so both portals use one
implementation.

### Scope

Every unbounded `.select()` against a table that grows per transaction. Single-row reads
(`.eq('id', …).single()`), `head: true` count queries, and lookups on fixed-size tables (tiers, campaigns,
system settings) are excluded — they cannot truncate.

Confirmed candidates from the audit; the implementation plan verifies each and adds any missed:

| App | Hook | Table |
| --- | --- | --- |
| admin | `useEnquiries.ts:80` | enquiries |
| admin | `useEnquiryAttachments.ts:19` | enquiry_attachments |
| admin | `useRenewalReport.ts:50` | enquiry_vehicles |
| admin | `useRegistrations.ts` (list queries) | registrations |
| admin | `useReports.ts:90, :349` | registrations |
| admin | `useReports.ts:184` | agents |
| admin | `useRewards.ts:37` | rewards |
| admin | `useMerchantCommissions.ts:25` | merchant_commissions |
| admin | `useMerchantSettlements.ts:25` | merchant_settlements |
| admin | `useAgents.ts`, `useAllAgents.ts` | agents |
| agent | `useMyEnquiries.ts:31` | enquiries (unit-wide path) |
| agent | `useEnquiryAttachments.ts:22` | enquiry_attachments |
| agent | `useAgentLinks.ts:53, :171, :203` | registrations |
| agent | `useRegistrations.ts` (list queries) | registrations |
| agent | `useTeamReport.ts:81` | registrations |
| agent | `useMyCommissions.ts:20` | merchant_commissions |
| agent | `useSubAgents.ts` | agents |

### Acceptance

Measured against SQL, not asserted:

- Admin Enquiries filtered to unit DR88 displays **266**, matching
  `select count(*) from enquiries e join agents a on a.id = e.agent_id where a.unit_name = 'DR88'`.
- Searching "doo chang" in admin Enquiries returns **2** rows, including Isaac Ong Ing Rong (9 Jul).
- Admin Enquiries with no filter displays the full `select count(*) from enquiries` total.
- The Downloaded report contains the same row count as the on-screen list.

## Part 2 — Enquiry summary by unit

### Approach

One Postgres function is the single source of every number, called by all three portals. This is deliberate:
the complaint is that admin, unit and agent disagree, and the durable fix is that they read the same computed
row rather than each aggregating a private copy of the data.

`SECURITY DEFINER`, reusing the authz primitives the RLS policies already use — `is_admin()`,
`is_unit_viewer()`, `get_unit_root()`, `unit_member_ids()`, `get_agent_id()` — so "my unit" cannot drift from
what RLS enforces elsewhere.

### `enquiry_unit_summary(p_from date, p_to date)`

Filters on `enquiries.created_at` within `[p_from, p_to]` (both nullable; null means unbounded). Returns one
row per unit:

| Column | Meaning |
| --- | --- |
| `unit_name` | unit name |
| `unit_root_id` | unit root agent id, for drill-down |
| `forms_submitted` | enquiries received in range |
| `customers` | distinct people by normalised IC (`regexp_replace(nric, '[^a-zA-Z0-9]', '', 'g')` upper-cased) — a repeat submitter counts once |
| `cars` | vehicles on those enquiries, excluding `removed_at is not null` |
| `cars_open` | vehicles in `submitted` or `quoted` |
| `cars_renewed` | vehicles in `renewed` |
| `agents_active` | agents in the unit with at least one enquiry in range |

Both `forms_submitted` and `customers` are shown. They differ legitimately — one person submitting two cars on
separate days is 2 forms and 1 customer — and the request ("total number of customer filling up form") is
ambiguous between them. Showing both removes the ambiguity rather than guessing.

Enquiries with `agent_id is null` (5 rows in production, the "House" bucket) group under a `House` unit row so
totals reconcile to the table count.

Visibility inside the function:

- `is_admin()` → all units.
- `is_unit_viewer()` → the caller's own unit only.
- plain agent → a single row covering only that agent's own enquiries.
- anyone else → no rows.

### `enquiry_agent_summary(p_from date, p_to date, p_unit_root uuid)`

Same columns, one row per agent within the requested unit, minus `agents_active`. Same visibility rules: an
admin may pass any unit root; a unit viewer may only pass their own (any other value returns no rows); a plain
agent gets only their own row.

### Surfaces

**Admin — new "Enquiries" tab in Reports** (`apps/admin-portal/src/pages/Reports.tsx`), placed after Team
Performance. Date-range picker (from/to on submission date), a summary table over all units, expandable
per-agent rows under each unit, and CSV export via the existing `downloadCsv` helper. Layout mirrors the Team
Performance tab: summary table first, detail below.

**Unit Manager — Enquiries section on Team Report** (`apps/agent-portal/src/pages/TeamReport.tsx`), listing
each agent in the unit with their forms, customers, cars and renewed counts. Uses the same date range as the
rest of that page. Reached through `enquiry_agent_summary()` with the caller's own unit root.

**Agent — totals line on My Enquiries** (`apps/agent-portal/src/pages/MyEnquiries.tsx`): a compact strip
showing forms, customers, cars and renewed for the agent's own enquiries, honouring the date filters already
on that page.

### Acceptance

- Summing `forms_submitted` across all units in the admin tab, with no date filter, equals
  `select count(*) from enquiries`.
- DR88's row reads 266 forms; drilling in shows DOO CHANG CHEAK with 2 forms and 2 customers.
- A unit manager opening Team Report sees their own unit's agents only, and their per-agent numbers match what
  the admin tab shows for that same unit.
- An agent's totals line matches the number of rows in their own list.

## Part 3 — Rollout

Order matters: the frontend calls RPCs that must already exist.

1. Migration applied to staging (`lyjdlietzmmejrxjvwgp`), verified against known staging numbers.
2. Migration applied to production (`mjtdsevynrtcmafsnxsj`) via MCP `apply_migration` — never `supabase db push`,
   which would break prod migration history.
3. Frontend deployed to staging for sign-off.
4. Merge to `main` after sign-off, which auto-deploys the Render production sites.

Verification runs against production data with the counts recorded in this document (1,507 total; DR88 266;
DOO CHANG CHEAK 2), re-queried at verification time since the table is still growing.

## Testing

No test runner exists in this repo (`pnpm -r typecheck` and `pnpm build` are the available gates; eslint is not
installed). Verification is therefore explicit and manual, per acceptance criteria above, with every claimed
number checked against a SQL query run at the time of the check.

Specific risks to probe:

- **Paging boundary.** Confirm no duplicate or missing rows at the 1,000/2,000 boundaries by comparing the
  admin list count to `select count(*)` exactly, not approximately.
- **Load time.** The admin Enquiries page moves from 1 request to 2 (1,507 rows). Confirm it stays acceptable;
  if not, the fallback is server-side filtering on that page, which is a larger change and out of scope here.
- **RPC authz.** Confirm a unit viewer passing another unit's `p_unit_root` receives no rows, and that a plain
  agent cannot see unit-wide totals.
