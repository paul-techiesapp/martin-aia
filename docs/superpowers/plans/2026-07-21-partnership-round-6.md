# Partnership Round 6 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Round-6 client feedback: self-managed unit hierarchy, unit-side enquiry tools (search, mark-renewed, reassign, per-agent drill-down), admin report/search upgrades, unit-level form footer, and agent contact on the enquiry thank-you page.

**Architecture:** Three new migrations (agent-side renewal stamp, unit-scoped reassignment, unit form settings + context v2 + root-link retirement), one new edge function (`update-sub-agent`) plus a unit-caller path in `delete-agent`, a new shared-ui `Combobox`, then per-portal UI tasks. All unit-management authority is enforced server-side (edge fns run service-role; RPCs check `is_admin()` / unit helpers) — UI gating is cosmetic only.

**Tech Stack:** Supabase (Postgres 15, RLS, Deno edge fns), React 18 + Vite + TanStack Router/Query, react-hook-form + zod, shared pnpm workspace packages.

## Global Constraints

- Spec: `docs/superpowers/specs/2026-07-21-partnership-round-6-design.md`. Branch: `feat/partnership-round-6`.
- **No test runner exists.** Verification per task = `pnpm -r typecheck` and, where UI changed, `pnpm --filter <app> build`. Run from repo root `/Users/paullee/Documents/project/martin/DATA`.
- **Never run `pnpm add`** (dual-zod tsc trap). The Combobox is built from existing shared-ui primitives — no new dependencies anywhere.
- **Do not rename the `agent_admin` role value.** UI glossary: root = "Unit Manager", deputy (`is_unit_manager`) = "Unit Admin", other = "Unit Agent".
- Migrations are new files `supabase/migrations/20260721000001..3_*.sql`; apply locally only if a local stack is running (usually not — plan verification is typecheck/build; staging apply happens in Task 15 via MCP `apply_migration`).
- Postgres error codes already taken: `P0001` link inactive, `P0002` bad vehicle status, `P0006` no vehicles, `P0007` duplicate plate, `P0009` NRIC window, `P0011` reassign target inactive, `P0012` portal token, `P0013` vehicle removed. New codes introduced here: `P0014` (vehicle not found/removed for mark-renewed), `P0015` (mark-renewed wrong status), `P0016` (roots have no enquiry link), `P0017` (reassign target outside unit), `P0018` (customer not managed by caller's unit).
- Existing SQL helpers (from `20260702000002_unit_manager.sql`): `get_agent_id()`, `is_admin()`, `unit_member_ids()`, `is_unit_viewer()`, `get_unit_root()`. Verify exact names in that file before use; adjust call sites if they differ.
- `agents` RLS has **no** UPDATE policy for unit callers — do not add one; all unit-side writes to other agents' rows go through edge functions (service role).
- Commit after every task with the message given in its final step (all commits end with the `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>` trailer).

---

### Task 1: Migration — agent "mark as renewed" (date-only)

**Files:**
- Create: `supabase/migrations/20260721000001_agent_mark_renewed.sql`

**Interfaces:**
- Produces: RPC `mark_vehicle_renewed(p_vehicle_id uuid) RETURNS date` (new expiry date); columns `enquiry_vehicles.marked_renewed_at timestamptz`, `enquiry_vehicles.marked_renewed_by uuid`.
- Deliberately does NOT touch `status`, `renewed_at`, `renewed_by` — those belong to the merchant gift flow (`confirm_vehicle_renewal` requires `status IN ('submitted','quoted')` and must keep working after an agent marks a renewal).

- [ ] **Step 1: Write the migration**

```sql
-- Agent-side "mark as renewed": rolls the expiry forward one year and re-arms
-- the reminder. Date-only by design (client decision 2026-07-21): the gold
-- gift stays merchant-confirmed via confirm_vehicle_renewal, so this must NOT
-- change status/renewed_at/renewed_by or the merchant could no longer confirm.

ALTER TABLE enquiry_vehicles
  ADD COLUMN IF NOT EXISTS marked_renewed_at timestamptz,
  ADD COLUMN IF NOT EXISTS marked_renewed_by uuid REFERENCES agents(id) ON DELETE SET NULL;

CREATE OR REPLACE FUNCTION mark_vehicle_renewed(p_vehicle_id uuid)
RETURNS date
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_vehicle enquiry_vehicles%ROWTYPE;
  v_enquiry_agent uuid;
  v_new_expiry date;
BEGIN
  SELECT * INTO v_vehicle FROM enquiry_vehicles WHERE id = p_vehicle_id;
  IF NOT FOUND OR v_vehicle.removed_at IS NOT NULL THEN
    RAISE EXCEPTION 'vehicle not found or removed' USING ERRCODE = 'P0014';
  END IF;
  IF v_vehicle.status NOT IN ('submitted', 'quoted') THEN
    RAISE EXCEPTION 'vehicle is not in a renewable state' USING ERRCODE = 'P0015';
  END IF;

  SELECT agent_id INTO v_enquiry_agent FROM enquiries WHERE id = v_vehicle.enquiry_id;

  IF NOT (
    is_admin()
    OR (v_enquiry_agent IS NOT NULL AND v_enquiry_agent = get_agent_id())
    OR (v_enquiry_agent IS NOT NULL AND is_unit_viewer()
        AND v_enquiry_agent IN (SELECT unit_member_ids()))
  ) THEN
    RAISE EXCEPTION 'not allowed to mark this vehicle renewed' USING ERRCODE = '42501';
  END IF;

  v_new_expiry := (v_vehicle.insurance_expiry_date + INTERVAL '1 year')::date;

  UPDATE enquiry_vehicles
     SET insurance_expiry_date = v_new_expiry,
         reminder_sent_at = NULL,          -- re-arm next year's reminder
         marked_renewed_at = now(),
         marked_renewed_by = get_agent_id(),
         updated_at = now()
   WHERE id = p_vehicle_id;

  RETURN v_new_expiry;
END;
$$;

REVOKE EXECUTE ON FUNCTION mark_vehicle_renewed(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION mark_vehicle_renewed(uuid) TO authenticated;
```

- [ ] **Step 2: Verify helper names** — open `supabase/migrations/20260702000002_unit_manager.sql:9-45` and confirm `get_agent_id()`, `is_unit_viewer()`, `unit_member_ids()` exist with those exact names (they are also used by existing policies at `:49-51`). If a name differs, fix the migration to match.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260721000001_agent_mark_renewed.sql
git commit -m "feat(db): agent-side mark_vehicle_renewed RPC — date-only, keeps gift flow intact"
```

---

### Task 2: Migration — unit-scoped customer reassignment

**Files:**
- Create: `supabase/migrations/20260721000002_unit_reassign.sql`
- Reference (copy body from): `supabase/migrations/20260716000004_removed_at_ripple.sql:304-379` (current `reassign_customer_agent`)

**Interfaces:**
- Produces: same signature `reassign_customer_agent(p_customer_nric text, p_new_agent_id uuid) RETURNS int`, now callable by unit viewers when both the customer's current agent(s) and the target agent are inside the caller's unit. Admin path unchanged. New error codes `P0017`/`P0018`.

- [ ] **Step 1: Write the migration.** Recreate the function with the authz block replaced. Copy the latest body verbatim from `20260716000004_removed_at_ripple.sql:304-379`, then apply exactly these changes (rest of the body — normalization, `P0011` active-target check, the UPDATE, audit insert — stays identical):

```sql
-- Unit-scoped reassignment: unit viewers may reassign customers whose open
-- enquiries all belong to agents inside their unit, to a target in the unit.
CREATE OR REPLACE FUNCTION reassign_customer_agent(p_customer_nric text, p_new_agent_id uuid)
RETURNS int
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  -- keep the DECLARE block from the current definition, and add:
  v_is_admin boolean := is_admin();
BEGIN
  -- REPLACE the old authz block:
  --   IF NOT is_admin() THEN RAISE ... '42501'
  -- with:
  IF NOT v_is_admin AND NOT is_unit_viewer() THEN
    RAISE EXCEPTION 'not allowed to reassign customers' USING ERRCODE = '42501';
  END IF;

  IF NOT v_is_admin THEN
    IF p_new_agent_id NOT IN (SELECT unit_member_ids()) THEN
      RAISE EXCEPTION 'target agent is not in your unit' USING ERRCODE = 'P0017';
    END IF;
    -- every open enquiry for this customer must already belong to the unit
    IF EXISTS (
      SELECT 1 FROM enquiries e
      WHERE e.customer_nric_normalized = v_nric  -- same variable name the body uses
        AND EXISTS (SELECT 1 FROM enquiry_vehicles v
                     WHERE v.enquiry_id = e.id AND v.removed_at IS NULL
                       AND v.status IN ('submitted','quoted'))
        AND (e.agent_id IS NULL OR e.agent_id NOT IN (SELECT unit_member_ids()))
    ) THEN
      RAISE EXCEPTION 'customer is not managed by your unit' USING ERRCODE = 'P0018';
    END IF;
  END IF;
  -- ... rest of the current body unchanged ...
END;
$$;
GRANT EXECUTE ON FUNCTION reassign_customer_agent(text, uuid) TO authenticated;
```

Read the source block first; the customer-NRIC variable and the WHERE conditions in the final UPDATE must match the copied body exactly (the EXISTS filter above mirrors the body's own "open enquiry" definition).

- [ ] **Step 2: Typecheck sanity** — nothing TS-side yet; just re-read the migration for variable-name consistency with the copied body.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260721000002_unit_reassign.sql
git commit -m "feat(db): unit viewers can reassign customers within their unit"
```

---

### Task 3: Migration — unit form settings, context v2, root-link retirement

**Files:**
- Create: `supabase/migrations/20260721000003_unit_form_settings_and_context.sql`
- Reference: `supabase/migrations/20260711000001_partner_master_scope.sql:69-85` (current `get_enquiry_context`), `supabase/migrations/20260629000010_enquiry_v2.sql` (find `ensure_my_enquiry_link`)

**Interfaces:**
- Produces: `agents.form_settings jsonb` (used on unit roots; key today: `footer_image_url`); `get_enquiry_context(p_link_code text)` gains two columns `agent_phone text, unit_form_settings jsonb`; unit roots' `enquiry_link_code` NULLed; `ensure_my_enquiry_link` raises `P0016` for roots.
- Consumed by Task 10 (unit footer card), Task 11 (public form).

- [ ] **Step 1: Write the migration**

```sql
-- (a) Unit-level form overrides, stored on the unit root agent row.
--     Mirrors merchants.form_settings; only footer_image_url is used today.
ALTER TABLE agents ADD COLUMN IF NOT EXISTS form_settings jsonb;

-- (b) get_enquiry_context v2: expose the relevant agent's phone (thank-you
--     page shows name + contact) and the owning unit root's form_settings
--     (footer precedence: partner > unit > admin). Return type changes, so
--     drop first.
DROP FUNCTION IF EXISTS get_enquiry_context(text);
CREATE FUNCTION get_enquiry_context(p_link_code text)
RETURNS TABLE (
  kind text,
  agent_name text,
  agent_phone text,
  merchant_name text,
  merchant_logo_url text,
  branch_name text,
  merchant_form_settings jsonb,
  unit_form_settings jsonb
)
LANGUAGE sql
SECURITY DEFINER STABLE
SET search_path = public
AS $$
  SELECT 'agent', a.name, a.phone, NULL, NULL, NULL, NULL,
         (SELECT r.form_settings FROM agents r
           WHERE r.id = COALESCE(a.parent_agent_id, a.id))
    FROM agents a
   WHERE a.enquiry_link_code = p_link_code AND a.status = 'active'
  UNION ALL
  SELECT 'branch', ta.name, ta.phone, m.name, m.logo_url, b.name, m.form_settings,
         (SELECT r.form_settings FROM agents r
           WHERE r.id = COALESCE(ta.parent_agent_id, ta.id))
    FROM branch_links bl
    JOIN merchant_branches b ON b.id = bl.merchant_branch_id AND b.status = 'active'
    JOIN merchants m ON m.id = b.merchant_id AND m.status = 'active'
    LEFT JOIN agents ta ON ta.id = bl.agent_id AND ta.status = 'active'
   WHERE bl.link_code = p_link_code AND bl.is_active
  LIMIT 1;
$$;
GRANT EXECUTE ON FUNCTION get_enquiry_context(text) TO anon;

-- (c) Unit Managers (roots) carry no personal enquiry link (client decision).
UPDATE agents SET enquiry_link_code = NULL WHERE parent_agent_id IS NULL;
```

Then, in the same file, recreate `ensure_my_enquiry_link` (find its current definition by `grep -rn "ensure_my_enquiry_link" supabase/migrations/` — copy the newest body) adding at the top of the body, after the caller's agent row is resolved:

```sql
  IF v_agent.parent_agent_id IS NULL THEN
    RAISE EXCEPTION 'unit managers do not have a personal enquiry link' USING ERRCODE = 'P0016';
  END IF;
```

(Keep everything else — code generation, return — identical.)

**Behavior note:** on a branch link the previous SQL only matched when the tied agent was active or absent... The old branch SELECT did not join `agents` at all; the new `LEFT JOIN ... AND ta.status='active'` keeps house links (`agent_id IS NULL`) working and hides an inactive tied agent's contact (columns come back NULL) without killing the link. This matches the current resolution semantics of `submit_enquiry`, which takes `bl.agent_id` regardless.

- [ ] **Step 2: Cross-check `submit_enquiry` untouched** — `20260706000009_enquiry_nric_dedup_window.sql:19-31` resolves agent links via `agents.enquiry_link_code`; after (c) roots simply have no code, so nothing to change there. Confirm no other code path generates root links: `grep -rn "enquiry_link_code" apps/ supabase/functions/` should show only reads.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260721000003_unit_form_settings_and_context.sql
git commit -m "feat(db): unit form_settings, context v2 (agent phone + unit footer), retire root enquiry links"
```

---

### Task 4: New edge function `update-sub-agent`

**Files:**
- Create: `supabase/functions/update-sub-agent/index.ts`
- Reference: `supabase/functions/create-sub-agent/index.ts` (auth pattern, lines 33-73)

**Interfaces:**
- Produces: POST body `{ agent_id: string, name?, email?, phone?, nric?, agent_code?, tier_id?: string|null, status?: 'active'|'inactive', is_unit_manager?: boolean, password?: string }` → `200 { success: true, agent }`. Errors: 401 no/bad token, 403 role violations, 404 target missing, 409 email conflict, 400 validation.
- Permission matrix enforced here: caller must be unit root or deputy of the target's unit; **deputy callers may only edit plain Unit Agents** (403 if target is the root or another deputy, or if `is_unit_manager` present in payload); only the root may set `is_unit_manager`.
- Consumed by Task 7 (`useUpdateSubAgent`).

- [ ] **Step 1: Write the function**

```ts
// supabase/functions/update-sub-agent/index.ts
// Unit-side agent editing. Round 6: Unit Manager (root) edits anyone in the
// unit incl. deputies and the deputy flag; Unit Admins (deputies) edit plain
// Unit Agents only. Email changes must ripple to auth.users (login email),
// which RLS-scoped table updates cannot do — hence this function.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};
const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
    );

    const authHeader = req.headers.get('Authorization');
    if (!authHeader) return json(401, { error: 'Missing authorization header' });
    const { data: userData, error: userErr } = await supabase.auth.getUser(
      authHeader.replace('Bearer ', ''),
    );
    if (userErr || !userData.user) return json(401, { error: 'Invalid token' });

    const { data: caller } = await supabase
      .from('agents')
      .select('id, parent_agent_id, is_unit_manager')
      .eq('user_id', userData.user.id)
      .single();
    if (!caller) return json(403, { error: 'Only agents can update unit members' });
    const callerIsRoot = caller.parent_agent_id === null;
    if (!callerIsRoot && caller.is_unit_manager !== true) {
      return json(403, { error: 'Only unit managers or unit admins can update agents' });
    }
    const unitRootId = caller.parent_agent_id ?? caller.id;

    const body = await req.json();
    const { agent_id, password, ...fields } = body as Record<string, unknown> & {
      agent_id?: string;
      password?: string;
    };
    if (!agent_id) return json(400, { error: 'agent_id is required' });

    const { data: target } = await supabase
      .from('agents')
      .select('id, user_id, parent_agent_id, is_unit_manager, email')
      .eq('id', agent_id)
      .single();
    if (!target) return json(404, { error: 'Agent not found' });

    const targetIsRoot = target.parent_agent_id === null;
    const inUnit = targetIsRoot ? target.id === unitRootId : target.parent_agent_id === unitRootId;
    if (!inUnit) return json(403, { error: 'Agent is not in your unit' });
    if (targetIsRoot) {
      return json(403, { error: 'The Unit Manager can only be edited by the master admin' });
    }
    if (!callerIsRoot && target.is_unit_manager === true) {
      return json(403, { error: 'Only the Unit Manager can edit a Unit Admin' });
    }
    if ('is_unit_manager' in fields && !callerIsRoot) {
      return json(403, { error: 'Only the Unit Manager can change the Unit Admin flag' });
    }

    const allowed = ['name', 'email', 'phone', 'nric', 'agent_code', 'tier_id', 'status', 'is_unit_manager'];
    const updates: Record<string, unknown> = {};
    for (const key of allowed) if (key in fields) updates[key] = fields[key];
    if ('nric' in updates && updates.nric === '') updates.nric = null;

    // Sync auth.users first so a failure leaves the agents row untouched.
    const authUpdates: { email?: string; password?: string } = {};
    if (typeof updates.email === 'string' && updates.email !== target.email) {
      authUpdates.email = updates.email as string;
    }
    if (password) {
      if (password.length < 6) return json(400, { error: 'Password must be at least 6 characters' });
      authUpdates.password = password;
    }
    if (Object.keys(authUpdates).length > 0) {
      const { error: authUpdateErr } = await supabase.auth.admin.updateUserById(
        target.user_id,
        { ...authUpdates, email_confirm: true },
      );
      if (authUpdateErr) {
        const conflict = authUpdateErr.message?.toLowerCase().includes('already');
        return json(conflict ? 409 : 400, { error: authUpdateErr.message });
      }
    }

    if (Object.keys(updates).length > 0) {
      const { data: updated, error: updateErr } = await supabase
        .from('agents')
        .update(updates)
        .eq('id', agent_id)
        .select()
        .single();
      if (updateErr) return json(400, { error: updateErr.message });
      return json(200, { success: true, agent: updated });
    }
    return json(200, { success: true, agent: target });
  } catch (err) {
    return json(500, { error: (err as Error).message });
  }
});
```

- [ ] **Step 2: Commit**

```bash
git add supabase/functions/update-sub-agent/index.ts
git commit -m "feat(edge): update-sub-agent — unit-side editing with role matrix + auth email sync"
```

---

### Task 5: `delete-agent` unit-caller path

**Files:**
- Modify: `supabase/functions/delete-agent/index.ts` (authorization block at lines 38-59; target checks around 61-115)

**Interfaces:**
- Produces: unchanged payload `{ agent_id, force? }`. New: non-admin callers accepted when they are the target's unit root or a deputy; deputy may delete plain Unit Agents only; nobody unit-side deletes the root; `force` remains **admin-only**. Existing open-enquiries 409 guard applies to unit callers unconditionally.

- [ ] **Step 1: Rework the authorization block.** Replace the admin-only gate (`caller.app_metadata?.role !== "admin"` → 403 at lines 54-58) with:

```ts
    const isAdmin = caller.app_metadata?.role === 'admin';
    let unitCaller: { id: string; parent_agent_id: string | null; is_unit_manager: boolean } | null = null;
    if (!isAdmin) {
      const { data: callerAgent } = await supabase
        .from('agents')
        .select('id, parent_agent_id, is_unit_manager')
        .eq('user_id', caller.id)
        .single();
      const isRoot = callerAgent?.parent_agent_id === null;
      if (!callerAgent || (!isRoot && callerAgent.is_unit_manager !== true)) {
        return jsonResponse(403, { error: 'Only admins or unit managers can delete agents' });
      }
      unitCaller = callerAgent;
      if (force) {
        return jsonResponse(403, { error: 'Only admins can force-delete' });
      }
    }
