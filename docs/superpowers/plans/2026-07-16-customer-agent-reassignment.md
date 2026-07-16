# Customer Agent Reassignment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let an admin move a customer's open partnership work from one agent to another, so a resigning agent's customers stay serviced.

**Architecture:** There is no `customers` table — a "customer" is every `enquiries` row sharing a `customer_nric_normalized`. A new admin-only `SECURITY DEFINER` RPC updates `enquiries.agent_id` for that NRIC, but only for enquiries that still have a `submitted`/`quoted` vehicle, so past renewal credit stays with the agent who earned it. Each call writes one audit row. The admin Enquiries list gets an Actions column with a reassign dialog.

**Tech Stack:** PostgreSQL 15 (Supabase), plpgsql, React 18 + TypeScript, TanStack Query, shadcn/ui via `@agent-system/shared-ui`, Deno edge functions.

**Spec:** `docs/superpowers/specs/2026-07-16-customer-agent-reassign-and-self-serve-design.md`

## Global Constraints

- **Branch-guard every commit.** This repo's working tree is shared across concurrent workflows and HEAD has thrashed before. Run `git branch --show-current` and confirm it is `feat/customer-agent-reassign-and-self-serve` before every `git commit`.
- **No test runner and no eslint in this repo.** Validation is `pnpm -r typecheck` + `pnpm --filter <app> build`, plus SQL assertions run against the staging database. Do not add a test framework.
- **Keep all packages on zod 3.23.8.** Do not run `pnpm add`; it re-trips a known dual-zod tsc failure in `Account.tsx`.
- **Migration naming:** `20260716000001_<snake_case>.sql`. Latest existing is `20260711000001_partner_master_scope.sql`.
- **Migration header style:** plain `--` rationale narrative naming the round/item, explaining what was wrong before and stating the new invariant. No banner separators.
- **SQL function boilerplate:** `CREATE OR REPLACE FUNCTION` + `LANGUAGE plpgsql` + `SECURITY DEFINER` + `SET search_path = public`, closed with `GRANT EXECUTE ON FUNCTION <name>(<argtypes>) TO authenticated;`.
- **Staging Supabase project:** `lyjdlietzmmejrxjvwgp`. **Production:** `mjtdsevynrtcmafsnxsj`. Apply production migrations via MCP `apply_migration` — **never** `supabase db push`, which would break prod migration history.
- **Error codes:** `42501` authz, `22023` empty NRIC, `P0011` target agent invalid. `P0010` is taken (checkout OTP). Do not reuse `P0002`/`P0008` — both are already double-booked.
- **Admin identity is `app_metadata`,** never `user_metadata`. Use `is_admin()` in SQL; in edge functions check `caller.app_metadata?.role !== "admin"`.

---

### Task 1: Migration — audit table + `reassign_customer_agent` RPC

**Files:**
- Create: `supabase/migrations/20260716000001_customer_agent_reassignment.sql`
- Verify against: staging Supabase `lyjdlietzmmejrxjvwgp`

**Interfaces:**
- Consumes: `is_admin()` (`20260613000001_admin_role_app_metadata.sql:16`), `agents`, `enquiries`, `enquiry_vehicles`.
- Produces: `reassign_customer_agent(p_customer_nric text, p_new_agent_id uuid) RETURNS int` and table `customer_agent_reassignments`. Task 3's hook calls this RPC with exactly these parameter names.

- [ ] **Step 1: Write the migration**

Create `supabase/migrations/20260716000001_customer_agent_reassignment.sql`:

```sql
-- Admin reassignment of a customer from one agent to another (agent resignation).
--
-- enquiries.agent_id was write-once: submit_enquiry set it from the link code and
-- nothing ever changed it. When an agent resigned there was no supported way to
-- hand their customers to someone else, and because enquiries.agent_id is
-- ON DELETE SET NULL, deleting the resigned agent silently orphaned every one of
-- their customers to agent_id NULL — invisible in every agent portal.
--
-- There is no customers table: a "customer" is every enquiries row sharing a
-- customer_nric_normalized. So reassignment keys on the NRIC, which also means it
-- still works on already-orphaned customers.
--
-- Only OPEN work moves. An enquiry moves only if it still has a submitted/quoted
-- vehicle. Enquiries whose vehicles are all renewed/lost keep their original
-- agent_id, so historical reports and recorded renewal credit are not rewritten
-- away from the agent who actually closed them.

CREATE TABLE customer_agent_reassignments (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nric_normalized text NOT NULL,
  from_agent_id   uuid REFERENCES agents(id) ON DELETE SET NULL,
  to_agent_id     uuid REFERENCES agents(id) ON DELETE SET NULL,
  enquiry_count   int NOT NULL,
  reassigned_by   uuid NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_customer_agent_reassignments_nric
  ON customer_agent_reassignments (nric_normalized, created_at DESC);

ALTER TABLE customer_agent_reassignments ENABLE ROW LEVEL SECURITY;

-- Admins only. No agent and no anon policy: this is an audit log of an admin action.
CREATE POLICY "Admin full access to customer_agent_reassignments"
  ON customer_agent_reassignments FOR ALL TO authenticated USING (is_admin());

CREATE OR REPLACE FUNCTION reassign_customer_agent(
  p_customer_nric text,
  p_new_agent_id uuid
)
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_nric_norm     text;
  v_from_agent_id uuid;
  v_count         int;
BEGIN
  IF NOT is_admin() THEN
    RAISE EXCEPTION 'Only admins can reassign a customer' USING ERRCODE = '42501';
  END IF;

  -- Same normalization as submit_enquiry (20260706000009). The caller passes the
  -- raw NRIC because the admin client only holds enquiries.customer_nric.
  v_nric_norm := upper(regexp_replace(coalesce(p_customer_nric, ''), '[^a-zA-Z0-9]', '', 'g'));

  -- Without this guard a blank NRIC would match every blank-NRIC customer at once
  -- and reassign all of them in one call.
  IF v_nric_norm = '' THEN
    RAISE EXCEPTION 'Customer NRIC is required' USING ERRCODE = '22023';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM agents WHERE id = p_new_agent_id AND status = 'active'
  ) THEN
    RAISE EXCEPTION 'Target agent not found or not active' USING ERRCODE = 'P0011';
  END IF;

  -- Recorded as the "from" for audit: the agent on the newest matching enquiry.
  SELECT e.agent_id INTO v_from_agent_id
  FROM enquiries e
  WHERE e.customer_nric_normalized = v_nric_norm
  ORDER BY e.created_at DESC
  LIMIT 1;

  UPDATE enquiries e
  SET agent_id = p_new_agent_id,
      updated_at = now()
  WHERE e.customer_nric_normalized = v_nric_norm
    AND EXISTS (
      SELECT 1 FROM enquiry_vehicles v
      WHERE v.enquiry_id = e.id
        AND v.status IN ('submitted', 'quoted')
    );

  GET DIAGNOSTICS v_count = ROW_COUNT;

  INSERT INTO customer_agent_reassignments (
    nric_normalized, from_agent_id, to_agent_id, enquiry_count, reassigned_by
  ) VALUES (
    v_nric_norm, v_from_agent_id, p_new_agent_id, v_count, auth.uid()
  );

  RETURN v_count;
END;
$$;

GRANT EXECUTE ON FUNCTION reassign_customer_agent(text, uuid) TO authenticated;
```

- [ ] **Step 2: Apply to staging**

Apply the migration to staging (`lyjdlietzmmejrxjvwgp`) via the Supabase MCP `apply_migration` tool, name `customer_agent_reassignment`.

Expected: success, no error.

- [ ] **Step 3: Verify the "open work only" rule against staging**

Run this as a single SQL script against staging. It builds an isolated fixture, calls the function body's logic directly (bypassing `is_admin()`, which is verified separately in Step 4), and asserts. It rolls back, leaving no data behind.

