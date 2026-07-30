# Partnership Round 7 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make admin, unit and agent enquiry numbers agree by removing a silent 1000-row API truncation, and add a per-unit enquiry summary report backed by a single SQL source.

**Architecture:** A shared `fetchAllRows()` helper pages every unbounded list query in 1000-row chunks with a deterministic `(created_at desc, id desc)` sort, replacing queries that PostgREST silently truncates. Two `SECURITY DEFINER` Postgres functions — `enquiry_unit_summary()` and `enquiry_agent_summary()` — compute the summary once, server-side, and all three portals render the same rows so their numbers cannot diverge.

**Tech Stack:** React 18 + Vite + TypeScript, TanStack Query/Router, Tailwind + shadcn/ui, Supabase (PostgreSQL 15, RLS), pnpm workspaces.

**Spec:** `docs/superpowers/specs/2026-07-30-partnership-round-7-design.md`

## Global Constraints

- **Branch:** `feat/partnership-round-7` (already created, cut from `feat/partnership-round-6`). Verify with `git rev-parse --abbrev-ref HEAD` before EVERY commit — this repo has concurrent workflows sharing one working tree and a commit has previously landed on the wrong branch.
- **No test runner exists.** There is no vitest/jest and eslint is not installed. Do NOT add one — `pnpm add <anything>` re-trips a known dual-zod tsc failure. Verification gates are `pnpm -r typecheck`, `pnpm build`, and the explicit SQL assertions written into each task.
- **Never run `supabase db push` against production.** Production migrations are applied with the Supabase MCP `apply_migration` tool only.
- **Production project:** `mjtdsevynrtcmafsnxsj` (BOP Website). **Staging project:** `lyjdlietzmmejrxjvwgp`.
- **Date semantics:** every date-range filter compares the Asia/Singapore calendar day, matching `usePartnerPerformance` (`apps/admin-portal/src/hooks/useReports.ts:434`). SQL uses `(created_at at time zone 'Asia/Singapore')::date`; TypeScript uses `toLocaleDateString('en-CA', { timeZone: 'Asia/Singapore' })`.
- **Single Supabase client:** import `supabase` from the app's `src/lib/supabase.ts` (which re-exports shared-ui). Never call `createClient()`.
- **Zod stays at 3.23.8** across all packages. Do not add or upgrade dependencies.
- **Production counts are moving.** Enquiries grew 1507 → 1508 during spec writing. Every numeric assertion below re-runs its SQL at verification time and compares UI against that fresh number — never against a number pasted from this document.
- **Vehicle statuses:** `submitted`, `quoted`, `renewed`, `lost`. "Open" means `submitted` or `quoted`. Removed cars (`removed_at is not null`) are excluded from every count.

---

## File Structure

| File | Responsibility |
| --- | --- |
| `packages/shared-ui/src/lib/fetchAllRows.ts` | Create. Generic PostgREST pagination helper. |
| `packages/shared-ui/src/index.ts` | Modify. Export the helper from the barrel. |
| `apps/admin-portal/src/hooks/useEnquiries.ts` | Modify. Page the enquiries list query. |
| Other admin/agent hooks (Tasks 3–4) | Modify. Page remaining unbounded list queries. |
| `supabase/migrations/20260730000001_enquiry_summary_rpcs.sql` | Create. Both summary RPCs + grants. |
| `apps/admin-portal/src/hooks/useEnquirySummary.ts` | Create. React Query wrappers for both RPCs. |
| `apps/admin-portal/src/pages/reports/EnquiriesReportTab.tsx` | Create. The new admin report tab. `Reports.tsx` is already ~1000 lines with two tab components inline; the new tab goes in its own file rather than growing it further. |
| `apps/admin-portal/src/pages/Reports.tsx` | Modify. Register the tab trigger + content. |
| `apps/agent-portal/src/hooks/useEnquirySummary.ts` | Create. Agent-side wrapper for `enquiry_agent_summary`. |
| `apps/agent-portal/src/pages/TeamReport.tsx` | Modify. Per-agent enquiry section for unit viewers. |
| `apps/agent-portal/src/pages/MyEnquiries.tsx` | Modify. Own-totals strip. |

---

### Task 1: `fetchAllRows()` pagination helper