```

(Match the file's existing response-helper name — if it returns raw `new Response(...)`, keep that style.) Then, after the target agent row is fetched (lines 62-66), add the unit-scope check — the target select must also include `parent_agent_id, is_unit_manager`:

```ts
    if (unitCaller) {
      const unitRootId = unitCaller.parent_agent_id ?? unitCaller.id;
      if (target.parent_agent_id === null) {
        return jsonResponse(403, { error: 'The Unit Manager can only be deleted by the master admin' });
      }
      if (target.parent_agent_id !== unitRootId) {
        return jsonResponse(403, { error: 'Agent is not in your unit' });
      }
      const callerIsRoot = unitCaller.parent_agent_id === null;
      if (!callerIsRoot && target.is_unit_manager === true) {
        return jsonResponse(403, { error: 'Only the Unit Manager can delete a Unit Admin' });
      }
    }
```

Everything downstream (sub-agent collection, open-enquiries 409 guard, partner cleanup, auth-user cascade delete) is unchanged and applies to unit callers too. Note the caller variable currently named for the auth user — read lines 38-66 first and keep naming consistent.

- [ ] **Step 2: Typecheck the function mentally against its imports** (Deno file — no local tsc). Re-read the final file top to bottom once.

- [ ] **Step 3: Commit**

```bash
git add supabase/functions/delete-agent/index.ts
git commit -m "feat(edge): delete-agent accepts unit callers per round-6 role matrix"
```

---

### Task 6: shared-types fields + shared-ui Combobox

**Files:**
- Modify: `packages/shared-types/src/merchant.ts` (EnquiryVehicle, ~line 100-133)
- Modify: `packages/shared-types/src/database.ts` (Agent, ~line 200-217)
- Create: `packages/shared-ui/src/components/ui/combobox.tsx`
- Modify: `packages/shared-ui/src/index.ts`

**Interfaces:**
- Produces: `EnquiryVehicle.marked_renewed_at: string | null`, `EnquiryVehicle.marked_renewed_by: string | null`; `Agent.form_settings: UnitFormSettings | null` with `export interface UnitFormSettings { footer_image_url?: string }` (place next to `MerchantFormSettings` in merchant.ts and re-export via the package index like its sibling); shared-ui export `Combobox` + `ComboboxOption`.
- `Combobox` props: `{ options: ComboboxOption[]; value: string | null; onValueChange: (v: string) => void; placeholder?: string; searchPlaceholder?: string; emptyText?: string; disabled?: boolean; className?: string }` where `ComboboxOption = { value: string; label: string }`.

- [ ] **Step 1: Add the type fields** (two one-line-ish edits per file, mirroring neighboring fields' style), plus the `UnitFormSettings` interface.

- [ ] **Step 2: Write the Combobox** (no new deps — Popover + Input + Button already exist in shared-ui; icons from `lucide-react` which shared-ui already uses):

```tsx
// packages/shared-ui/src/components/ui/combobox.tsx
import * as React from 'react';
import { Check, ChevronsUpDown } from 'lucide-react';
import { cn } from '../../lib/utils';
import { Button } from './button';
import { Input } from './input';
import { Popover, PopoverContent, PopoverTrigger } from './popover';