```sql
BEGIN;

-- Fixture: two agents, one customer NRIC with two enquiries —
-- one with an open car, one fully renewed.
INSERT INTO agents (id, user_id, name, email, phone, nric, agent_code, unit_name, status)
VALUES
  ('aaaaaaaa-0000-0000-0000-000000000001', gen_random_uuid(), 'Old Agent',
   'old-reassign-test@example.com', '+60100000001', 'RTEST001', 'RTESTOLD', 'Unit R', 'active'),
  ('aaaaaaaa-0000-0000-0000-000000000002', gen_random_uuid(), 'New Agent',
   'new-reassign-test@example.com', '+60100000002', 'RTEST002', 'RTESTNEW', 'Unit R', 'active');

INSERT INTO enquiries (id, agent_id, customer_name, customer_nric, customer_nric_normalized,
                       customer_phone, customer_phone_normalized, status)
VALUES
  ('bbbbbbbb-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000001',
   'Reassign Test', 'S9999999Z', 'S9999999Z', '+60100000009', '60100000009', 'open'),
  ('bbbbbbbb-0000-0000-0000-000000000002', 'aaaaaaaa-0000-0000-0000-000000000001',
   'Reassign Test', 'S9999999Z', 'S9999999Z', '+60100000009', '60100000009', 'closed');

INSERT INTO enquiry_vehicles (enquiry_id, car_plate, car_plate_normalized,
                              insurance_expiry_date, status)
VALUES
  ('bbbbbbbb-0000-0000-0000-000000000001', 'RTEST 1', 'RTEST1', '2027-01-01', 'submitted'),
  ('bbbbbbbb-0000-0000-0000-000000000002', 'RTEST 2', 'RTEST2', '2027-01-01', 'renewed');

-- The UPDATE the RPC performs.
UPDATE enquiries e
SET agent_id = 'aaaaaaaa-0000-0000-0000-000000000002'
WHERE e.customer_nric_normalized = 'S9999999Z'
  AND EXISTS (
    SELECT 1 FROM enquiry_vehicles v
    WHERE v.enquiry_id = e.id AND v.status IN ('submitted', 'quoted')
  );

-- Assert: the open enquiry moved, the renewed one did not.
DO $$
DECLARE v_open uuid; v_closed uuid;
BEGIN
  SELECT agent_id INTO v_open   FROM enquiries WHERE id = 'bbbbbbbb-0000-0000-0000-000000000001';
  SELECT agent_id INTO v_closed FROM enquiries WHERE id = 'bbbbbbbb-0000-0000-0000-000000000002';
  IF v_open <> 'aaaaaaaa-0000-0000-0000-000000000002' THEN
    RAISE EXCEPTION 'FAIL: open enquiry did not move (agent_id=%)', v_open;
  END IF;
  IF v_closed <> 'aaaaaaaa-0000-0000-0000-000000000001' THEN
    RAISE EXCEPTION 'FAIL: renewed enquiry moved but should not have (agent_id=%)', v_closed;
  END IF;
  RAISE NOTICE 'PASS: open moved, renewed stayed';
END $$;

ROLLBACK;
```

Expected: `NOTICE: PASS: open moved, renewed stayed`, then `ROLLBACK`.
If either assertion raises, the predicate is wrong — fix the migration and re-apply before continuing.

- [ ] **Step 4: Verify the guards reject bad input**

```sql
-- Expect: ERROR 42501 "Only admins can reassign a customer"
-- (run while authenticated as a NON-admin, e.g. via the agent@test.com token)
SELECT reassign_customer_agent('S9999999Z', 'aaaaaaaa-0000-0000-0000-000000000002');

-- Expect: ERROR 22023 "Customer NRIC is required"  (run as admin)
SELECT reassign_customer_agent('   ', '00000000-0000-0000-0000-000000000000');

-- Expect: ERROR P0011 "Target agent not found or not active"  (run as admin)
SELECT reassign_customer_agent('S9999999Z', '00000000-0000-0000-0000-000000000000');
```

Expected: each raises the stated error code. The `22023` check must fire before `P0011`, so the blank-NRIC call reports the NRIC problem rather than the bogus agent.

- [ ] **Step 5: Verify an orphaned customer is still reassignable**

Spec requirement 5: a customer whose agent was already hard-deleted has `agent_id = NULL` and must still be recoverable. Because the predicate keys on NRIC and never mentions the old agent, this should work — confirm it rather than assume.

