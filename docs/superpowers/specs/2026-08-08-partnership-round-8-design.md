# Partnership Round 8 — Source-Locked Leads, Partner Staff Visibility, Unit-Scoped Events

**Date:** 2026-08-08
**Branch:** `feat/partnership-round-8`, cut from `main` (rounds 6+7 and both August hotfixes are merged).

## Problem

Five items came out of the 2026-08-08 feedback round.

**1. Reassigned partner leads look like they came from nowhere.**

Reported with a screenshot: Jessica reassigned two leads (Teechunyin / WWP 4176, Zita Aizan Binti Ahmad /
BRC2790) to another agent. Both leads originated from the Poh Kong Shah Alam branch link, but in the new
agent's My Enquiries the Partner column shows an empty "Assign partner" dropdown and nothing on the card
names the source. The client's words: *"I am unable to know the source of the leads nor is the leads
supposed to lock for Poh Kong by default."*

Root cause — the data is not lost and reassignment is not the culprit:

| Fact | Where | Value after reassignment |
| --- | --- | --- |
| Source partner | `enquiries.merchant_id` | set by `submit_enquiry` (branch path) |
| Source branch | `enquiries.merchant_branch_id` | set by `submit_enquiry` |
| Per-car partner | `enquiry_vehicles.merchant_id` | **NULL — never written at submit** |
| Owning agent | `enquiries.agent_id` | the only column `reassign_customer_agent` touches |

`submit_enquiry` (`supabase/migrations/20260706000009_enquiry_nric_dedup_window.sql:51-67`) writes
`merchant_branch_id` onto each car but leaves the car's `merchant_id` NULL. The agent lead card
(`apps/agent-portal/src/pages/MyEnquiries.tsx:310-368`) renders the per-car partner only, and the card
header (lines 261-294) never renders the enquiry-level source even though `useMyEnquiries` already selects
`merchant:merchants(id, name)` and `branch:merchant_branches(name, merchant:merchants(name))`
(`apps/agent-portal/src/hooks/useMyEnquiries.ts:39-45`).

So the lead has always been partner-less at car level; reassignment merely moved it to someone who had no
other way of knowing where it came from.

A second, latent defect sits behind it. `merchant_available_to_agent()`
(`20260711000001_partner_scope_unit_actions.sql`) lets an agent assign a partner only when it is
`is_master`, their own proposal, or one they hold a branch link to. A reassigned agent typically has none of
those relationships with the source partner, so for a non-master source partner the dropdown cannot even
offer the correct answer. Poh Kong happens to be `is_master` (backfilled from its portal login), which is the
only reason the client's example is merely confusing rather than impossible.

**2. Agents cannot see which partner staff sent a lead.**

Admin's enquiry list shows `Staff ID: AIDA` beside the customer's phone and the partner name (POH KONG).
The agent portal shows neither. The client wants the agent side to match so agents can contact the staff
member who referred the customer.

**3. Staff ID is optional everywhere.**

`submit_enquiry`'s `p_staff_id` is optional and the public form labels the field "Referring staff ID
(optional)" (`apps/public-pages/src/pages/Enquiry.tsx:497-511`). Poh Kong needs it mandatory. Other partners
must stay optional.

**4. "My Link" appears for the wrong role.**

`buildAgentGroups` (`apps/agent-portal/src/components/Layout.tsx:37-40`) hides the Partnership → My Link
item when `isRoot` (role `agent_admin`, displayed as **Unit Manager**) and shows it to everyone else,
including deputies flagged `is_unit_manager` (displayed as **Unit Admin**). The client wants the opposite:
Unit Managers get the enquiry QR, Unit Admins do not.

