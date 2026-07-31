# Partnership Feedback Round 6 — Design

**Date:** 2026-07-21
**Status:** Approved (pending user review of this doc)
**Source:** Client discussion notes (RACC), 2026-07-21

## Context

Sixth round of client feedback on the merchant-partnership subsystem plus a few
event-side items. Prod and staging are both at PR #21 (customer self-serve
vehicles). This round is dominated by one structural change — the unit
hierarchy becomes self-managed — plus a set of independent UX/reporting items.

## Terminology decision (applies everywhere)

The DB role value `agent_admin` is **not renamed** (live system; renaming role
values is all risk, no benefit). Instead, UI labels are made consistent in both
portals:

| Concept | DB reality | UI label |
|---|---|---|
| Unit root — created by master admin, irreplaceable | `parent_agent_id IS NULL` (role `agent_admin`) | **Unit Manager** |
| Deputy — multiple allowed, managed by the Unit Manager | sub-agent with `is_unit_manager = true` | **Unit Admin** |
| Regular member | sub-agent, flag off | **Unit Agent** |

Note the current admin-portal AgentForm labels the deputy toggle "Unit Admin"
(correct under this glossary) but its description calls the root "Unit
Manager" inconsistently elsewhere; all labels get audited against the table
above.

## Permission matrix

| Action | Unit Manager | Unit Admin | Unit Agent |
|---|---|---|---|
| Unit-wide view (reports, enquiries, links, partners) | ✓ | ✓ | — |
| Create Unit Agents | ✓ | ✓ | — |
| Edit Unit Agents (full admin-equivalent fields) | ✓ | ✓ | — |
| Delete Unit Agents | ✓ | ✓ | — |
| Promote/demote Unit Admins | ✓ | — | — |
| Edit/delete Unit Admins | ✓ | — | — |
| Edit/delete the Unit Manager | — (admin portal only) | — | — |

Enforcement is at the DB/edge-function layer (not UI-only): a deputy must not
be able to self-promote or touch peers via direct API calls.

## Items

### 1. Unit dashboard — My Agents becomes full management

- **Edit** any unit member with the same fields the admin portal exposes
  (name, email, phone, NRIC, staff info, **tier, status** — client chose
  "everything admin can edit"). Email changes must ripple to `auth.users`,
  so edits go through an edge function (extend `create-sub-agent`'s family
  with an `update-sub-agent` path or a new function reusing its auth logic).
- **Unit Manager only:** promote/demote the Unit Admin flag on any unit
  member; delete members via the existing `delete-agent` edge function
  (which keeps its open-enquiries orphan guard).
- Row badges use the glossary labels.
- Edge functions gain caller checks: caller resolved from JWT → `agents` row;
  target must be in the caller's unit; deputy callers are rejected when the
  target is a deputy or the root, and when the payload touches
  `is_unit_manager`.
- RLS: agents-table update policy tightened to match the matrix (today
  deputies' write scope is broader than the matrix allows).

### 2. Unit dashboard — Team Report by event

Add a campaign selector to `TeamReport.tsx` (default **All events**); all
stats and the attendee breakdown filter to the selected campaign.

### 3. Unit dashboard — Partnership

- **Per-agent enquiry drill-down:** clicking an agent (from My Agents or the
  enquiries view) opens a page listing that agent's enquiries — the
  MyEnquiries list scoped to one agent. Unit-viewer gated; route like
  `/my-agents/$agentId/enquiries`.
- **Reassign enquiry** to another agent in the unit (resigned-agent case).
  Reuses the admin reassignment RPC (`PR #20`) with a second authorization
  path: caller is a unit viewer AND both the enquiry's current agent (or the
  enquiry itself, if untied) and the target agent belong to the caller's
  unit.