```sql
BEGIN;

INSERT INTO agents (id, user_id, name, email, phone, nric, agent_code, unit_name, status)
VALUES ('aaaaaaaa-0000-0000-0000-000000000003', gen_random_uuid(), 'Rescue Agent',
        'rescue-reassign-test@example.com', '+60100000003', 'RTEST003', 'RTESTNEW', 'Unit R', 'active');

-- An orphaned customer: agent_id NULL, one open car.
INSERT INTO enquiries (id, agent_id, customer_name, customer_nric, customer_nric_normalized,
                       customer_phone, customer_phone_normalized, status)
VALUES ('bbbbbbbb-0000-0000-0000-000000000003', NULL, 'Orphan Test', 'S8888888Y', 'S8888888Y',
        '+60100000008', '60100000008', 'open');

INSERT INTO enquiry_vehicles (enquiry_id, car_plate, car_plate_normalized,
                              insurance_expiry_date, status)
VALUES ('bbbbbbbb-0000-0000-0000-000000000003', 'RTEST 3', 'RTEST3', '2027-01-01', 'submitted');

UPDATE enquiries e
SET agent_id = 'aaaaaaaa-0000-0000-0000-000000000003'
WHERE e.customer_nric_normalized = 'S8888888Y'
  AND EXISTS (
    SELECT 1 FROM enquiry_vehicles v
    WHERE v.enquiry_id = e.id AND v.status IN ('submitted', 'quoted')
  );

DO $$
DECLARE v_agent uuid;
BEGIN
  SELECT agent_id INTO v_agent FROM enquiries WHERE id = 'bbbbbbbb-0000-0000-0000-000000000003';
  IF v_agent IS DISTINCT FROM 'aaaaaaaa-0000-0000-0000-000000000003' THEN
    RAISE EXCEPTION 'FAIL: orphaned customer was not rescued (agent_id=%)', v_agent;
  END IF;
  RAISE NOTICE 'PASS: orphaned customer reassigned';
END $$;

ROLLBACK;
```

Expected: `NOTICE: PASS: orphaned customer reassigned`, then `ROLLBACK`.

- [ ] **Step 6: Commit**

```bash
git branch --show-current   # must print feat/customer-agent-reassign-and-self-serve
git add supabase/migrations/20260716000001_customer_agent_reassignment.sql
git commit -m "feat(partner): reassign_customer_agent RPC + audit table

Admin-only reassignment of a customer (keyed on normalized NRIC, since
there is no customers table) from one agent to another. Only enquiries
with a submitted/quoted vehicle move, so renewal credit stays with the
agent who closed it. Each call writes one audit row."
```

---

### Task 2: Shared types

**Files:**
- Modify: `packages/shared-types/src/merchant.ts` (add after `EnquiryVehicle`, which ends at line 127, before `Gift` at line 129)

**Interfaces:**
- Consumes: nothing.
- Produces: `CustomerAgentReassignment` interface. Exported automatically — `src/index.ts` re-exports with `export *`, so it needs no edit.

Types for the enquiry domain live in `merchant.ts`, **not** `database.ts`. Convention: hand-written `export interface PascalCase`, snake_case fields mirroring columns, nullable columns as `| null` (never `?`), timestamps as ISO `string`.

- [ ] **Step 1: Add the interface**

Insert into `packages/shared-types/src/merchant.ts` between `EnquiryVehicle` and `Gift`:

```ts
/**
 * Audit row for an admin moving a customer from one agent to another.
 * Keyed on the normalized NRIC because there is no customers table — a
 * "customer" is every enquiry sharing a customer_nric_normalized.
 *
 * Distinct from Enquiry.assigned_at / assigned_by, which record MERCHANT
 * assignment (assign_enquiry_merchant) and are unrelated to agent ownership.
 */
export interface CustomerAgentReassignment {
  id: string;
  nric_normalized: string;
  /** Agent on the customer's newest enquiry at the time of the move; null if orphaned. */
  from_agent_id: string | null;
  to_agent_id: string | null;
  /** How many enquiries actually moved. Zero is valid: no open work to move. */
  enquiry_count: number;
  /** auth.uid() of the admin who performed the move. */
  reassigned_by: string;
  created_at: string;
}
```

- [ ] **Step 2: Typecheck**

Run: `pnpm -r typecheck`
Expected: `packages/shared-types typecheck: Done`, no errors.