This inversion is a leftover from round 6 item 5, which removed the unit root's personal enquiry link. That
decision was reversed on 2026-08-02 (`20260802000001_restore_unit_root_enquiry_links.sql`, PR #24) after
printed root QR codes went dead mid-fair — the link codes came back but the nav item did not.

**5. Every agent sees every event.**

`CREATE POLICY "Agents read active campaigns" ON campaigns FOR SELECT TO authenticated USING (status =
'active')` (`20260201000001_rls_policies.sql:33`) is unconditional, and `useCampaigns` filters on status
only. An event run for one unit is browsable and linkable by every agent in the system. The client wants
each event accessible only to the unit(s) assigned to it.

## Out of scope

- Partner contact directory in the agent portal (contact person/phone/branch address). `MyPartners` already
  shows `contact_person` / `contact_phone`; enriching it further was offered and not chosen.
- Any change to public registration, check-in/out, invitation tokens, or already-issued agent links.
- Retro-fixing money records. No gift, settlement or commission row is created, moved or recalculated by
  this round.

---

## Item 1 — Branch leads lock to their source partner

### Behaviour

A lead submitted through a **partner branch link** is owned by that partner from the moment it arrives:

- Every car on the enquiry gets `merchant_id` = the branch's merchant at submit time.
- The agent portal renders that partner as fixed text (partner name + branch), with no dropdown and no
  Assign button.
- Only an admin, or a user with unit-wide view, may change it.

A lead submitted through an **agent's own enquiry link** is unchanged: no source partner, agent picks
freely from the partners available to them.

### Changes

**`submit_enquiry`** (new migration, body copied from `20260706000009` with two edits): the
`enquiry_vehicles` INSERT gains `merchant_id` = `v_merchant_id`, which is NULL on the agent path and the
branch's merchant on the branch path. Because the enquiry-level `assigned_at` is already stamped on the
branch path, no other column changes.

**`assign_vehicle_merchant`** (`20260711000001`, recreated): before the UPDATE, look up the vehicle's
enquiry. If `e.merchant_branch_id IS NOT NULL` and the caller is neither `is_admin()` nor `is_unit_viewer()`,
raise `P0021` ("this lead is locked to the partner it came from"). Admin and unit viewers keep the existing
`merchant_available_to_agent()` check, widened by one clause: **an enquiry's own source merchant is always
assignable on that enquiry**. Without it, a unit viewer who moved a car off a non-master source partner
could never move it back — the latent defect described under Problem 1. New leads never depend on that
clause, since `submit_enquiry` seeds the source itself as SECURITY DEFINER and bypasses the check entirely.

**Admin's path is the one it already has.** Admins never call `assign_vehicle_merchant` (it requires
`get_agent_id()`); they set a car's partner in the renewal-confirmation dialog, which passes
`p_merchant_id` to `confirm_vehicle_renewal` and overwrites the column. That dialog pre-fills from
`v.merchant_id ?? enquiry.merchant_id` (`EnquiryDetail.tsx:152`), so seeding the source improves it. No new
admin control is built.

**Override reach:** `is_unit_viewer()` — the unit root (Unit Manager) *and* deputies flagged
`is_unit_manager` (Unit Admin). The client asked for "Admin + Unit Manager"; deputies are included because
mid-level managers carry that flag and run real teams (the 2026-08-04 incident class), and excluding them
would strand a manager who cannot escalate.

**Agent portal** (`MyEnquiries.tsx`): when `enq.merchant_branch_id` is set, the Partner cell renders the
locked partner as text for plain agents. Unit viewers and the existing `readOnly` path behave as today
(dropdown for unit viewers, text for read-only).

**Backfill** (same migration, one-time UPDATE): cars with `merchant_id IS NULL`, `removed_at IS NULL` and
`status IN ('submitted','quoted')` inherit `enquiries.merchant_id` where the enquiry has a
`merchant_branch_id`. Renewed and lost cars are deliberately excluded — their partner was decided at
confirmation time and any gift/settlement row already points at it.

### Why this cannot misdirect money

`confirm_vehicle_renewal` (`20260716000004_removed_at_ripple.sql`) takes `p_merchant_id` as an explicit
admin-supplied parameter, validates it, then **overwrites** `enquiry_vehicles.merchant_id` and writes the
gift and settlement against the parameter — never against the pre-existing column. Seeding the column early
therefore changes what agents see and who may edit it, not who gets paid.

---

## Item 2 — Staff ID and source on the agent lead card

The lead card header gains one muted line, shown only when there is something to show:

```
Staff ID: AIDA · Poh Kong — Shah Alam Branch
```

Source resolves from the already-fetched `enq.branch` (branch name + its merchant name), falling back to
`enq.merchant.name` when the branch join is absent (v2 generic-link enquiries). Staff ID comes from
`enquiries.staff_id`, already present via `select *`. No query, hook or type changes.

---

## Item 3 — Staff ID mandatory per partner

A boolean `staff_id_required` in `merchants.form_settings` — the same JSONB the per-partner form design
already occupies (`20260711000001`). Absent or `false` = optional, matching today.

- **Admin:** a switch in the partner's Form Design card (`MerchantDetail.tsx`). **`handleSave` currently
  strips every non-string value** (`Object.entries(draft).filter(([, v]) => typeof v === 'string' && ...)`,
  line 249-251) — it must preserve booleans, or the toggle will silently fail to save.