- **Mark as renewed** (date-only — client explicitly declined gift
  issuance): button on a vehicle row, visible to the enquiry's own agent and
  unit viewers. Sets `insurance_expiry_date = insurance_expiry_date + 1
  year`, clears `reminder_sent_at` (re-arms next year's reminder), stamps
  `renewed_at` / `renewed_by` (new columns) for audit. Does **not** touch
  gift/ledger tables — the gold gift remains merchant-confirmed only
  (`confirm_vehicle_renewal` unchanged). Skipped for vehicles the customer
  removed (`removed_at IS NOT NULL`).
- **General search** on My Enquiries: single input filtering client-side by
  customer name, car plate, NRIC, phone (normalized matching for NRIC/phone,
  same normalization helpers as checkout).

### 4. Admin dashboard

- **Attendees report date range:** from/to date pickers filtering the
  on-screen attendees list and the CSV export (filter on check-in time).
- **Unit links:** the Unit Manager (root) gets **no personal enquiry link** —
  hidden from the agent portal (My Enquiry Link page/nav for roots) and
  excluded from admin/agent link listings. Unit Admins and Unit Agents keep
  theirs. Existing root links are deactivated by migration.
- **Master admin per-agent drill-down:** same agent → enquiries page pattern
  as item 3, admin-wide (from the admin agent list / enquiries view).
- **Partner summary report:** new Reports tab mirroring Team Performance,
  per partner: enquiry counts by status, confirmed renewals, gift totals,
  date-range filtered.
- **Searchable dropdowns:** shared combobox component (type-to-filter) in
  `shared-ui`, replacing long `Select` lists in the Branch-links modal —
  both admin portal and unit dashboard occurrences.
- **Enquiries search input** in the admin Enquiries list (same fields as the
  unit-side search).

### 5. Enquiry form — thank-you page shows the agent

After submission the thank-you screen shows **agent name + contact number**:

- **Agent-link submissions:** link owner's name (already in the anon link
  context) and phone (added to the link-resolution RPC return — deliberately
  public; the customer is meant to contact them).
- **Branch-link submissions:** the auto-assigned agent (partner's tied
  agent) name + phone, returned by `submit_enquiry` on success. If no agent
  is tied, keep the current merchant-will-contact-you copy.
- Copy: "Thank you. Your agent **[Name]** will be in touch with your
  quotation soon — you can also reach them at **[phone]**."

### 6. Enquiry form — unit-level footer image

The enquiry-form footer image is currently admin-only
(`system_settings.enquiry_form.footer_image_url`, with round-5 per-partner
design overrides). Units get their own:

- Unit viewers (Unit Manager + Unit Admins) can upload/clear a footer image
  from the unit dashboard (same size guidance as admin: 1600x200, 8:1;
  stored in the existing assets bucket).
- Stored as a form-override JSON on the **unit root** agent row (absent keys
  fall back), mirroring the round-5 partner-override pattern.
- Resolution precedence on the public form: **Partner > Unit > Admin** —
  most-specific wins; the unit is resolved from the link's agent (agent
  links) or the branch's tied agent (branch links). Resolved in the same
  merge helper the form already uses, so events forms are unaffected.

### 7. Verification item (no build unless broken)

Client question: "if a partner is assigned to a unit agent, when anyone
registers, is the enquiry directly assigned under that agent?" Verify on
staging; fix only if broken. (Item 5's branch-link agent display depends on
this working.)

## Out of scope

- Renaming the `agent_admin` role value in the DB.
- Any change to gift issuance / `confirm_vehicle_renewal`.
- Merchant-portal changes.

## Security notes

- All new unit-management powers enforced server-side (edge fn caller checks
  + RLS), mirroring the round-4 deputy hardening.
- Agent phone exposure on the public thank-you page is intentional and
  limited to name + phone of the single relevant agent; the RPCs return only
  those fields.
- `mark as renewed` must be writable only by the enquiry's agent or unit
  viewers of that agent's unit (RLS or RPC check), never anon.

## Rollout

One branch/PR (`feat/partnership-round-6`), staging first (DB + edge fns +
`feat/merchant-partnership` fast-forward), client verification, then prod
(MCP `apply_migration` + edge fn deploys + merge to `main`).