- [ ] **Step 3: Commit**

```bash
git branch --show-current   # must print feat/customer-agent-reassign-and-self-serve
git add packages/shared-types/src/merchant.ts
git commit -m "feat(types): CustomerAgentReassignment audit row type"
```

---

### Task 3: Admin hook with P-code translation

**Files:**
- Modify: `apps/admin-portal/src/hooks/useEnquiries.ts` (append; existing mutations end around line 195)

**Interfaces:**
- Consumes: `reassign_customer_agent(p_customer_nric, p_new_agent_id)` from Task 1.
- Produces: `useReassignCustomerAgent()` returning a TanStack mutation whose `mutateAsync({ customerNric, newAgentId })` resolves to `number` (the count moved). Task 4's dialog calls exactly this.

**Why translation lives here:** no admin-portal hook inspects `error.code` today — the universal pattern is `if (error) throw error` and the page toasts the raw Postgres message. This establishes the mapping. Keep it in the hook so the page's catch stays a plain `err.message`, matching every other dialog on the page.

- [ ] **Step 1: Add the error mapper and hook**

Append to `apps/admin-portal/src/hooks/useEnquiries.ts`:

```ts
/**
 * Postgres error codes raised by reassign_customer_agent, mapped to text an
 * admin can act on. Without this the raw plpgsql message reaches the toast —
 * the existing behavior everywhere else in this portal.
 */
function reassignErrorMessage(error: { code?: string; message: string }): string {
  switch (error.code) {
    case '42501':
      return 'Only admins can reassign a customer.';
    case '22023':
      return 'This customer has no IC on record, so they cannot be reassigned.';
    case 'P0011':
      return 'That agent is not active any more. Pick a different agent.';
    default:
      return error.message;
  }
}

/**
 * Moves every OPEN enquiry belonging to this customer's IC to another agent.
 * Enquiries whose cars are all renewed/lost stay with the original agent, so
 * past renewal credit is not rewritten. Resolves to the number moved; 0 means
 * the customer had no open work and is not an error.
 */
export function useReassignCustomerAgent() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      customerNric,
      newAgentId,
    }: {
      customerNric: string;
      newAgentId: string;
    }) => {
      const { data, error } = await supabase.rpc('reassign_customer_agent', {
        p_customer_nric: customerNric,
        p_new_agent_id: newAgentId,
      });
      if (error) throw new Error(reassignErrorMessage(error));
      return (data ?? 0) as number;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['enquiries'] });
    },
  });
}
```

Only `['enquiries']` is invalidated. There is no `['reports']` key in this portal — the report
hooks use `['report-stats']`, `['team-performance']`, `['top-units']`, `['funnel']`, and those
cover event attendance, not partnership enquiries. Inventing a key here would be a silent no-op.

- [ ] **Step 2: Typecheck and build**

Run: `pnpm -r typecheck && pnpm --filter admin-portal build`
Expected: typecheck Done; build `✓ built in ...`.

- [ ] **Step 3: Commit**

```bash
git branch --show-current   # must print feat/customer-agent-reassign-and-self-serve
git add apps/admin-portal/src/hooks/useEnquiries.ts
git commit -m "feat(admin): useReassignCustomerAgent hook with P-code translation"
```

---

### Task 4: Reassign dialog on the admin Enquiries list

**Files:**
- Modify: `apps/admin-portal/src/pages/enquiries/EnquiryList.tsx`

**Interfaces:**
- Consumes: `useReassignCustomerAgent()` (Task 3), `useAllAgents()` (`apps/admin-portal/src/hooks/useAllAgents.ts`, returns `AgentWithTier[]` — all **active** agents including sub-agents, name-sorted).
- Produces: user-facing UI. Nothing downstream depends on it.

**Context the implementer needs:** `EnquiryList.tsx` today has **no mutations, no dialogs, and no Actions column** — it is a read + filter + Excel-download page. This introduces the first. The table has 6 columns (`Customer | Partnership | Agent / Unit | Cars | Status | Received`); adding a 7th means updating **both** the empty-state `colSpan={6}` (~line 183) and `<TableSkeleton rows={6} columns={6} />` (~line 166) to `7`. Copy the state+dialog+toast shape from the "Confirm Renewal" dialog in the sibling `EnquiryDetail.tsx:364-417` — it is the closest analogue (a `<Select>` picker driving a mutation).