- **Public form:** `get_enquiry_context` already returns `merchant_form_settings`, so `Enquiry.tsx` reads
  the flag it already fetches. When set, the field label drops "(optional)", gains a required marker, and
  the zod schema requires a non-empty value on the branch path.
- **Server:** `submit_enquiry` enforces it on the branch path only — when the resolved merchant's
  `form_settings->>'staff_id_required'` is true and the trimmed `p_staff_id` is empty, raise `P0020`
  ("Staff ID is required"). Client-side validation alone would be bypassable by a direct RPC call.

---

## Item 4 — "My Link" moves to Unit Manager

`buildAgentGroups` takes the deputy flag instead of `isRoot`: the Partnership → My Link item is shown to
unit roots and plain agents, hidden for deputies (`is_unit_manager === true` and not the root).

**Explicitly not done:** no `enquiry_link_code` is cleared, deactivated, or regenerated, and the `/my-link`
route stays registered. A deputy who has already printed a QR keeps a working code, and submissions through
it continue to land in their My Enquiries. Nulling link codes is precisely the 2026-08-02 incident and is
not repeated here.

---

## Item 5 — Events scoped to assigned units

### Model

```sql
CREATE TABLE campaign_units (
  campaign_id   uuid NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  unit_agent_id uuid NOT NULL REFERENCES agents(id)    ON DELETE CASCADE,
  PRIMARY KEY (campaign_id, unit_agent_id)
);
```

`unit_agent_id` points at a **unit head** — a top-level unit root, or a mid-level manager who heads a
sub-unit. An event assigned to a head is visible to that head and everyone beneath them.

### Visibility

New helper, the upward mirror of `unit_member_ids()`:

```sql
agent_ancestor_ids() -- caller's own agent id + every ancestor, walking
                     -- parent_agent_id upward, depth-capped at 50
```

The campaigns SELECT policy for agents becomes:

```
status = 'active'
AND (
  NOT EXISTS (SELECT 1 FROM campaign_units cu WHERE cu.campaign_id = campaigns.id)
  OR EXISTS (SELECT 1 FROM campaign_units cu
             WHERE cu.campaign_id = campaigns.id
               AND cu.unit_agent_id IN (SELECT agent_ancestor_ids()))
)
```

**Zero assignments means visible to everyone.** Every event in production has zero assignments the moment
this migration lands, so nothing disappears; restriction begins only when an admin assigns units. This is
the same default-open discipline the 2026-08-04 recursive-scope fix restored.

The ancestor walk is recursive by construction. Flat `COALESCE(parent_agent_id, id)` unit derivation is not
reintroduced anywhere — that assumption is what broke mid-level managers on 2026-08-04.

`campaign_units` itself is admin-write / authenticated-read, with the same `is_admin()` pattern used by the
other campaign child tables.

### Admin UI

The campaign create/edit form gains a **Units** multi-select listing unit heads by unit name (sourced from
the existing `useAgents` query, which already returns `parent_agent_id IS NULL OR is_unit_manager = true`).
Empty selection is valid and means "all units". Selections save alongside the campaign as a replace-all diff
on `campaign_units`.

### Blast radius

- **Agent portal:** no code change. RLS filters `useCampaigns`, and slots/links hang off campaigns, so a
  hidden event yields no slots and no new links.
- **Public pages:** untouched. Registration, check-in/out and invitation flows read campaigns through the
  separate anon policy.
- **Already-issued links:** keep working. Assigning units to a running event removes it from other agents'
  browse and stops them creating *new* links; it does not invalidate links already handed out or
  registrations already taken.
- **Admin:** unaffected — `is_admin()` has its own FOR ALL policy.

---

## Deployment

Independent items; ship as one branch, one PR.

1. Migrations applied to **staging** (`lyjdlietzmmejrxjvwgp`) first, verified, then **prod**
   (`mjtdsevynrtcmafsnxsj`) via MCP `apply_migration` — never `supabase db push`.
2. DB lands before the frontend merges, as in rounds 5–7.
3. RLS and SECURITY DEFINER checks are verified by impersonation (`set_config` with a real JWT claim set),
   not by calling the RPCs through MCP's claim-less connection, which returns empty for every unit-scoped
   query regardless of correctness.
4. Verification per item: a branch-link submission locks its cars and refuses an agent reassignment
   (`P0021`); the backfill count is reported before and after; a Poh Kong submission without a Staff ID is
   rejected with `P0020` while another partner's is accepted; a deputy login shows no My Link item while
   their existing link code still resolves; an event with no units stays visible to all agents, and an event
   assigned to one unit is invisible to an agent outside it and visible to a grandchild inside it.