**Files:**
- Create: `packages/shared-ui/src/lib/fetchAllRows.ts`
- Modify: `packages/shared-ui/src/index.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `fetchAllRows<T>(build: PageBuilder<T>, opts?: FetchAllOptions): Promise<T[]>` where
  `type PageBuilder<T> = (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>`
  and `interface FetchAllOptions { pageSize?: number; maxRows?: number; label?: string }`.
  Every later task calls this exact signature.

- [ ] **Step 1: Create the helper**

Create `packages/shared-ui/src/lib/fetchAllRows.ts`:

```ts
/**
 * PostgREST caps every response at `db.max_rows` (1000 on Supabase's default
 * config) and returns HTTP 200 with a PARTIAL array — no error is raised. An
 * unbounded `.select()` on a growing table therefore truncates silently: as of
 * 2026-07-30 the admin portal received 1000 of 1507 enquiries, which is why
 * admin, unit and agent views disagreed on the same agent's customer count.
 *
 * This helper pages through the full result set instead.
 *
 * The caller supplies a BUILDER rather than a query, because PostgREST query
 * builders are single-use — each page needs a freshly constructed query.
 *
 * The builder's ordering MUST be deterministic: order by a timestamp alone is
 * not, since tied values have no defined order between pages, so a row can be
 * returned twice or skipped entirely. Add `id` as a tiebreaker:
 *
 *   fetchAllRows<Row>((from, to) =>
 *     supabase.from('enquiries').select('...')
 *       .order('created_at', { ascending: false })
 *       .order('id', { ascending: false })
 *       .range(from, to))
 */
export type PageBuilder<T> = (
  from: number,
  to: number,
) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>;

export interface FetchAllOptions {
  /** Rows per request. Must not exceed the server's max-rows or paging stalls. */
  pageSize?: number;
  /** Safety ceiling. A query that reaches it should be aggregated server-side. */
  maxRows?: number;
  /** Query name used in the ceiling warning. */
  label?: string;
}

export async function fetchAllRows<T>(
  build: PageBuilder<T>,
  opts: FetchAllOptions = {},
): Promise<T[]> {
  const pageSize = opts.pageSize ?? 1000;
  const maxRows = opts.maxRows ?? 50000;
  const rows: T[] = [];

  for (let from = 0; from < maxRows; from += pageSize) {
    const { data, error } = await build(from, from + pageSize - 1);
    if (error) throw error;
    const page = data ?? [];
    rows.push(...page);
    // A short page means the server had nothing more to give.
    if (page.length < pageSize) return rows;
  }

  console.warn(
    `[fetchAllRows] hit the ${maxRows}-row ceiling${opts.label ? ` for ${opts.label}` : ''}; ` +
      'results are truncated. This query should be aggregated server-side.',
  );
  return rows;
}
```

- [ ] **Step 2: Export it from the barrel**

In `packages/shared-ui/src/index.ts`, add beside the other `lib` exports (the file starts with `export { cn } from './lib/utils';`):

```ts
export { fetchAllRows } from './lib/fetchAllRows';
export type { PageBuilder, FetchAllOptions } from './lib/fetchAllRows';
```

- [ ] **Step 3: Verify it compiles**

Run: `pnpm -r typecheck`
Expected: PASS with no errors.

- [ ] **Step 4: Commit**

```bash
git rev-parse --abbrev-ref HEAD   # MUST print feat/partnership-round-7
git add packages/shared-ui/src/lib/fetchAllRows.ts packages/shared-ui/src/index.ts
git commit -m "feat(shared): fetchAllRows — page past PostgREST's silent 1000-row cap"
```

---

### Task 2: Page the admin enquiries query (fixes the reported bug)

**Files:**
- Modify: `apps/admin-portal/src/hooks/useEnquiries.ts:75-93`

**Interfaces:**
- Consumes: `fetchAllRows` from Task 1.
- Produces: no signature change — `useEnquiries()` still returns `EnquiryListRow[]`, now complete.

- [ ] **Step 1: Record the ground truth before changing anything**

Run this against production (`mjtdsevynrtcmafsnxsj`) via the Supabase MCP `execute_sql` tool and write the three numbers down — they are the pass/fail bar for Step 4:

```sql
select
  (select count(*) from enquiries) as total,
  (select count(*) from enquiries e join agents a on a.id = e.agent_id
     where a.unit_name = 'DR88') as dr88,
  (select count(*) from enquiries e join agents a on a.id = e.agent_id
     where a.name ilike '%DOO CHANG%') as doo_chang;
```

As of 2026-07-30 this returned total 1508, dr88 266, doo_chang 2. Use the values YOUR run returns.

- [ ] **Step 2: Confirm the bug is reproducible**

Open the admin portal, go to Enquiries, set Unit = DR88, and read the "N enquiries" count under "Inbox".
Expected: a number well BELOW the `dr88` figure from Step 1 (~168 on 2026-07-30). Search "doo chang" and confirm only 1 row appears.

If the count already matches, stop — the environment differs from what this plan assumes, and the rest of the task needs re-checking.

- [ ] **Step 3: Page the query**

In `apps/admin-portal/src/hooks/useEnquiries.ts`, add `fetchAllRows` to the existing `@agent-system/shared-ui` imports (add an import line if the file has none), then replace the body of `useEnquiries` (lines 75-93) with:

```ts
export function useEnquiries() {
  return useQuery({
    queryKey: ['enquiries'],
    queryFn: async () => {
      // Paged: PostgREST caps a plain .select() at 1000 rows and returns 200 with
      // a partial array, which silently hid 507 of 1507 enquiries from admin.
      // `id` is a tiebreaker so page boundaries are deterministic.
      return fetchAllRows<EnquiryListRow>(
        (from, to) =>
          supabase
            .from('enquiries')
            .select(`
              id, customer_name, customer_phone, customer_email, customer_nric, staff_id, status, created_at, agent_id,
              merchant_id, merchant:merchants(id, name),
              agent:agents(id, name, agent_code, unit_name, parent_agent_id),
              vehicles:enquiry_vehicles(id, status, car_plate, insurance_expiry_date, road_tax_renewal, removed_at, removed_by_customer, renewal_premium_amount, merchant:merchants(id, name))
            `)
            .order('created_at', { ascending: false })
            .order('id', { ascending: false })
            .range(from, to) as unknown as PromiseLike<{
            data: EnquiryListRow[] | null;
            error: { message: string } | null;
          }>,
        { label: 'admin enquiries' },
      );
    },
  });
}
```

- [ ] **Step 4: Verify against the ground truth**

Run: `pnpm -r typecheck` — expected PASS.

Then in the running admin portal (hard-refresh first):
- Unit = DR88 → the Inbox count MUST equal the `dr88` number from Step 1.
- Clear filters → the count MUST equal `total` from Step 1.
- Search "doo chang" → MUST return exactly 2 rows, including **Isaac Ong Ing Rong** dated 9 Jul 2026.
- Click "Download report" with Unit = DR88 → the file MUST contain `dr88` data rows (plus the header).

Do not proceed until all four match exactly. "About right" is a failure.

- [ ] **Step 5: Commit**

```bash
git rev-parse --abbrev-ref HEAD   # MUST print feat/partnership-round-7
git add apps/admin-portal/src/hooks/useEnquiries.ts
git commit -m "fix(admin): page the enquiries query — 507 of 1507 rows were silently dropped"
```

---

### Task 3: Page the remaining admin queries

**Files:**
- Modify: `apps/admin-portal/src/hooks/useEnquiryAttachments.ts:19`, `useRenewalReport.ts:50`, `useRegistrations.ts`, `useReports.ts:90,:184,:349`, `useRewards.ts:37`, `useMerchantCommissions.ts:25`, `useMerchantSettlements.ts:25`, `useAgents.ts`, `useAllAgents.ts`

**Interfaces:**
- Consumes: `fetchAllRows` from Task 1.
- Produces: no signature changes. Every hook returns the same type, now complete.

- [ ] **Step 1: Audit which queries actually need paging**

Run:

```bash
grep -rn "\.from('" apps/admin-portal/src/hooks/*.ts
```

Include a query only if ALL of these hold:
- it targets a table that grows per transaction: `enquiries`, `enquiry_vehicles`, `enquiry_attachments`, `registrations`, `attendance`, `rewards`, `merchant_commissions`, `merchant_settlements`, `agents`;
- it returns a list (no `.single()`, no `.maybeSingle()`, no `head: true` count);
- it has no narrow server-side filter that bounds it below 1000 rows (e.g. `.eq('enquiry_id', id)` on one enquiry's attachments is bounded — skip it).

Write the resulting list down before editing; it is the checklist for Step 3.

- [ ] **Step 2: Apply the same transformation to each**

For every query on the list, wrap it exactly as Task 2 did. The shape is always:

```ts
const rows = await fetchAllRows<RowType>(
  (from, to) =>
    supabase
      .from('TABLE')
      .select(`EXISTING SELECT STRING, unchanged`)
      .order('created_at', { ascending: false })
      .order('id', { ascending: false })
      .range(from, to) as unknown as PromiseLike<{
      data: RowType[] | null;
      error: { message: string } | null;
    }>,
  { label: 'admin TABLE' },
);
```

Rules:
- Keep the existing `.select()` string and every existing `.eq()`/`.in()` filter untouched — only ordering and paging change.
- If the query already has an `.order()`, keep it as the primary sort and append `.order('id', …)` in the same direction as the tiebreaker.
- If the table has no `created_at` (check the column list first), order by `id` alone.
- Existing `if (error) throw error` handling is now inside the helper; delete the now-dead destructuring, and keep any post-processing (`.map()`, normalisation) operating on the returned array.

- [ ] **Step 3: Verify**

Run: `pnpm -r typecheck && pnpm build` — expected PASS.

Then click through the admin portal and confirm each touched page still renders and its counts have not gone DOWN: Enquiries, Reports (all five tabs), Rewards, Settlements, Gifts, Agents. Any page that now shows fewer rows than before means a filter was dropped during the edit — fix before committing.

Spot-check one number against SQL, e.g. for registrations:

```sql
select count(*) from registrations;
```

and compare with the Reports → Attendees row count with no filters applied.

- [ ] **Step 4: Commit**

```bash
git rev-parse --abbrev-ref HEAD   # MUST print feat/partnership-round-7
git add apps/admin-portal/src/hooks
git commit -m "fix(admin): page remaining list queries past the 1000-row cap"
```

---

### Task 4: Page the agent-portal queries

**Files:**
- Modify: `apps/agent-portal/src/hooks/useMyEnquiries.ts:31`, `useEnquiryAttachments.ts:22`, `useAgentLinks.ts:53,:171,:203`, `useRegistrations.ts`, `useTeamReport.ts:81`, `useMyCommissions.ts:20`, `useSubAgents.ts`

**Interfaces:**
- Consumes: `fetchAllRows` from Task 1.
- Produces: no signature changes.

- [ ] **Step 1: Audit**

Run:

```bash
grep -rn "\.from('" apps/agent-portal/src/hooks/*.ts
```

Apply the same three inclusion rules as Task 3, Step 1. Note that `useMyEnquiries(agentId, unitWide)` is bounded when `unitWide` is false (one agent's rows) but unbounded when true — a unit-wide viewer in J771 already reads 499 rows and will cross 1000. Page it regardless of the flag; the helper stops after one request when the result is short.

- [ ] **Step 2: Apply the transformation**

Same shape as Task 3, Step 2. One case needs care — `useMyEnquiries` chains `.is('vehicles.removed_at', null)` before `.order()`. Keep that filter in place and in the same position; only append the `id` tiebreaker and `.range()`:

```ts
return fetchAllRows<EnquiryWithDetails>(
  (from, to) => {
    let q = supabase
      .from('enquiries')
      .select(`
        *,
        agent:agents(id, name, agent_code),
        merchant:merchants(id, name),
        branch:merchant_branches(name, merchant:merchants(name)),
        vehicles:enquiry_vehicles(*, product:insurance_products(name), merchant:merchants(id, name))
      `)
      .is('vehicles.removed_at', null)
      .order('created_at', { ascending: false })
      .order('id', { ascending: false });
    if (!unitWide) q = q.eq('agent_id', agentId!);
    return q.range(from, to) as unknown as PromiseLike<{
      data: EnquiryWithDetails[] | null;
      error: { message: string } | null;
    }>;
  },
  { label: 'agent my-enquiries' },
);
```

- [ ] **Step 3: Verify**

Run: `pnpm -r typecheck && pnpm build` — expected PASS.

In the agent portal, log in as a unit manager of a large unit (J771 has 499 enquiries) and confirm My Enquiries lists all of them:

```sql
select count(*) from enquiries e join agents a on a.id = e.agent_id where a.unit_name = 'J771';
```

The on-screen count must equal that number. Also confirm a plain agent still sees ONLY their own enquiries — paging must not have widened anyone's visibility.

- [ ] **Step 4: Commit**

```bash
git rev-parse --abbrev-ref HEAD   # MUST print feat/partnership-round-7
git add apps/agent-portal/src/hooks
git commit -m "fix(agent): page list queries past the 1000-row cap"
```

---

### Task 5: Summary RPCs

**Files:**
- Create: `supabase/migrations/20260730000001_enquiry_summary_rpcs.sql`

**Interfaces:**
- Consumes: existing DB helpers `is_admin()`, `is_unit_viewer()`, `get_unit_root()`, `unit_member_ids()`, `get_agent_id()`.
- Produces:
  - `enquiry_unit_summary(p_from date, p_to date)` → `table(unit_name text, unit_root_id uuid, forms_submitted bigint, customers bigint, cars bigint, cars_open bigint, cars_renewed bigint, agents_active bigint)`
  - `enquiry_agent_summary(p_from date, p_to date, p_unit_root uuid)` → `table(agent_id uuid, agent_name text, agent_code text, unit_name text, forms_submitted bigint, customers bigint, cars bigint, cars_open bigint, cars_renewed bigint)`

  Tasks 6–8 call these exact names, argument orders and column names.

- [ ] **Step 1: Write the migration**

Create `supabase/migrations/20260730000001_enquiry_summary_rpcs.sql`:

```sql
-- Round 7: per-unit and per-agent enquiry summaries.
--
-- One SQL source of truth for both portals. The reported defect was that admin,
-- unit and agent views disagreed; having each client aggregate its own copy of
-- the rows is what let them drift, so both surfaces read these functions instead.
--
-- SECURITY DEFINER + the same helpers the RLS policies use, so "my unit" here
-- cannot diverge from what RLS enforces elsewhere.

-- Normalised IC: dedupes the same person across dash/space formatting variants,
-- the same normalisation reassign_customer_agent uses.
CREATE OR REPLACE FUNCTION enquiry_nric_norm(p_nric text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT upper(regexp_replace(coalesce(p_nric, ''), '[^a-zA-Z0-9]', '', 'g'));
$$;

CREATE OR REPLACE FUNCTION enquiry_unit_summary(
  p_from date DEFAULT NULL,
  p_to   date DEFAULT NULL
)
RETURNS TABLE (
  unit_name       text,
  unit_root_id    uuid,
  forms_submitted bigint,
  customers       bigint,
  cars            bigint,
  cars_open       bigint,
  cars_renewed    bigint,
  agents_active   bigint
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  WITH scoped AS (
    SELECT
      e.id,
      e.agent_id,
      enquiry_nric_norm(e.customer_nric) AS nric_norm,
      a.unit_name,
      COALESCE(a.parent_agent_id, a.id) AS unit_root_id
    FROM enquiries e
    LEFT JOIN agents a ON a.id = e.agent_id
    WHERE (p_from IS NULL OR (e.created_at AT TIME ZONE 'Asia/Singapore')::date >= p_from)
      AND (p_to   IS NULL OR (e.created_at AT TIME ZONE 'Asia/Singapore')::date <= p_to)
      AND (
        is_admin()
        OR (is_unit_viewer() AND e.agent_id IN (SELECT unit_member_ids()))
        OR (NOT is_admin() AND NOT is_unit_viewer() AND e.agent_id = get_agent_id())
      )
  )
  SELECT
    COALESCE(s.unit_name, 'House') AS unit_name,
    s.unit_root_id,
    count(DISTINCT s.id) AS forms_submitted,
    -- People with an IC dedupe by IC; IC-less enquiries (the nric_required=false
    -- path) each count as their own customer, since there is nothing to match on.
    count(DISTINCT s.nric_norm) FILTER (WHERE s.nric_norm <> '')
      + count(DISTINCT s.id) FILTER (WHERE s.nric_norm = '') AS customers,
    count(v.id) FILTER (WHERE v.removed_at IS NULL) AS cars,
    count(v.id) FILTER (WHERE v.removed_at IS NULL AND v.status IN ('submitted', 'quoted')) AS cars_open,
    count(v.id) FILTER (WHERE v.removed_at IS NULL AND v.status = 'renewed') AS cars_renewed,
    count(DISTINCT s.agent_id) AS agents_active
  FROM scoped s
  LEFT JOIN enquiry_vehicles v ON v.enquiry_id = s.id
  GROUP BY 1, 2
  ORDER BY 3 DESC;
$$;

CREATE OR REPLACE FUNCTION enquiry_agent_summary(
  p_from      date DEFAULT NULL,
  p_to        date DEFAULT NULL,
  p_unit_root uuid DEFAULT NULL
)
RETURNS TABLE (
  agent_id        uuid,
  agent_name      text,
  agent_code      text,
  unit_name       text,
  forms_submitted bigint,
  customers       bigint,
  cars            bigint,
  cars_open       bigint,
  cars_renewed    bigint
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  WITH scoped AS (
    SELECT
      e.id,
      e.agent_id,
      enquiry_nric_norm(e.customer_nric) AS nric_norm,
      a.name AS agent_name,
      a.agent_code,
      a.unit_name
    FROM enquiries e
    JOIN agents a ON a.id = e.agent_id
    WHERE (p_from IS NULL OR (e.created_at AT TIME ZONE 'Asia/Singapore')::date >= p_from)
      AND (p_to   IS NULL OR (e.created_at AT TIME ZONE 'Asia/Singapore')::date <= p_to)
      -- A unit viewer may only ask about their OWN unit: passing another unit's
      -- root returns nothing rather than that unit's data.
      AND (p_unit_root IS NULL OR COALESCE(a.parent_agent_id, a.id) = p_unit_root)
      AND (
        is_admin()
        OR (is_unit_viewer() AND e.agent_id IN (SELECT unit_member_ids()))
        OR (NOT is_admin() AND NOT is_unit_viewer() AND e.agent_id = get_agent_id())
      )
  )
  SELECT
    s.agent_id,
    s.agent_name,
    s.agent_code,
    s.unit_name,
    count(DISTINCT s.id) AS forms_submitted,
    count(DISTINCT s.nric_norm) FILTER (WHERE s.nric_norm <> '')
      + count(DISTINCT s.id) FILTER (WHERE s.nric_norm = '') AS customers,
    count(v.id) FILTER (WHERE v.removed_at IS NULL) AS cars,
    count(v.id) FILTER (WHERE v.removed_at IS NULL AND v.status IN ('submitted', 'quoted')) AS cars_open,
    count(v.id) FILTER (WHERE v.removed_at IS NULL AND v.status = 'renewed') AS cars_renewed
  FROM scoped s
  LEFT JOIN enquiry_vehicles v ON v.enquiry_id = s.id
  GROUP BY 1, 2, 3, 4
  ORDER BY 5 DESC;
$$;

REVOKE ALL ON FUNCTION enquiry_unit_summary(date, date) FROM public, anon;
REVOKE ALL ON FUNCTION enquiry_agent_summary(date, date, uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION enquiry_unit_summary(date, date) TO authenticated;
GRANT EXECUTE ON FUNCTION enquiry_agent_summary(date, date, uuid) TO authenticated;
```

- [ ] **Step 2: Apply to staging**

Use the Supabase MCP `apply_migration` tool against **staging** (`lyjdlietzmmejrxjvwgp`) with name `enquiry_summary_rpcs` and the SQL above.

- [ ] **Step 3: Verify the numbers reconcile**

Run against staging via `execute_sql`. This runs as the service role (admin path), so it exercises the aggregation, not the authz branches:

```sql
-- A: the RPC's own total must equal the raw table count.
select
  (select sum(forms_submitted) from enquiry_unit_summary(null, null)) as rpc_total,
  (select count(*) from enquiries) as table_total;

-- B: per-unit forms must match a direct group-by, including the House bucket.
select coalesce(a.unit_name, 'House') as unit, count(*) as expected
from enquiries e left join agents a on a.id = e.agent_id
group by 1 order by 2 desc;

select unit_name, forms_submitted from enquiry_unit_summary(null, null) order by forms_submitted desc;

-- C: customers <= forms in every row (a person can submit more than once,
--    never fewer), and cars_open + cars_renewed <= cars.
select * from enquiry_unit_summary(null, null)
where customers > forms_submitted or (cars_open + cars_renewed) > cars;

-- D: date filtering narrows rather than widens.
select sum(forms_submitted) from enquiry_unit_summary(current_date - 7, current_date);
```

Expected: A's two numbers identical; B's two lists identical row-for-row; **C returns zero rows**; D returns a number no larger than A.

- [ ] **Step 4: Verify the authz branches**

The checks above run as service role and bypass the role helpers, so test the scoped paths explicitly. In staging, get a unit root and a plain agent:

```sql
select id, name, unit_name, parent_agent_id, is_unit_manager from agents order by unit_name limit 20;
```

Then, logged into the staging **agent portal** browser session (Task 7 will surface this in the UI; for now use the browser devtools console on the agent portal origin, where the authenticated Supabase client already exists):

```js
// As a Unit Manager: their own unit returns rows...
await supabase.rpc('enquiry_agent_summary', { p_from: null, p_to: null, p_unit_root: '<own-unit-root-uuid>' })
// ...and another unit's root returns an EMPTY array, not that unit's data.
await supabase.rpc('enquiry_agent_summary', { p_from: null, p_to: null, p_unit_root: '<other-unit-root-uuid>' })
// As a plain agent: unit summary returns exactly ONE row, their own numbers.
await supabase.rpc('enquiry_unit_summary', { p_from: null, p_to: null })
```

Expected: the cross-unit call returns `data: []`. If it returns rows, the migration leaks data across units — stop and fix before going further.

- [ ] **Step 5: Commit**

```bash
git rev-parse --abbrev-ref HEAD   # MUST print feat/partnership-round-7
git add supabase/migrations/20260730000001_enquiry_summary_rpcs.sql
git commit -m "feat(db): enquiry_unit_summary + enquiry_agent_summary RPCs"
```

---

### Task 6: Admin Reports — Enquiries tab

**Files:**
- Create: `apps/admin-portal/src/hooks/useEnquirySummary.ts`
- Create: `apps/admin-portal/src/pages/reports/EnquiriesReportTab.tsx`
- Modify: `apps/admin-portal/src/pages/Reports.tsx` (tab list at :198-202, tab content near :629)

**Interfaces:**
- Consumes: the two RPCs from Task 5.
- Produces: `useEnquiryUnitSummary(from?: string, to?: string)` and `useEnquiryAgentSummary(from: string | undefined, to: string | undefined, unitRootId: string | null)` returning React Query results over `EnquiryUnitSummaryRow[]` / `EnquiryAgentSummaryRow[]`; `EnquiriesReportTab` as a default-free named export.

- [ ] **Step 1: Create the hooks**

Create `apps/admin-portal/src/hooks/useEnquirySummary.ts`:

```ts
import { useQuery } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';

export interface EnquiryUnitSummaryRow {
  unit_name: string;
  unit_root_id: string | null;
  forms_submitted: number;
  customers: number;
  cars: number;
  cars_open: number;
  cars_renewed: number;
  agents_active: number;
}

export interface EnquiryAgentSummaryRow {
  agent_id: string;
  agent_name: string;
  agent_code: string;
  unit_name: string;
  forms_submitted: number;
  customers: number;
  cars: number;
  cars_open: number;
  cars_renewed: number;
}

/** Per-unit enquiry totals. `from`/`to` are YYYY-MM-DD, compared on the
 *  Asia/Singapore calendar day inside the RPC. */
export function useEnquiryUnitSummary(from?: string, to?: string) {
  return useQuery({
    queryKey: ['enquiry-unit-summary', from ?? null, to ?? null],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('enquiry_unit_summary', {
        p_from: from || null,
        p_to: to || null,
      });
      if (error) throw error;
      return (data ?? []) as EnquiryUnitSummaryRow[];
    },
  });
}