- [ ] **Step 1: Add imports, state, and the submit handler**

Add to the imports from `@agent-system/shared-ui`: `Dialog`, `DialogContent`, `DialogHeader`, `DialogTitle`, `DialogDescription`, `DialogFooter`, `Button`, `Label`, `useToast`. Add `import { useAllAgents } from '../../hooks/useAllAgents';` and extend the existing `useEnquiries` import to include `useReassignCustomerAgent` and the `EnquiryListRow` type.

Inside the component, after the existing filter `useMemo`s:

```tsx
const { toast } = useToast();
const { data: allAgents } = useAllAgents();
const reassign = useReassignCustomerAgent();

// Reassign dialog: holds the clicked row (null = closed).
const [reassignTarget, setReassignTarget] = useState<EnquiryListRow | null>(null);
const [reassignAgentId, setReassignAgentId] = useState('');

// How many of this customer's enquiries will actually move: same IC, and at
// least one car still submitted/quoted. Shown before confirming, because the
// admin clicked ONE row and is about to change several.
const reassignImpact = useMemo(() => {
  if (!reassignTarget) return 0;
  const norm = (s: string) => s.replace(/[^a-zA-Z0-9]/g, '').toUpperCase();
  const targetNric = norm(reassignTarget.customer_nric);
  return (enquiries ?? []).filter(
    (e) =>
      norm(e.customer_nric) === targetNric &&
      (e.vehicles ?? []).some(
        (v) => v.status === VehicleStatus.SUBMITTED || v.status === VehicleStatus.QUOTED,
      ),
  ).length;
}, [enquiries, reassignTarget]);

const submitReassign = async () => {
  if (!reassignTarget) return;
  if (!reassignAgentId) {
    toast({ title: 'Select an agent', variant: 'error' });
    return;
  }
  try {
    const moved = await reassign.mutateAsync({
      customerNric: reassignTarget.customer_nric,
      newAgentId: reassignAgentId,
    });
    toast({
      title: moved > 0 ? `Reassigned ${moved} enquiry(s)` : 'Nothing to reassign',
      description:
        moved > 0
          ? 'Completed enquiries stay with the original agent.'
          : 'This customer has no open enquiries.',
    });
    setReassignTarget(null);
    setReassignAgentId('');
  } catch (err: any) {
    toast({ title: 'Failed to reassign', description: err.message, variant: 'error' });
  }
};
```

Ensure `VehicleStatus` is imported from `@agent-system/shared-types` (the file already imports from there for `EnquiryStatus`), and `useState` / `useMemo` from `react`.

- [ ] **Step 2: Add the Actions column**

In the table header row (~line 170-179), append after the `Received` header:

```tsx
<TableHead className="text-right">Actions</TableHead>
```

In the body row, append after the `Received` cell:

```tsx
<TableCell className="text-right">
  <Button
    variant="outline"
    size="sm"
    onClick={() => {
      setReassignTarget(e);
      setReassignAgentId(e.agent_id ?? '');
    }}
  >
    Reassign agent
  </Button>
</TableCell>
```

Update the empty state `colSpan={6}` → `colSpan={7}` and `<TableSkeleton rows={6} columns={6} />` → `<TableSkeleton rows={6} columns={7} />`.

- [ ] **Step 3: Add the dialog**

Add before the component's closing tag:

```tsx
<Dialog
  open={!!reassignTarget}
  onOpenChange={(open) => {
    if (!open) {
      setReassignTarget(null);
      setReassignAgentId('');
    }
  }}
>
  <DialogContent className="max-w-md">
    <DialogHeader>
      <DialogTitle>Reassign customer to another agent</DialogTitle>
      <DialogDescription>
        This moves <strong>every open enquiry</strong> for{' '}
        {reassignTarget?.customer_name} (IC {reassignTarget?.customer_nric}) — not just
        this row. {reassignImpact} enquiry(s) will move. Enquiries whose cars are all
        renewed or lost stay with the original agent.
      </DialogDescription>
    </DialogHeader>
    <div className="space-y-2">
      <Label>New agent</Label>
      <Select value={reassignAgentId} onValueChange={setReassignAgentId}>
        <SelectTrigger>
          <SelectValue placeholder="Select an agent" />
        </SelectTrigger>
        <SelectContent>
          {(allAgents ?? []).map((a) => (
            <SelectItem key={a.id} value={a.id}>
              {a.name} — {a.unit_name} ({a.agent_code})
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
    <DialogFooter>
      <Button variant="outline" onClick={() => setReassignTarget(null)}>
        Cancel
      </Button>
      <Button onClick={submitReassign} disabled={reassign.isPending}>
        {reassign.isPending ? 'Reassigning...' : 'Reassign'}
      </Button>
    </DialogFooter>
  </DialogContent>
</Dialog>
```

- [ ] **Step 4: Typecheck and build**

Run: `pnpm -r typecheck && pnpm --filter admin-portal build`
Expected: typecheck Done; build `✓ built in ...`.

- [ ] **Step 5: Verify in the running admin portal against staging**

Sign in to the admin portal as `admin@test.com` / `@Abc1234` pointed at staging. On Enquiries:
1. Click **Reassign agent** on a customer with an open car. Confirm the dialog names the customer and shows a non-zero count.
2. Pick a different agent, confirm. Expect the success toast and the Agent/Unit cell to update.
3. Reassign a customer whose cars are all renewed. Expect "Nothing to reassign" and no change.

- [ ] **Step 6: Commit**

```bash
git branch --show-current   # must print feat/customer-agent-reassign-and-self-serve
git add apps/admin-portal/src/pages/enquiries/EnquiryList.tsx
git commit -m "feat(admin): reassign a customer's agent from the Enquiries list

Adds the first Actions column on this page. The dialog states that ALL
open enquiries for the IC move and shows the count first, since the admin
clicks one row but changes several."
```

---

### Task 5: Guard agent deletion against orphaning customers

**Files:**
- Modify: `supabase/functions/delete-agent/index.ts` (insert after `agentIds` is computed, ~line 81, before the `partners` query, ~line 84)
- Modify: `apps/admin-portal/src/pages/agents/AgentList.tsx` (delete handler ~line 59-76)

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `delete-agent` gains an optional `force?: boolean` body field. Default (absent/false) refuses when the unit still owns open enquiries.

**Why this exists:** `enquiries.agent_id` is `ON DELETE SET NULL` and deleting an agent hard-deletes the auth user. An admin who deletes a resigned agent **before** reassigning silently orphans every one of that agent's customers to `agent_id = NULL`. That is the exact failure this feature exists to prevent. The guard must span the **whole unit** (`agentIds`, which includes sub-agents), because deletion cascades to them too.

- [ ] **Step 1: Add the guard to the edge function**

In `supabase/functions/delete-agent/index.ts`, change the body destructure:

```ts
const { agent_id, force } = await req.json();
```

Then insert after `const agentIds = [target.id, ...(subAgents ?? []).map((a) => a.id)];`:

```ts
    // enquiries.agent_id is ON DELETE SET NULL, so deleting this unit would
    // silently orphan its customers to agent_id NULL — invisible in every agent
    // portal, with no record of the prior owner. Refuse while open work remains
    // unless the admin explicitly forces it. Spans the whole unit because
    // deleting a unit deletes its sub-agents too.
    if (!force) {
      const { data: openEnquiries, error: openError } = await supabase
        .from("enquiries")
        .select("id, enquiry_vehicles!inner(id)")
        .in("agent_id", agentIds)
        .in("enquiry_vehicles.status", ["submitted", "quoted"]);

      if (openError) {
        return new Response(
          JSON.stringify({ error: `Failed to check open enquiries: ${openError.message}` }),
          { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      const openCount = (openEnquiries ?? []).length;
      if (openCount > 0) {
        return new Response(
          JSON.stringify({
            error:
              `This unit still has ${openCount} open partnership enquiry(s). ` +
              `Reassign those customers to another agent first (Enquiries > Reassign agent), ` +
              `or they will be left with no agent.`,
            open_enquiry_count: openCount,
          }),
          { status: 409, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
    }
```

- [ ] **Step 2: Deploy the edge function to staging**

