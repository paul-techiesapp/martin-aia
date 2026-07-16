# Customer Agent Reassignment & Customer Self-Serve Vehicle List

**Date:** 2026-07-16
**Status:** Approved design, pending implementation plan

## Summary

Two related additions to the merchant partnership subsystem:

1. **Admin reassigns a customer's agent.** When an agent resigns, an admin moves that
   agent's live customers to another agent so the relationship is maintained.
2. **Customer self-serve vehicle list.** Each customer gets a permanent, unauthenticated
   URL where they can view, add and remove their own cars.

Both are keyed on the customer's normalized NRIC, which is the closest thing to a customer
identity this schema has.

## Context: there is no customer entity

Customer identity is fully denormalized onto `enquiries` (`customer_name`, `customer_nric`,
`customer_nric_normalized`, `customer_phone`, `customer_email`). Every form submission mints
a new, unrelated enquiry row; two submissions by the same person are linked only by a
matching NRIC string. There is no `customers` table and no `customer_id` anywhere.

`enquiry_vehicles` hangs off `enquiry_id` only — it has no path to a customer except through
its parent enquiry.

`enquiries.agent_id` is written exactly once, at insert time inside `submit_enquiry`, derived
from the link code. No RPC changes it today.

**Decision (accepted trade-off):** do not introduce a `customers` table. "Customer" means
"all enquiries sharing a `customer_nric_normalized`". This keeps the migration small and
avoids a backfill over live production data.

The known cost, accepted knowingly: `customer_portal_tokens` (below) is keyed on
`nric_normalized` with no foreign key, so it is effectively a one-column customer table
without referential integrity. Nothing prevents an enquiry from drifting to an NRIC that no
token points at, and every customer-level query is a group-by on a text column. Revisit if a
third customer-level feature appears.

## Requirements

### Feature 1 — Admin reassigns customer's agent

1. Admin can move a customer from one agent to another, identified by the customer's NRIC.
2. **Only open work moves.** An enquiry moves only if it has at least one vehicle in
   `submitted` or `quoted`. Enquiries whose vehicles are all `renewed`/`lost` keep their
   original `agent_id`, so historical reports and recorded renewal credit do not shift
   retroactively away from the agent who closed them.
3. The target agent must exist and be `status = 'active'`.
4. The action is audited: who moved which NRIC, from which agent to which, when, and how
   many enquiries moved.
5. Orphaned customers (`agent_id IS NULL`, see below) are reassignable through the same path.

### Feature 2 — Customer self-serve vehicle list

1. Each customer (NRIC) has one permanent link: `/public/my-cars/$token`.
2. No authentication. The token alone grants access.
3. The customer can **view** their cars, **add** a car, and **remove** a car.
   Editing an existing car is out of scope.
4. NRIC is masked on the page (last 4 characters only), so a leaked link does not disclose a
   full IC.
5. Admin can revoke a token.
6. Agents (own/unit customers) and admins can copy the link from their portals. No email or
   WhatsApp delivery in this scope.

## Database Changes

### Migration: token table

```sql
CREATE TABLE customer_portal_tokens (
  token           text PRIMARY KEY,
  nric_normalized text NOT NULL UNIQUE,
  created_at      timestamptz NOT NULL DEFAULT now(),
  revoked_at      timestamptz
);

ALTER TABLE customer_portal_tokens ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admin full access" ON customer_portal_tokens
  FOR ALL TO authenticated USING (is_admin());
-- NO anon policies: anon reaches this table only through SECURITY DEFINER RPCs,
-- matching the rule established in 20260627000002_merchant_enquiries.sql.
```

Token generation is server-side: `replace(gen_random_uuid()::text, '-', '')`, matching
`ensure_my_enquiry_link()`. It is deliberately not minted in the browser, unlike
`branch_links.link_code`.

### Migration: vehicle soft-delete

```sql
ALTER TABLE enquiry_vehicles
  ADD COLUMN removed_at          timestamptz,
  ADD COLUMN removed_by_customer boolean NOT NULL DEFAULT false;
```

### Migration: reassignment audit

```sql
CREATE TABLE customer_agent_reassignments (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nric_normalized text NOT NULL,
  from_agent_id   uuid REFERENCES agents(id) ON DELETE SET NULL,
  to_agent_id     uuid REFERENCES agents(id) ON DELETE SET NULL,
  enquiry_count   int NOT NULL,
  reassigned_by   uuid NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE customer_agent_reassignments ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admin full access" ON customer_agent_reassignments
  FOR ALL TO authenticated USING (is_admin());
```