/** Per-agent breakdown inside one unit. Disabled until a unit is expanded. */
export function useEnquiryAgentSummary(
  from: string | undefined,
  to: string | undefined,
  unitRootId: string | null,
) {
  return useQuery({
    queryKey: ['enquiry-agent-summary', from ?? null, to ?? null, unitRootId],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('enquiry_agent_summary', {
        p_from: from || null,
        p_to: to || null,
        p_unit_root: unitRootId,
      });
      if (error) throw error;
      return (data ?? []) as EnquiryAgentSummaryRow[];
    },
    enabled: !!unitRootId,
  });
}
```

- [ ] **Step 2: Create the tab component**

Create `apps/admin-portal/src/pages/reports/EnquiriesReportTab.tsx`. It mirrors the Team Performance tab: date inputs, a totals table, an expandable per-unit breakdown, CSV export. `downloadCsv` currently lives inside `Reports.tsx` (line 75) and is not exported — copy the same call shape by exporting it: add `export` to `function downloadCsv` in `Reports.tsx` and import it here.

```tsx
import { useState } from 'react';
import {
  Card, CardContent, CardDescription, CardHeader, CardTitle,
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
  Button, Label,
} from '@agent-system/shared-ui';
import { Download, ChevronDown, ChevronRight } from 'lucide-react';
import {
  useEnquiryUnitSummary,
  useEnquiryAgentSummary,
  type EnquiryUnitSummaryRow,
} from '../../hooks/useEnquirySummary';
import { downloadCsv } from '../Reports';