Deploy `delete-agent` to staging (`lyjdlietzmmejrxjvwgp`).
Expected: deploy succeeds, version increments.

- [ ] **Step 3: Verify the guard fires**

In the admin portal against staging, try to delete a unit that owns a customer with an open car.
Expected: deletion is refused and the toast reads "This unit still has N open partnership enquiry(s)...".

This message reaches the toast because `useDeleteAgent` now reads the body via `readEdgeFunctionError` (branch `fix/edge-function-error-message`). **If that branch is not merged yet, this message will show as "Edge Function returned a non-2xx status code" instead.** Merge or cherry-pick it before verifying this step.

Then reassign that customer to another agent and retry the delete.
Expected: deletion succeeds.

- [ ] **Step 4: Commit**

```bash
git branch --show-current   # must print feat/customer-agent-reassign-and-self-serve
git add supabase/functions/delete-agent/index.ts
git commit -m "fix(admin): refuse agent delete while the unit owns open enquiries

enquiries.agent_id is ON DELETE SET NULL and agent deletion hard-deletes
the auth user, so deleting a resigned agent before reassigning silently
orphaned their customers to agent_id NULL. Refuse unless force:true, and
name the count so the admin knows what to reassign."
```

---

### Task 6: Deploy to production

**Files:** none — deployment only.

- [ ] **Step 1: Confirm staging is green**

Re-run the Task 1 Step 3 assertion script and the Task 4 Step 5 UI checks against staging. All must pass.

- [ ] **Step 2: Apply the migration to production**

Apply `20260716000001_customer_agent_reassignment.sql` to production (`mjtdsevynrtcmafsnxsj`) via MCP `apply_migration`.

**Never** `supabase db push` — prod migration history uses timestamps unrelated to repo filename prefixes and a push would break it.

- [ ] **Step 3: Deploy the edge function to production**

Deploy `delete-agent` to production (`mjtdsevynrtcmafsnxsj`).

Database and edge function go **before** the frontend merge, since the new UI calls an RPC that must already exist.

- [ ] **Step 4: Open the PR**

```bash
git push -u origin feat/customer-agent-reassign-and-self-serve
gh pr create --title "feat(partner): admin reassigns a customer's agent" --body "$(cat <<'EOF'
## What

Lets an admin move a customer's open partnership work from one agent to
another, so a resigning agent's customers stay serviced.

- `reassign_customer_agent(p_customer_nric, p_new_agent_id)` — admin-only,
  keyed on normalized NRIC since there is no customers table.
- Only enquiries with a submitted/quoted car move. Fully renewed/lost
  enquiries keep their original agent, so past renewal credit is not
  rewritten away from whoever closed it.
- Every call writes a `customer_agent_reassignments` audit row.
- Reassign dialog on the admin Enquiries list (its first Actions column),
  which states that all open enquiries for the IC move and shows the count
  before confirming.
- `delete-agent` now refuses while the unit owns open enquiries: `agent_id`
  is ON DELETE SET NULL, so deleting a resigned agent first silently
  orphaned their customers.

## Deployed before merge

- Migration applied to staging + prod via MCP apply_migration.
- `delete-agent` deployed to staging + prod.

## Verified

- Staging: open enquiry moves, renewed enquiry does not; non-admin gets
  42501; blank NRIC gets 22023; inactive agent gets P0011.
- Staging UI: reassign updates the Agent/Unit cell; customer with no open
  work reports "Nothing to reassign"; delete is refused while open work
  exists and succeeds after reassignment.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

Merging triggers Render auto-deploy of the three static sites.

- [ ] **Step 5: Verify in production**

Sign in to the production admin portal, reassign one real customer with open work, and confirm the Agent/Unit cell updates and one `customer_agent_reassignments` row was written.

---

## Notes for Plan 2 (self-serve vehicle list)

Plan 2 adds `enquiry_vehicles.removed_at`. When it lands, **`reassign_customer_agent` must be updated** to add `AND v.removed_at IS NULL` to its `EXISTS` subquery — otherwise a customer whose only open car was removed still counts as having open work. This is the one coupling between the two plans; it is called out as an explicit task in Plan 2 rather than left to be noticed.