`from_agent_id` records the agent on the newest matching enquiry at the time of the move. It
is a record of intent, not a per-row history; a customer split across two agents is an edge
case the count plus the audit row is enough to explain.

## RPCs

All are `SECURITY DEFINER` with `SET search_path = public`, matching existing convention.

### `reassign_customer_agent`

```sql
reassign_customer_agent(p_nric_normalized text, p_new_agent_id uuid) RETURNS int
-- GRANT EXECUTE TO authenticated
```

- Requires `is_admin()`, else `42501`.
- Requires target agent to exist and be `active`, else `P0011`.
- Updates `enquiries` where `customer_nric_normalized = p_nric_normalized` AND an
  `EXISTS` subquery finds a vehicle in `('submitted','quoted')` that is not removed.
- Inserts one `customer_agent_reassignments` row.
- Returns the number of enquiries moved (0 is a valid, non-error result).

### `ensure_customer_portal_token`

```sql
ensure_customer_portal_token(p_enquiry_id uuid) RETURNS text
-- GRANT EXECUTE TO authenticated
```

Get-or-create, mirroring `ensure_my_enquiry_link()`. Caller must be `is_admin()`, or the
enquiry's owning agent, or a unit viewer of that agent (`unit_member_ids()`), else `42501`.
Resolves the NRIC from the enquiry, then returns the existing token or mints one.

Revoked tokens are not silently reissued: if a token exists but is revoked, the RPC returns
it as-is and the UI shows it as revoked. Reissuing is an explicit admin action.

### `get_customer_cars`

```sql
get_customer_cars(p_token text)
  RETURNS TABLE (customer_name text, nric_masked text, vehicles jsonb)
-- GRANT EXECUTE TO anon
```

Token must exist and have `revoked_at IS NULL`, else `P0012`. Reads the customer's name from
their newest enquiry. Returns non-removed vehicles across all enquiries for that NRIC, each
with plate, insurance expiry, status and road-tax flag. NRIC is masked to the last 4
characters. Phone and email are never returned.

### `customer_add_vehicle`

```sql
customer_add_vehicle(
  p_token text, p_car_plate text, p_insurance_expiry_date date,
  p_insurance_product_id uuid, p_road_tax_renewal boolean
) RETURNS uuid
-- GRANT EXECUTE TO anon
```

Landing rule:

1. Find the newest enquiry for that NRIC with `status = 'open'`.
2. If found, insert the vehicle against it.
3. If not found, insert a new enquiry copying `agent_id`, `merchant_id`, `branch_link_id`
   and `merchant_branch_id` from the customer's newest prior enquiry, then insert the vehicle
   against that.

Normalizes the plate with the same expression used in `submit_enquiry`. Vehicle status
defaults to `submitted`. `p_insurance_product_id` is nullable — `enquiry_vehicles.insurance_product_id`
dropped its NOT NULL in `20260629000001_optional_insurance_product.sql`, so the customer may
add a car without naming a product. The new vehicle's `merchant_branch_id` and `merchant_id`
are copied from the enquiry it lands in, which may legitimately be NULL on the agent path.

**The NRIC 1-month dedup window deliberately does not apply here.** That guard lives inside
`submit_enquiry` and exists to stop repeat gold-form *registrations*. An existing customer
adding a second car is not a new registration. This is intentional, not an oversight.

No agent notification is sent in this scope. `notify_agent_enquiry` sends a "new enquiry"
email that would misdescribe an added car. Noted as a possible follow-up.

### `customer_remove_vehicle`

```sql
customer_remove_vehicle(p_token text, p_vehicle_id uuid) RETURNS void
-- GRANT EXECUTE TO anon
```

Token must be valid. The vehicle must belong to an enquiry with that NRIC, else `P0012` —
this is what stops a token holder from removing someone else's car by guessing an id.
Refuses when status is `renewed` or `lost` (`P0013`): those have a gift voucher and a
merchant settlement attached. Sets `removed_at = now()`, `removed_by_customer = true`.
Closes the parent enquiry if no non-terminal, non-removed vehicle remains.

## The `removed_at` ripple

Soft-delete is not local. Every site that counts or lists vehicles must exclude removed rows,
or it returns wrong numbers rather than an error. Each is a distinct implementation task:

| Site | Required change |
|---|---|
| `confirm_vehicle_renewal` enquiry-close logic | Removed vehicles must not block close |
| `record_quotation` | Refuse a removed vehicle |
| `mark_vehicle_lost` | Refuse a removed vehicle |
| Expiry reminders (`20260628000020_expiry_reminders.sql`) | Must not remind on a removed car |
| `merchant_branch_leads` | Exclude removed from merchant lead lists |
| Agent portal My Enquiries | Hide removed |
| Admin portal Enquiries | Show removed, visibly marked "Removed" |

## Frontend Changes

### `apps/public-pages`

- New route `/public/my-cars/$token` in `src/router.tsx`.
- New page `src/pages/MyCars.tsx`: masked identity header, car list with status, add-car form,
  remove-car with confirmation. Reuses the existing `Enquiry.tsx` form patterns and
  `useEnquiryFormSettings` branding.
- Invalid or revoked token renders a neutral "link is no longer valid" page. It must not
  disclose whether the token ever existed.

### `apps/agent-portal`

- My Enquiries: "Copy my-cars link" per customer, calling `ensure_customer_portal_token`.
  Follows the existing copy-to-clipboard pattern in `MyLinks.tsx`.
- My Enquiries: exclude removed vehicles.

### `apps/admin-portal`

- Enquiries: "Copy my-cars link" (the fallback path when the agent has resigned and cannot
  share it — the primary reassignment scenario).
- Enquiries: "Reassign agent" action opening a dialog that names the target agent, states
  that **all open enquiries for this IC** move, and shows the count before confirming.
- Enquiries: show removed vehicles marked "Removed".
- Revoke-token action.

### `packages/shared-types`

Add `removed_at` / `removed_by_customer` to the `enquiry_vehicles` type; add
`customer_portal_tokens` and `customer_agent_reassignments` types.

## Related fix: orphaned customers on agent delete

`enquiries.agent_id` is `ON DELETE SET NULL`, and agent deletion is now a hard delete
(`delete-agent` removes the `auth.users` row and cascades). An admin who deletes a resigned
agent **before** reassigning silently sets every one of that agent's customers to
`agent_id = NULL` — invisible in all agent portals, with no record of the prior owner.

Reassignment still works on orphans because it keys on NRIC, not on the old agent. But the
delete flow should warn when the agent still owns enquiries with open vehicles, and say how
many. Included in scope as a guard on the delete path; it is the failure mode this whole
feature exists to prevent.

## Error Codes

| Code | Meaning |
|---|---|
| `42501` | Caller not authorized (not admin / not the owning agent) |
| `P0011` | Target agent missing or not active |
| `P0012` | Invalid, revoked, or non-matching customer token |
| `P0013` | Cannot remove a vehicle that is renewed or lost |

`P0009` (NRIC already registered this month) is unchanged and remains confined to
`submit_enquiry`.

## Testing

This repo has no test runner; validation is `pnpm -r typecheck` plus `pnpm build`, with
behavior verified against the staging Supabase project (`lyjdlietzmmejrxjvwgp`).

Per-RPC manual verification against staging:

- `reassign_customer_agent`: moves only open enquiries; leaves renewed/lost with the old
  agent; refuses a non-admin caller; refuses an inactive target; writes one audit row;
  returns 0 without error for an unknown NRIC.
- `get_customer_cars`: valid token returns masked NRIC and no phone/email; revoked token
  raises `P0012`.
- `customer_add_vehicle`: lands on the newest open enquiry; creates an inheriting enquiry
  when none is open; succeeds for an NRIC inside the 1-month window (confirming the window
  does not apply).
- `customer_remove_vehicle`: hides from the customer list but stays visible to admin;
  refuses a renewed vehicle; refuses a vehicle belonging to a different NRIC; closes the
  enquiry when the last open car goes.
- Ripple: a removed vehicle does not block enquiry close, is not reminded on, and does not
  appear in `merchant_branch_leads`.

## Deployment

Follows the established order for this project:

1. Apply migrations to staging (`lyjdlietzmmejrxjvwgp`), verify.
2. Apply to production via MCP `apply_migration` — **not** `supabase db push`, which would
   break prod migration history.
3. Merge, letting Render auto-deploy the three frontends.

Database goes before frontend merge, since the new pages call RPCs that must already exist.

## Out of Scope

- Editing existing vehicle details (add and remove only).
- Email or WhatsApp delivery of the my-cars link (copy-to-clipboard only).
- Agent notification when a customer self-adds a car.
- Token expiry (permanent, revocable).
- A real `customers` table (see the accepted trade-off above).