export interface ComboboxOption {
  value: string;
  label: string;
}

interface ComboboxProps {
  options: ComboboxOption[];
  value: string | null;
  onValueChange: (value: string) => void;
  placeholder?: string;
  searchPlaceholder?: string;
  emptyText?: string;
  disabled?: boolean;
  className?: string;
}

export function Combobox({
  options,
  value,
  onValueChange,
  placeholder = 'Select…',
  searchPlaceholder = 'Type to search…',
  emptyText = 'No matches.',
  disabled,
  className,
}: ComboboxProps) {
  const [open, setOpen] = React.useState(false);
  const [query, setQuery] = React.useState('');
  const selected = options.find((o) => o.value === value);
  const filtered = query
    ? options.filter((o) => o.label.toLowerCase().includes(query.toLowerCase()))
    : options;

  return (
    <Popover open={open} onOpenChange={(next) => { setOpen(next); if (!next) setQuery(''); }}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          role="combobox"
          aria-expanded={open}
          disabled={disabled}
          className={cn('w-full justify-between font-normal', !selected && 'text-muted-foreground', className)}
        >
          <span className="truncate">{selected?.label ?? placeholder}</span>
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[var(--radix-popover-trigger-width)] p-0" align="start">
        <div className="border-b p-2">
          <Input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={searchPlaceholder}
            className="h-8"
          />
        </div>
        <div className="max-h-60 overflow-y-auto py-1">
          {filtered.length === 0 && (
            <div className="px-3 py-2 text-sm text-muted-foreground">{emptyText}</div>
          )}
          {filtered.map((option) => (
            <button
              key={option.value}
              type="button"
              onClick={() => { onValueChange(option.value); setOpen(false); setQuery(''); }}
              className={cn(
                'flex w-full items-center px-3 py-2 text-left text-sm hover:bg-accent',
                option.value === value && 'bg-accent',
              )}
            >
              <Check className={cn('mr-2 h-4 w-4', option.value === value ? 'opacity-100' : 'opacity-0')} />
              <span className="truncate">{option.label}</span>
            </button>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}
```

Check the actual relative import paths inside an existing shared-ui component (e.g. `select.tsx`) and mirror them; add to `packages/shared-ui/src/index.ts`: `export { Combobox, type ComboboxOption } from './components/ui/combobox';` (match the file's existing export style).

- [ ] **Step 3: Verify**

Run: `pnpm -r typecheck`
Expected: PASS (0 errors).

- [ ] **Step 4: Commit**

```bash
git add packages/shared-types packages/shared-ui
git commit -m "feat(shared): Combobox component + round-6 type fields (marked_renewed, unit form_settings)"
```

---

### Task 7: Agent portal — My Agents full management

**Files:**
- Modify: `apps/agent-portal/src/hooks/useSubAgents.ts`
- Modify: `apps/agent-portal/src/pages/MyAgents.tsx`

**Interfaces:**
- Consumes: Task 4 `update-sub-agent`, Task 5 `delete-agent`, Task 6 `Combobox` not needed here.
- Produces hooks: `useUpdateSubAgent()` mutation taking `{ agent_id: string; name?: string; email?: string; phone?: string; nric?: string; agent_code?: string; tier_id?: string | null; status?: 'active' | 'inactive'; is_unit_manager?: boolean; password?: string }`, and `useDeleteUnitAgent()` mutation taking `{ agent_id: string }` — both invalidate `['my-sub-agents']`.
- UI: per-row **Edit** dialog (all fields above; Tier options from existing `useAvailableTiers()`), root-only "Unit Admin" Switch inside the dialog, per-row Delete wired to `useDeleteUnitAgent`, role `Badge` per row.

- [ ] **Step 1: Add the two hooks** to `useSubAgents.ts`, following `useCreateSubAgent` (`:61-88`) exactly — `supabase.functions.invoke('update-sub-agent', { body })` / `supabase.functions.invoke('delete-agent', { body: { agent_id } })`, surface `response.error ?? response.data?.error` as an Error, invalidate `['my-sub-agents']` on success.

- [ ] **Step 2: Build the Edit dialog in `MyAgents.tsx`.** Follow the existing Add-Agent `Dialog` pattern in the same file (plain `useState` form object, not react-hook-form — match the file's local idiom):
  - State: `const [editTarget, setEditTarget] = useState<SubAgent | null>(null)` plus a form object `{ name, email, phone, nric, agent_code, tier_id, status, is_unit_manager, password }` seeded from `editTarget` in an effect or on open.
  - Fields: Inputs for name/email/phone/nric/agent_code, `Select` for tier (`useAvailableTiers()`, include a "No tier" item mapping to `null`), `Select` for status (active/inactive), password Input (helper text "Leave blank to keep current password"), and — **only when the signed-in agent is the root** (`agent.parent_agent_id === null`) — a `Switch` labeled "Unit Admin" bound to `is_unit_manager` with description "Deputy with unit-wide view and Unit Agent management".
  - Submit: strip empty `password`, call `useUpdateSubAgent`, toast success/error (`title: 'Agent updated'`).
  - Row visibility: Edit button on every roster row for the root; for deputy viewers only on rows where `!a.is_unit_manager` (mirror of the server matrix).

- [ ] **Step 3: Role badges + delete wiring.**
  - In the roster table's Name cell add: root row (the "You" row when caller is root) → `<Badge variant="info" size="sm">Unit Manager</Badge>`; rows with `a.is_unit_manager` → `<Badge variant="info" size="sm">Unit Admin</Badge>`; others no badge (they're "Unit Agent" by default — keep the table uncluttered).
  - Replace the existing deactivate flow's mutation with `useDeleteUnitAgent` **only if** the current `useDeactivateSubAgent` still points at the old `deactivate-sub-agent` edge fn (check `useSubAgents.ts` — memory says that fn hard-deletes; if so, switching to `delete-agent` gains the open-enquiries 409 guard). Surface the 409 message verbatim in the toast (it tells the user to reassign customers first).
  - Delete button visibility mirrors Edit visibility; never on the root's own row.
  - Update the page's guard copy at `MyAgents.tsx:61-67` from "only available to unit managers" to "only available to Unit Managers and Unit Admins".

- [ ] **Step 4: Verify**

Run: `pnpm -r typecheck && pnpm --filter agent-portal build`
Expected: both PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/agent-portal/src/hooks/useSubAgents.ts apps/agent-portal/src/pages/MyAgents.tsx
git commit -m "feat(agent): My Agents — edit/delete unit members, deputy toggle, role badges"
```

---

### Task 8: Agent portal — Team Report event filter

**Files:**
- Modify: `apps/agent-portal/src/hooks/useTeamReport.ts` (query at `:29-91`)
- Modify: `apps/agent-portal/src/pages/TeamReport.tsx`

**Interfaces:**
- Produces: `useUnitTeamReport(roster, enabled, campaignId: string)` — `'all'` keeps today's behavior; query key becomes `['unit-team-report', rosterKey, campaignId]`.

- [ ] **Step 1: Extend the query.** In `useTeamReport.ts` add `slot:slots(campaign_id)` to the registrations select, accept `campaignId`, and filter client-side after fetch: `campaignId === 'all' ? rows : rows.filter(r => r.slot?.campaign_id === campaignId)` before grouping (server-side would need a slot-id subquery; client-side matches the file's existing style and data volumes).

- [ ] **Step 2: Add the selector.** In `TeamReport.tsx`: `const [campaignId, setCampaignId] = useState('all')`. Fetch campaigns with the agent portal's existing campaigns hook (check `apps/agent-portal/src/hooks/` — the Campaigns page at `src/pages/Campaigns.tsx` imports it; reuse the same hook). Render a `Select` above the stats: item "All events" (`'all'`) + one per campaign name. Pass `campaignId` into `useUnitTeamReport`.

- [ ] **Step 3: Verify**

Run: `pnpm -r typecheck && pnpm --filter agent-portal build`
Expected: both PASS.

- [ ] **Step 4: Commit**

```bash
git add apps/agent-portal/src/hooks/useTeamReport.ts apps/agent-portal/src/pages/TeamReport.tsx
git commit -m "feat(agent): Team Report filters by event"
```

---

### Task 9: Agent portal — My Enquiries: search, mark renewed, reassign

**Files:**
- Modify: `apps/agent-portal/src/hooks/useMyEnquiries.ts`
- Modify: `apps/agent-portal/src/pages/MyEnquiries.tsx`

**Interfaces:**
- Consumes: Task 1 `mark_vehicle_renewed`, Task 2 unit-scoped `reassign_customer_agent`, Task 6 `Combobox`, existing `useUnitRoster` (from `useSubAgents.ts`).
- Produces hooks in `useMyEnquiries.ts`:
  - `useMarkVehicleRenewed(agentId)` → `supabase.rpc('mark_vehicle_renewed', { p_vehicle_id })`, invalidates `['my-enquiries']`; error mapping: `P0014` → "That car is no longer active on this enquiry.", `P0015` → "This car is already renewed or closed.", `42501` → "You can only mark your own customers' cars.", else raw message.
  - `useReassignEnquiryAgent()` → `supabase.rpc('reassign_customer_agent', { p_customer_nric, p_new_agent_id })`, invalidates `['my-enquiries']`; error mapping: `42501` → "Only unit managers can reassign customers.", `P0011` → "That agent is not active any more.", `P0017` → "That agent is not in your unit.", `P0018` → "This customer has enquiries outside your unit — ask the admin to reassign.", `22023` → "This customer has no IC on record.", else raw. (Mirror the mapping style of `apps/admin-portal/src/hooks/useEnquiries.ts:206-217`.)

- [ ] **Step 1: Add the two hooks** as specified above.

- [ ] **Step 2: Search input.** In `MyEnquiries.tsx` add `const [search, setSearch] = useState('')` and an `<Input placeholder="Search name, car plate, IC or phone…" />` rendered first in the existing filter row (`:560-620`). Extend the `visibleEnquiries` memo (`:523-529`) with:

```tsx
const q = search.trim().toLowerCase();
const digits = search.replace(/\D/g, '');
const matchesSearch = (e: EnquiryWithDetails) =>
  !q ||
  e.customer_name.toLowerCase().includes(q) ||
  (e.customer_nric ?? '').toLowerCase().replace(/[\s-]/g, '').includes(q.replace(/[\s-]/g, '')) ||
  (digits.length >= 3 && (e.customer_phone ?? '').replace(/\D/g, '').includes(digits)) ||
  e.vehicles.some((v) => v.car_plate.toLowerCase().replace(/\s/g, '').includes(q.replace(/\s/g, '')));
```

and add `matchesSearch(e)` to the combined filter chain.

- [ ] **Step 3: Mark-renewed button.** In `EnquiryCard`'s vehicle Action cell (`:297-318`), alongside the existing Get Quote logic, when `v.status === VehicleStatus.SUBMITTED || v.status === VehicleStatus.QUOTED`, render a small outline Button "Mark renewed". Clicking opens a confirm `AlertDialog` ("Mark {car_plate} as renewed? The expiry moves to {current expiry + 1 year} and next year's reminder is re-armed. This does not issue the gold gift — the partner confirms that separately."). Confirm → `useMarkVehicleRenewed`. After success, show a toast with the returned new expiry date. When `v.marked_renewed_at` is set, show a muted line under the Action cell: `Renewed {fmt(marked_renewed_at)}`.

- [ ] **Step 4: Reassign dialog (unit viewers only).** In `EnquiryCard`'s header, next to the existing "Copy my-cars link" button, render — only when `isUnitView` — a "Reassign" Button opening a `Dialog`: a `Combobox` of the unit roster (options from `useUnitRoster` mapped `{value: id, label: name}`, excluding the enquiry's current `agent.id`), a warning line "All of this customer's open enquiries move to the selected agent.", and Confirm calling `useReassignEnquiryAgent` with `p_customer_nric: enquiry.customer_nric`. Toast the moved-count result ("{n} enquiry(ies) reassigned").

- [ ] **Step 5: Verify**

Run: `pnpm -r typecheck && pnpm --filter agent-portal build`
Expected: both PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/agent-portal/src/hooks/useMyEnquiries.ts apps/agent-portal/src/pages/MyEnquiries.tsx
git commit -m "feat(agent): enquiry search, agent mark-renewed, unit-scoped reassignment"
```

---

### Task 10: Agent portal — drill-down route, root link removal, unit footer card

**Files:**
- Create: `apps/agent-portal/src/pages/AgentEnquiries.tsx`
- Modify: `apps/agent-portal/src/router.tsx` (route defs; children array at `:171-192`)
- Modify: `apps/agent-portal/src/components/Layout.tsx` (nav `:15-47`)
- Modify: `apps/agent-portal/src/pages/MyAgents.tsx` (row link + footer card)
- Modify: `apps/agent-portal/src/pages/MyEnquiryLink.tsx`
- Modify: `apps/agent-portal/src/hooks/useSubAgents.ts` (footer mutation)

**Interfaces:**
- Consumes: Task 3 (`agents.form_settings`, `P0016`), Task 7 hooks.
- Produces: route `/my-agents/$agentId/enquiries` (unit-viewer gated); `useSetUnitFooter()` mutation taking the image URL (or `''` to clear) — writes go through a SECURITY DEFINER RPC because RLS gives unit callers no UPDATE on `agents` (see Step 4).

- [ ] **Step 1: Per-agent enquiries page.** `AgentEnquiries.tsx`: read `agentId` via `useParams({ from: '/my-agents/$agentId/enquiries' })` (copy the exact `useParams` idiom from any existing param route in `apps/public-pages/src/router.tsx` — the agent portal currently has none, so follow TanStack Router v1 usage: `Route.useParams()` if routes are code-defined objects, else `useParams` with `strict: false`; check the installed API in `router.tsx` imports). Page body: guard `isUnitViewer` like `TeamReport.tsx:61-67`; header shows the agent's name (from `useUnitRoster` lookup); reuse `useMyEnquiries(agentId, false)` — passing the **target** agent's id with `unitWide=false` scopes the query to that agent while unit RLS grants read; render the same list body as MyEnquiries by extracting nothing — simply render `EnquiryCard` per enquiry. To avoid a giant refactor, export `EnquiryCard` from `MyEnquiries.tsx` (`export function EnquiryCard...`) and import it here; pass `isUnitView={true}`.
- [ ] **Step 2: Route + nav + row link.** Register the route as a child of `authenticatedRoute` (path `/my-agents/$agentId/enquiries`). In `MyAgents.tsx` make each roster row's name a `Link` to that route (import `Link` from `@tanstack/react-router`). No new nav item needed (reachable from My Agents), so `Layout.tsx` only changes for Step 3.
- [ ] **Step 3: Hide My Link for roots.** In `Layout.tsx` `buildAgentGroups`, accept the flag it already closes over — change signature to `buildAgentGroups(isUnitViewer: boolean, isRoot: boolean)` and drop the `My Link /my-link` item when `isRoot`; call site (`:96-102`) passes `role === 'agent_admin'`. In `MyEnquiryLink.tsx`, add an early return for roots (`agent.parent_agent_id === null`): a card explaining "Unit Managers do not have a personal enquiry link. Your unit's agents each have their own." (belt-and-braces with the server's `P0016`).
- [ ] **Step 4: Unit footer card.** The root's `agents.form_settings` cannot be written via RLS (no unit UPDATE policy — Global Constraints). Write path: extend `update-sub-agent`? No — that function refuses root targets. Instead add a tiny SECURITY DEFINER RPC in migration 3's file **if not already applied**; since Task 3 may already be committed, create `supabase/migrations/20260721000004_unit_footer_rpc.sql`:

```sql
-- Unit viewers set their unit's enquiry-form footer image (round 6, item 6).
CREATE OR REPLACE FUNCTION set_unit_footer_image(p_url text)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF NOT is_unit_viewer() THEN
    RAISE EXCEPTION 'only unit managers can set the unit footer' USING ERRCODE = '42501';
  END IF;
  UPDATE agents
     SET form_settings = CASE
           WHEN NULLIF(trim(p_url), '') IS NULL
             THEN COALESCE(form_settings, '{}'::jsonb) - 'footer_image_url'
           ELSE COALESCE(form_settings, '{}'::jsonb)
                  || jsonb_build_object('footer_image_url', trim(p_url))
         END
   WHERE id = get_unit_root();
END;
$$;
REVOKE EXECUTE ON FUNCTION set_unit_footer_image(text) FROM anon;
GRANT EXECUTE ON FUNCTION set_unit_footer_image(text) TO authenticated;
```

(Verify `get_unit_root()` exists per Global Constraints.) Hook `useSetUnitFooter()` in `useSubAgents.ts` calls the RPC and invalidates `['my-sub-agents']`. UI: a Card at the bottom of `MyAgents.tsx` — "Enquiry Form Footer" — with: current image preview (read the root row's `form_settings?.footer_image_url`; the root row is already in `useMySubAgents`/own-agent data — extend the select in `useMySubAgents` to include `form_settings` if absent), a file input uploading to the public `company-assets` bucket at path `form-images/unit-${unitRootId}-footer-${Date.now()}.{ext}` via `supabase.storage.from('company-assets').upload(...)` then `getPublicUrl` (mirror `apps/admin-portal/src/hooks/useCompanyAssets.ts:38-53`), a "Remove" button calling the RPC with `''`, and helper text "Recommended 1600×200 (8:1). Overrides the RACC footer on your unit's enquiry forms; a partner-specific footer still wins."

- [ ] **Step 5: Verify**

Run: `pnpm -r typecheck && pnpm --filter agent-portal build`
Expected: both PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/agent-portal supabase/migrations/20260721000004_unit_footer_rpc.sql
git commit -m "feat(agent): per-agent enquiries page, no root link, unit footer image"
```

---

### Task 11: Public form — thank-you agent contact + footer precedence

**Files:**
- Modify: `apps/public-pages/src/pages/Enquiry.tsx` (context type `:66-73`; thank-you `:312-333`; merge block `:335-371`)

**Interfaces:**
- Consumes: Task 3 `get_enquiry_context` v2 (`agent_phone`, `unit_form_settings`).

- [ ] **Step 1: Extend `EnquiryContext`** (`:66-73`) with `agent_phone: string | null;` and `unit_form_settings: { footer_image_url?: string } | null;` (import `UnitFormSettings` from shared-types instead if Task 6 exported it — prefer the shared type).

- [ ] **Step 2: Thank-you copy** (`:312-333`). Replace the `thankYouMsg` conditional with:

```tsx
const agentContact = context?.agent_name
  ? { name: context.agent_name, phone: context.agent_phone }
  : null;
const thankYouMsg = agentContact
  ? `Thank you. Your agent ${agentContact.name} will be in touch with your car-insurance quotation soon.`
  : context?.kind === 'branch'
    ? `Thank you. ${context.merchant_name ?? 'The merchant'}${context.branch_name ? ` (${context.branch_name})` : ''} will be in touch with your car-insurance quotation soon.`
    : 'Thank you. Your agent will be in touch with your car-insurance quotation soon.';
```

and under the `<p>{thankYouMsg}</p>` line render, when `agentContact?.phone`:

```tsx
<p className="mt-2 text-sm text-slate-600">
  You can also reach {agentContact.name} directly at{' '}
  <a href={`tel:${agentContact.phone}`} className="font-medium underline">{agentContact.phone}</a>.
</p>
```

(This covers both link kinds: branch links with a tied agent now return `agent_name`/`agent_phone` from context v2; house links fall back to the merchant line.)

- [ ] **Step 3: Footer precedence.** In the merge block (`:335-371`), locate the footer-image resolution (the `footer_image_url` analog of `headerImageUrl` at `:341`; if the footer image is not currently rendered, add it symmetrical to the header image render) and set:

```tsx
const footerImageUrl =
  merchantForm?.footer_image_url ||
  context?.unit_form_settings?.footer_image_url ||
  formSettings?.footer_image_url ||
  null;
```

— partner > unit > admin, with `||` fallthrough matching the file's existing empty-string convention.

- [ ] **Step 4: Verify**

Run: `pnpm -r typecheck && pnpm --filter public-pages build`
Expected: both PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/public-pages/src/pages/Enquiry.tsx
git commit -m "feat(public): thank-you shows agent name+phone; footer precedence partner>unit>admin"
```

---

### Task 12: Admin — attendees date range, enquiries search, per-agent drill-down

**Files:**
- Modify: `apps/admin-portal/src/pages/Reports.tsx` (attendees tab `:380-430` area)
- Modify: `apps/admin-portal/src/pages/enquiries/EnquiryList.tsx` (filters `:51-79`, `:172-220`)
- Modify: `apps/admin-portal/src/pages/agents/AgentList.tsx` (row actions)

- [ ] **Step 1: Attendees date range.** In the attendees `TabsContent` of `Reports.tsx`, add local state `const [attFrom, setAttFrom] = useState(''); const [attTo, setAttTo] = useState('');` with two `<Input type="date">` (copy the From/To pair pattern from `RenewalsReportTab` at `:672-681`). Filter client-side on **check-in time** before rendering and before the CSV export at `:409-424`:

```tsx
const inRange = (a: AttendeeRow) => {
  if (!a.checkinTime) return !attFrom && !attTo;      // never checked in: only when unfiltered
  const d = a.checkinTime.slice(0, 10);
  return (!attFrom || d >= attFrom) && (!attTo || d <= attTo);
};
```

- [ ] **Step 2: Enquiries search.** In `EnquiryList.tsx` add `search` state + `Input` in the filter grid (`:172-220`; bump the grid to `sm:grid-cols-5` or wrap), and extend the `filtered` memo (`:69-79`) with the same `matchesSearch` predicate as Task 9 Step 2 (fields: `customer_name`, `customer_nric`, `customer_phone`, vehicle `car_plate` via `e.vehicles`).

- [ ] **Step 3: Per-agent drill-down.** Admin side reuses the existing Agent filter: (a) in `EnquiryList.tsx`, initialize `agentFilter` from the URL — read `useSearch`/`window.location.search` param `agent` (TanStack Router: add `validateSearch` on the enquiries route in `src/router.tsx` returning `{ agent?: string }`, then `const { agent } = Route.useSearch()` — mirror however other admin routes consume search params, or fall back to `new URLSearchParams(window.location.search).get('agent')` on mount); (b) in `AgentList.tsx` actions dropdown add "View enquiries" navigating to `/enquiries?agent=${agent.id}` — but note the admin agent list only shows roots+deputies (`useAgents` filter), so ALSO make the agent name in each `EnquiryList` row clickable, setting `agentFilter` to that row's agent — that covers plain Unit Agents.

- [ ] **Step 4: Verify**

Run: `pnpm -r typecheck && pnpm --filter admin-portal build`
Expected: both PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/admin-portal/src/pages/Reports.tsx apps/admin-portal/src/pages/enquiries/EnquiryList.tsx apps/admin-portal/src/pages/agents/AgentList.tsx apps/admin-portal/src/router.tsx
git commit -m "feat(admin): attendees date range, enquiries search, per-agent enquiry drill-down"
```

---

### Task 13: Admin — Partner summary report tab

**Files:**
- Modify: `apps/admin-portal/src/pages/Reports.tsx` (tabs `:175-181`)
- Modify: `apps/admin-portal/src/hooks/useReports.ts` (new hook)

**Interfaces:**
- Produces: `usePartnerPerformance()` returning `PartnerPerformance[] = { merchantId: string; merchantName: string; totalVehicles: number; submitted: number; quoted: number; renewed: number; lost: number; renewalPremiumTotal: number; giftTotal: number }[]`, computed from the existing admin `useEnquiries()` rows (vehicles carry per-car `merchant` + `status` + `renewal_premium_amount`) and `useSystemSettings()` (`customer_gift_rate_pct`) — **no schema guessing, no new query**: `giftTotal = Σ renewal_premium_amount × rate/100` over renewed vehicles.

- [ ] **Step 1: Write `usePartnerPerformance`** in `useReports.ts` as a pure memo hook over `useEnquiries()` + `useSystemSettings()` (import the hooks; group vehicles by `v.merchant?.id ?? 'unassigned'`, skipping `removed_at` vehicles; label unassigned "No partner"). Accept `(fromISO?: string, toISO?: string)` filtering on the parent enquiry's `created_at`.

- [ ] **Step 2: Add the tab.** In `Reports.tsx`: `<TabsTrigger value="partners">Partners</TabsTrigger>` after "Team Performance"; `TabsContent` renders From/To date inputs (RenewalsReportTab pattern), a summary `Table` (Partner, Enquiring cars, Submitted, Quoted, Renewed, Lost, Renewal premium, Est. gifts) sorted by totalVehicles desc, and a CSV export button using `downloadCsv('partner-performance', rows)` (`:68-81`).

- [ ] **Step 3: Verify**

Run: `pnpm -r typecheck && pnpm --filter admin-portal build`
Expected: both PASS.

- [ ] **Step 4: Commit**

```bash
git add apps/admin-portal/src/pages/Reports.tsx apps/admin-portal/src/hooks/useReports.ts
git commit -m "feat(admin): Partners performance report tab"
```

---

### Task 14: Combobox swaps + root exclusion

**Files:**
- Modify: `apps/admin-portal/src/pages/merchants/MerchantDetail.tsx` (BranchLinksDialog `:123-135`)
- Modify: `apps/admin-portal/src/pages/enquiries/EnquiryList.tsx` (reassign dialog Select `:336-340`)

- [ ] **Step 1: BranchLinksDialog.** Replace the "Tie to agent (optional)" `Select` (`MerchantDetail.tsx:123-135`) with `Combobox`: options = `[{ value: HOUSE_VALUE, label: 'House — no agent' }, ...agents.filter(a => a.parent_agent_id !== null).map(a => ({ value: a.id, label: `${a.name} (${a.agent_code})` }))]`. The `parent_agent_id !== null` filter implements "roots get no link" for branch links too — Unit Managers can no longer be tied. Check that `useAllAgents` selects `parent_agent_id`; add it to the select list if missing.

- [ ] **Step 2: Admin reassign dialog.** Replace the agent `Select` in the reassign `Dialog` (`EnquiryList.tsx:336-340`) with `Combobox` (options from `allAgents`, same label format, no filtering — admin may reassign to anyone active).

- [ ] **Step 3: Verify**

Run: `pnpm -r typecheck && pnpm --filter admin-portal build`
Expected: both PASS.

- [ ] **Step 4: Commit**

```bash
git add apps/admin-portal/src/pages/merchants/MerchantDetail.tsx apps/admin-portal/src/pages/enquiries/EnquiryList.tsx
git commit -m "feat(admin): searchable agent pickers; exclude Unit Managers from branch-link ties"
```

---

### Task 15: Staging deploy + client verification checklist

**Files:** none (operational).

- [ ] **Step 1: Apply migrations to staging** Supabase `lyjdlietzmmejrxjvwgp` via MCP `apply_migration`, in order: `20260721000001`, `...002`, `...003`, `...004` (names without the `.sql`; query = file contents). **Never `supabase db push`.**
- [ ] **Step 2: Deploy edge functions to staging** via MCP `deploy_edge_function`: `update-sub-agent` (new; multi-file layout not needed — single file), `delete-agent` (existing; keep `verify_jwt: true`).
- [ ] **Step 3: Frontend to staging:** push the branch to the staging tracking branch: `git push origin feat/partnership-round-6:refs/heads/feat/merchant-partnership --force-with-lease` — NOTE this diverges the staging branch from main until the round-6 PR merges; after merge, fast-forward it back to `main` (established pattern, see memory `staging-environment`).
- [ ] **Step 4: Manual verification on staging** (admin@test.com / agent@test.com, `@Abc1234`):
  1. Unit Manager edits a Unit Agent (name+tier+status+password) → changes persist, login works with new password.
  2. Unit Manager promotes an agent to Unit Admin; that deputy can edit a plain agent but gets 403 editing another deputy (check toast).
  3. Deputy cannot delete a deputy; Unit Manager can. Deleting an agent with an open enquiry → 409 message.
  4. Team Report filters by event.
  5. My Enquiries: search hits name/plate/IC/phone; Mark renewed advances expiry +1y and shows the stamp; the vehicle still shows for merchant confirm (status unchanged).
  6. Reassign within unit works; reassigning a customer with an out-of-unit enquiry fails with the friendly message.
  7. Root sees no My Link nav; `/my-link` shows the explainer.
  8. Unit footer: upload on My Agents → public enquiry form for one of the unit's agents shows it; a partner form-design footer still wins; admin default when both absent.
  9. Thank-you page: agent link shows name+phone; branch link with tied agent shows that agent; house link shows merchant copy.
  10. **Client's verification item:** create a branch link tied to a unit agent, submit as a new customer → enquiry lands with `agent_id` = that agent (visible in admin Enquiries). Record the result; fix only if broken (per spec).
  11. Admin: attendees date range trims CSV; enquiries search; drill-down from agent list; Partners tab totals sane; comboboxes filter as typed and roots are absent from branch-link tie options.
- [ ] **Step 5: Report results to the user** before any prod deployment. Prod rollout (after client sign-off): apply the same 4 migrations + 2 edge fns to `mjtdsevynrtcmafsnxsj`, merge PR to `main`, fast-forward `feat/merchant-partnership` to `main`.

---

## Self-Review Notes

- Spec coverage: item 1 → Tasks 4/5/7 (+glossary in 7/10/14 labels); item 2 → Task 8; item 3 → Tasks 1/2/9/10; item 4 → Tasks 12/13/14 + root-link retirement in Task 3/10; item 5 → Tasks 3/11; item 6 → Tasks 3/10/11; item 7 → Task 15 Step 4.10; rollout → Task 15.
- Deviation from spec (deliberate): audit stamp uses NEW columns `marked_renewed_at/by` instead of the existing `renewed_at/by`, because those are set by `confirm_vehicle_renewal` together with `status='renewed'` and reusing them would break the merchant gift flow's status guard.
- `update-sub-agent` refuses root targets — admin portal remains the only editor of Unit Managers (matches matrix row 7).