function UnitBreakdown({ unit, from, to }: { unit: EnquiryUnitSummaryRow; from: string; to: string }) {
  const { data: agents, isLoading } = useEnquiryAgentSummary(from || undefined, to || undefined, unit.unit_root_id);
  if (isLoading) return <p className="text-muted-foreground py-3 px-4 text-sm">Loading agents…</p>;
  if (!agents?.length) return <p className="text-muted-foreground py-3 px-4 text-sm">No agent activity in this range.</p>;
  return (
    <div className="overflow-auto rounded-md border">
      <Table>
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            <TableHead>Agent</TableHead>
            <TableHead className="text-right">Forms</TableHead>
            <TableHead className="text-right">Customers</TableHead>
            <TableHead className="text-right">Cars</TableHead>
            <TableHead className="text-right">Open</TableHead>
            <TableHead className="text-right">Renewed</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {agents.map((a) => (
            <TableRow key={a.agent_id}>
              <TableCell className="font-medium">
                {a.agent_name}
                <div className="text-xs text-muted-foreground">{a.agent_code}</div>
              </TableCell>
              <TableCell className="text-right">{a.forms_submitted}</TableCell>
              <TableCell className="text-right">{a.customers}</TableCell>
              <TableCell className="text-right text-muted-foreground">{a.cars}</TableCell>
              <TableCell className="text-right text-amber-600">{a.cars_open}</TableCell>
              <TableCell className="text-right text-emerald-600">{a.cars_renewed}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

export function EnquiriesReportTab() {
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [expanded, setExpanded] = useState<string | null>(null);
  const { data: units, isLoading } = useEnquiryUnitSummary(from || undefined, to || undefined);

  const totals = (units ?? []).reduce(
    (acc, u) => ({
      forms: acc.forms + u.forms_submitted,
      customers: acc.customers + u.customers,
      cars: acc.cars + u.cars,
      open: acc.open + u.cars_open,
      renewed: acc.renewed + u.cars_renewed,
    }),
    { forms: 0, customers: 0, cars: 0, open: 0, renewed: 0 },
  );

  return (
    <div className="flex flex-col gap-3">
      <Card>
        <CardHeader className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="space-y-1.5">
            <CardTitle>Enquiries by Unit</CardTitle>
            <CardDescription>
              Car-insurance enquiry forms grouped by unit · {units?.length ?? 0} unit
              {(units?.length ?? 0) === 1 ? '' : 's'} · {totals.forms} form
              {totals.forms === 1 ? '' : 's'}
            </CardDescription>
          </div>
          <div className="flex items-end gap-2">
            <div>
              <Label className="text-xs font-medium text-muted-foreground">From</Label>
              <input type="date" value={from} onChange={(e) => setFrom(e.target.value)}
                className="mt-1 block h-9 rounded-md border border-input bg-background px-3 text-sm" />
            </div>
            <div>
              <Label className="text-xs font-medium text-muted-foreground">To</Label>
              <input type="date" value={to} onChange={(e) => setTo(e.target.value)}
                className="mt-1 block h-9 rounded-md border border-input bg-background px-3 text-sm" />
            </div>
            <Button
              variant="outline"
              size="sm"
              disabled={!units?.length}
              onClick={() =>
                downloadCsv('enquiries-by-unit', [
                  ['Unit', 'Forms Submitted', 'Customers', 'Cars', 'Open', 'Renewed', 'Agents'],
                  ...(units ?? []).map((u) => [
                    u.unit_name, u.forms_submitted, u.customers, u.cars, u.cars_open, u.cars_renewed, u.agents_active,
                  ]),
                ])
              }
            >
              <Download className="size-4 mr-1.5" />
              Export
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <p className="text-muted-foreground text-center py-6">Loading units…</p>
          ) : (
            <div className="overflow-auto rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow className="hover:bg-transparent">
                    <TableHead>Unit</TableHead>
                    <TableHead className="text-right">Forms Submitted</TableHead>
                    <TableHead className="text-right">Customers</TableHead>
                    <TableHead className="text-right">Cars</TableHead>
                    <TableHead className="text-right">Open</TableHead>
                    <TableHead className="text-right">Renewed</TableHead>
                    <TableHead className="text-right">Agents</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(units ?? []).length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={7} className="text-center text-muted-foreground py-6">
                        No enquiries found for this date range.
                      </TableCell>
                    </TableRow>
                  ) : (
                    <>
                      {units!.map((u) => (
                        <TableRow key={u.unit_root_id ?? u.unit_name}>
                          <TableCell className="font-medium">
                            <button
                              type="button"
                              className="inline-flex items-center gap-1 hover:underline"
                              onClick={() =>
                                setExpanded(expanded === (u.unit_root_id ?? u.unit_name) ? null : (u.unit_root_id ?? u.unit_name))
                              }
                            >
                              {expanded === (u.unit_root_id ?? u.unit_name)
                                ? <ChevronDown className="size-4" />
                                : <ChevronRight className="size-4" />}
                              {u.unit_name}
                            </button>
                          </TableCell>
                          <TableCell className="text-right font-medium">{u.forms_submitted}</TableCell>
                          <TableCell className="text-right">{u.customers}</TableCell>
                          <TableCell className="text-right text-muted-foreground">{u.cars}</TableCell>
                          <TableCell className="text-right text-amber-600">{u.cars_open}</TableCell>
                          <TableCell className="text-right text-emerald-600">{u.cars_renewed}</TableCell>
                          <TableCell className="text-right text-muted-foreground">{u.agents_active}</TableCell>
                        </TableRow>
                      ))}
                      <TableRow className="hover:bg-transparent border-t-2">
                        <TableCell className="font-semibold">Total</TableCell>
                        <TableCell className="text-right font-semibold">{totals.forms}</TableCell>
                        <TableCell className="text-right font-semibold">{totals.customers}</TableCell>
                        <TableCell className="text-right font-semibold">{totals.cars}</TableCell>
                        <TableCell className="text-right font-semibold">{totals.open}</TableCell>
                        <TableCell className="text-right font-semibold">{totals.renewed}</TableCell>
                        <TableCell />
                      </TableRow>
                    </>
                  )}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {expanded && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">
              {(units ?? []).find((u) => (u.unit_root_id ?? u.unit_name) === expanded)?.unit_name} — by agent
            </CardTitle>
          </CardHeader>
          <CardContent>
            <UnitBreakdown
              unit={(units ?? []).find((u) => (u.unit_root_id ?? u.unit_name) === expanded)!}
              from={from}
              to={to}
            />
          </CardContent>
        </Card>
      )}
    </div>
  );
}
```

Note: the "House" row has `unit_root_id = null`, so expanding it calls the agent RPC with `p_unit_root: null`, which the `enabled` guard disables — House shows no breakdown, which is correct since those enquiries have no agent.

- [ ] **Step 3: Register the tab**

In `apps/admin-portal/src/pages/Reports.tsx`:
- add `export` to `function downloadCsv` (line 75) so the new file can import it;
- import the tab: `import { EnquiriesReportTab } from './reports/EnquiriesReportTab';`
- add the trigger after the Team Performance trigger (line 200):
  `<TabsTrigger value="unit-enquiries">Enquiries</TabsTrigger>`
- add the content after the `teams` TabsContent block (after line 626):
  `<TabsContent value="unit-enquiries" className="mt-4"><EnquiriesReportTab /></TabsContent>`

- [ ] **Step 4: Verify**

Run: `pnpm -r typecheck && pnpm build` — expected PASS.

Against staging, with no date filter:
- The **Total** row's "Forms Submitted" MUST equal `select count(*) from enquiries;`.
- Each unit row MUST match `select coalesce(a.unit_name,'House'), count(*) from enquiries e left join agents a on a.id=e.agent_id group by 1;`.
- Expanding a unit MUST show agents whose forms sum to that unit's forms.
- Setting From/To to a single busy day MUST reduce the total, and match
  `select count(*) from enquiries where (created_at at time zone 'Asia/Singapore')::date = '<that day>';`
- Export MUST download a CSV whose rows match the table.

- [ ] **Step 5: Commit**

```bash
git rev-parse --abbrev-ref HEAD   # MUST print feat/partnership-round-7
git add apps/admin-portal/src/hooks/useEnquirySummary.ts apps/admin-portal/src/pages/reports/EnquiriesReportTab.tsx apps/admin-portal/src/pages/Reports.tsx
git commit -m "feat(admin): Enquiries-by-unit report tab with per-agent drill-down"
```

---

### Task 7: Unit Manager — enquiry summary on Team Report

**Files:**
- Create: `apps/agent-portal/src/hooks/useEnquirySummary.ts`
- Modify: `apps/agent-portal/src/pages/TeamReport.tsx`

**Interfaces:**
- Consumes: `enquiry_agent_summary` from Task 5; `useAuth()` (`agent`, `isUnitViewer`) from `apps/agent-portal/src/hooks/useAuth.ts`.
- Produces: `useUnitEnquirySummary(unitRootId: string | undefined, enabled: boolean)` returning a React Query result over `AgentEnquirySummaryRow[]`.

- [ ] **Step 1: Create the hook**

Create `apps/agent-portal/src/hooks/useEnquirySummary.ts`:

```ts
import { useQuery } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';

export interface AgentEnquirySummaryRow {
  agent_id: string;
  agent_name: string;
  agent_code: string;
  unit_name: string;
  forms_submitted: number;
  customers: number;
  cars: number;
  cars_open: number;
  cars_renewed: number;
}

/**
 * Per-agent enquiry totals for the caller's own unit. The RPC ignores any unit
 * root that is not the caller's own, so a manager cannot read another unit even
 * by passing its id.
 */
export function useUnitEnquirySummary(unitRootId: string | undefined, enabled: boolean) {
  return useQuery({
    queryKey: ['unit-enquiry-summary', unitRootId],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('enquiry_agent_summary', {
        p_from: null,
        p_to: null,
        p_unit_root: unitRootId,
      });
      if (error) throw error;
      return (data ?? []) as AgentEnquirySummaryRow[];
    },
    enabled: enabled && !!unitRootId,
  });
}
```

- [ ] **Step 2: Render it on Team Report**

In `apps/agent-portal/src/pages/TeamReport.tsx`, `unitRoot` and `enabled` already exist (`const unitRoot = agent?.parent_agent_id ?? agent?.id;` and `const enabled = isUnitViewer && !!agent?.id;`). Add the import and the hook call beside the existing `useUnitTeamReport` call:

```tsx
import { useUnitEnquirySummary } from '../hooks/useEnquirySummary';
// …
const { data: enquirySummary, isLoading: enquiryLoading } = useUnitEnquirySummary(unitRoot, enabled);
```

Then add this Card at the end of the page's returned JSX, after the existing team-performance content:

```tsx
<Card>
  <CardHeader>
    <CardTitle>Car Enquiries by Agent</CardTitle>
    <CardDescription>
      Enquiry forms customers submitted through each agent's link ·{' '}
      {(enquirySummary ?? []).reduce((n, r) => n + r.forms_submitted, 0)} total
    </CardDescription>
  </CardHeader>
  <CardContent>
    {enquiryLoading ? (
      <TableSkeleton rows={4} columns={6} />
    ) : (enquirySummary ?? []).length === 0 ? (
      <p className="text-muted-foreground text-center py-6">No enquiries yet for this unit.</p>
    ) : (
      <div className="overflow-auto rounded-md border">
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead>Agent</TableHead>
              <TableHead className="text-right">Forms</TableHead>
              <TableHead className="text-right">Customers</TableHead>
              <TableHead className="text-right">Cars</TableHead>
              <TableHead className="text-right">Open</TableHead>
              <TableHead className="text-right">Renewed</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {(enquirySummary ?? []).map((r) => (
              <TableRow key={r.agent_id}>
                <TableCell className="font-medium">
                  {r.agent_name}
                  <div className="text-xs text-muted-foreground">{r.agent_code}</div>
                </TableCell>
                <TableCell className="text-right font-medium">{r.forms_submitted}</TableCell>
                <TableCell className="text-right">{r.customers}</TableCell>
                <TableCell className="text-right text-muted-foreground">{r.cars}</TableCell>
                <TableCell className="text-right text-amber-600">{r.cars_open}</TableCell>
                <TableCell className="text-right text-emerald-600">{r.cars_renewed}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    )}
  </CardContent>
</Card>
```

`Card`, `CardHeader`, `CardTitle`, `CardDescription`, `CardContent`, `Table*` and `TableSkeleton` are already imported at the top of this file — do not duplicate the imports.

- [ ] **Step 3: Verify**

Run: `pnpm -r typecheck && pnpm build` — expected PASS.

On staging, log in as a Unit Manager and confirm:
- the agent rows cover only their own unit;
- the totals for a given agent match what the admin Enquiries tab (Task 6) shows for that same agent — this is the whole point of the shared RPC, so a mismatch is a blocker;
- a plain agent (not a unit viewer) does not see this card at all.

- [ ] **Step 4: Commit**

```bash
git rev-parse --abbrev-ref HEAD   # MUST print feat/partnership-round-7
git add apps/agent-portal/src/hooks/useEnquirySummary.ts apps/agent-portal/src/pages/TeamReport.tsx
git commit -m "feat(agent): per-agent car-enquiry summary on unit Team Report"
```

---

### Task 8: Agent — own totals on My Enquiries

**Files:**
- Modify: `apps/agent-portal/src/pages/MyEnquiries.tsx`

**Interfaces:**
- Consumes: the already-fetched enquiry rows on that page (Task 4 made them complete). No new query — the page holds every row it needs, and reusing them keeps the strip consistent with the list and the date filters directly above it.
- Produces: nothing.

- [ ] **Step 1: Locate the filtered rows**

Run:

```bash
grep -n "useMemo\|filtered\|const rows\|dateFrom\|dateTo\|statusFilter" apps/agent-portal/src/pages/MyEnquiries.tsx | head -30
```

Identify the memo that produces the array actually rendered as cards (the one all filters have been applied to). The strip must be derived from THAT array, so it always agrees with what is on screen.

- [ ] **Step 2: Add the totals strip**

Immediately after that memo, add:

```tsx
// Totals for the rows currently on screen, so the strip always agrees with the
// list below it (and with the unit/admin summaries, which count the same way:
// customers dedupe by normalised IC, removed cars are excluded).
const totals = useMemo(() => {
  const norm = (s: string | null) => (s ?? '').replace(/[^a-zA-Z0-9]/g, '').toUpperCase();
  const ics = new Set<string>();
  let icLess = 0;
  let cars = 0;
  let open = 0;
  let renewed = 0;
  for (const e of visibleEnquiries) {
    const ic = norm(e.customer_nric);
    if (ic) ics.add(ic);
    else icLess += 1;
    for (const v of e.vehicles ?? []) {
      if (v.removed_at) continue;
      cars += 1;
      if (v.status === 'submitted' || v.status === 'quoted') open += 1;
      if (v.status === 'renewed') renewed += 1;
    }
  }
  return { forms: visibleEnquiries.length, customers: ics.size + icLess, cars, open, renewed };
}, [visibleEnquiries]);
```

Replace `visibleEnquiries` with the actual variable name found in Step 1, in both the loop and the dependency array.

Render it directly above the enquiry cards:

```tsx
<div className="flex flex-wrap gap-x-6 gap-y-1 rounded-md border bg-muted/40 px-4 py-2 text-sm">
  <span><strong>{totals.forms}</strong> form{totals.forms === 1 ? '' : 's'}</span>
  <span><strong>{totals.customers}</strong> customer{totals.customers === 1 ? '' : 's'}</span>
  <span><strong>{totals.cars}</strong> car{totals.cars === 1 ? '' : 's'}</span>
  <span className="text-amber-600"><strong>{totals.open}</strong> open</span>
  <span className="text-emerald-600"><strong>{totals.renewed}</strong> renewed</span>
</div>
```

- [ ] **Step 3: Verify**

Run: `pnpm -r typecheck && pnpm build` — expected PASS.

On staging, as a plain agent:
- the "forms" number MUST equal the number of enquiry cards rendered;
- changing the date filter MUST change the strip in step with the list;
- for DOO CHANG CHEAK on production after rollout, the strip reads 2 forms / 2 customers, matching both the unit Team Report and the admin tab.

- [ ] **Step 4: Commit**

```bash
git rev-parse --abbrev-ref HEAD   # MUST print feat/partnership-round-7
git add apps/agent-portal/src/pages/MyEnquiries.tsx
git commit -m "feat(agent): totals strip on My Enquiries"
```

---

### Task 9: Rollout

**Files:** none (deployment only).

**Interfaces:**
- Consumes: everything above.
- Produces: the feature live on staging, then production.

- [ ] **Step 1: Apply the migration to production**

Use the Supabase MCP `apply_migration` tool against **production** (`mjtdsevynrtcmafsnxsj`), name `enquiry_summary_rpcs`, with the exact SQL from Task 5. Do NOT use `supabase db push`.

This happens BEFORE the frontend merges: the deployed apps call RPCs that must already exist, and the RPCs are additive, so applying them early breaks nothing.

- [ ] **Step 2: Re-run the reconciliation checks against production**

Re-run Task 5's queries A–D against `mjtdsevynrtcmafsnxsj`. Expected: A's totals identical, B's lists identical, **C returns zero rows**, D no larger than A.

- [ ] **Step 3: Push the branch and open the PR**

```bash
git rev-parse --abbrev-ref HEAD   # MUST print feat/partnership-round-7
git push -u origin feat/partnership-round-7
gh pr create --base main --title "Partnership round 7: unit enquiry summary + row-cap tally fix" --body "$(cat <<'EOF'
## Summary
- Fixes the admin/unit/agent tally mismatch: PostgREST silently capped the admin enquiries query at 1000 rows, hiding 507 of 1507 enquiries (DR88 read 168 instead of 266; an agent's 2 enquiries showed as 1). All list queries now page.
- Adds an Enquiries-by-Unit report: forms submitted, unique customers, cars, open and renewed, per unit with a per-agent drill-down.
- Admin, Unit Manager and agent surfaces all read the same SQL functions, so their numbers cannot drift apart again.

## Deploy order
DB migration `enquiry_summary_rpcs` is applied to staging and production BEFORE this merges.

## Verification
Counts checked against SQL on production data — see `docs/superpowers/specs/2026-07-30-partnership-round-7-design.md`.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

- [ ] **Step 4: Staging sign-off**

Deploy the branch to the staging Render sites and confirm with the user before merging. Merging to `main` auto-deploys production.

---

## Self-Review

**Spec coverage:**

| Spec requirement | Task |
| --- | --- |
| `fetchAll()` helper, 1000-row pages, `(created_at desc, id desc)`, 50k ceiling | 1 |
| Admin enquiries truncation fixed; DR88 = 266, "doo chang" = 2 | 2 |
| Remaining admin queries paged | 3 |
| Agent queries paged (incl. unit-wide path) | 4 |
| `enquiry_unit_summary()` with all 8 columns, House bucket, SG day boundaries | 5 |
| `enquiry_agent_summary()` with cross-unit denial | 5 |
| Admin Reports "Enquiries" tab, date range, drill-down, CSV | 6 |
| Unit Manager per-agent section on Team Report | 7 |
| Agent totals line on My Enquiries | 8 |
| Migration to staging → prod before merge; staging sign-off | 5, 9 |
| Both `forms_submitted` and `customers` shown | 5, 6, 7, 8 |

No spec requirement is unassigned.

**Type consistency:** `fetchAllRows` / `PageBuilder` / `FetchAllOptions` are used identically in Tasks 2–4. The RPC column names in Task 5 match the TypeScript interfaces in Tasks 6–7 field for field (`forms_submitted`, `customers`, `cars`, `cars_open`, `cars_renewed`, `agents_active`, `unit_root_id`, `agent_code`). `useEnquiryAgentSummary` (admin) and `useUnitEnquirySummary` (agent) are deliberately different names for different call patterns over the same RPC.

**Known deviation from the skill's TDD default:** this repo has no test runner and adding one is blocked by a known dependency conflict, so each task substitutes executable SQL assertions and measured UI comparisons for automated tests. Every verification step names an exact expected value rather than "looks right".
