# Merchant Partnership — Phase 2: Public Capture (Branch QR + Enquiry Form) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the public customer-capture path: a SECURITY-DEFINER `submit_enquiry()` RPC (anon) that resolves a branch `link_code` → snapshots `merchant_branch_id` + `agent_id`, inserts an `enquiries` header + N `enquiry_vehicles`, normalizes NRIC/phone in SQL, and raises a friendly error on the per-branch dedup; a companion `get_branch_link_context()` RPC (anon) that returns only public display fields for an active link (no broad anon SELECT on merchants/branches); admin per-branch "Generate link / QR" UI in `MerchantDetail.tsx`; and the public `/public/enquiry/$linkCode` page (resolve → multi-vehicle form → submit → thank-you).

**Architecture:** One additive SQL migration adds the two anon RPCs (mirrors `register_attendee` from `20260313000001_shareable_links_redesign.sql`). Admin link generation copies the `MyLinks.tsx` create-link + copyable-URL pattern, adding a `qrcode.react` QR per link, fed by a new `useBranchLinks.ts` TanStack Query hook. The public page copies `Register.tsx`'s resolve→form→submit→thank-you shell, swapping the single-row form for a `react-hook-form` `useFieldArray` multi-vehicle sub-form, the insurance-product `<Select>` sourced from the anon-readable `insurance_products` table.

**Tech Stack:** Supabase (Postgres 15 + RLS, SECURITY DEFINER RPC), React 18 + Vite + TypeScript, TanStack Router (code-based routes in `src/router.tsx`), TanStack Query, shadcn/ui (`@agent-system/shared-ui`), react-hook-form + zod, `qrcode.react`, pnpm workspaces.

## Global Constraints

- **No test framework** in this repo. Verify frontend with `pnpm --filter <app> build` (runs `tsc && vite build`). **Never add vitest/jest/any test runner.**
- **DB verification uses `migration up`, NOT `db reset`.** Apply with `npx supabase migration up` (requires `npx supabase start` first). Run SQL assertions through the running container — **local `psql` is NOT installed** — via `docker exec supabase_db_DATA psql -U postgres -d postgres -tAc "<SQL>"` (use `docker exec -i ... psql -U postgres -d postgres <<'SQL' ... SQL` heredocs for multi-statement blocks). The DB container for this project (dir `DATA`) is `supabase_db_DATA`.
- **Migration filenames:** `supabase/migrations/YYYYMMDDNNNNNN_name.sql`, strictly increasing after the latest existing (`20260627000003`). Phase 2 uses **`20260628000001`**. Phase 3 will use `20260628000010..`, Phase 4 `20260628000020..`. Apply locally via `npx supabase migration up` (NOT `db push`); production is applied later via MCP `apply_migration`.
- **Reuse existing DB helpers — do NOT redefine:** trigger fn `update_updated_at()`, RLS helpers `is_admin()` (reads `app_metadata.role`) and `get_agent_id()`. Phase 1 already created all tables, enums, RLS, and the anon SELECT policy on active `insurance_products`.
- **Phone/NRIC normalization** in the RPC must mirror `supabase/functions/_shared/nric-utils.ts` (`normalizeNric`: strip non-alphanumeric + uppercase) and `_shared/phone-utils.ts` (`toMalaysianMsisdn`: digits-only canonical `60XXXXXXXXX`). Inline these as SQL `regexp_replace`/`upper` — do not call the TS files.
- **No new anon SELECT** on `merchants`, `merchant_branches`, `branch_links`, `enquiries`, or `enquiry_vehicles` (PDPA). All public reads/writes go through the two SECURITY DEFINER RPCs granted to `anon`. The only direct anon SELECT is the already-existing one on active `insurance_products`.
- **Supabase client:** in every app import `supabase` from `../lib/supabase` (single shared-ui client). Never call `createClient`.
- **Public URL shape:** `${import.meta.env.VITE_PUBLIC_PAGES_URL || window.location.origin}/public/enquiry/${link_code}` (mirrors the `/public/register/${link_code}` pattern in `MyLinks.tsx`).
- **QR rendering:** `import { QRCodeSVG } from 'qrcode.react'` — already a dependency in both `admin-portal` (^3.1.0) and `public-pages` (^3.2.0).
- **Money/labels:** UI labels this area **"Partnerships."** No money is touched in Phase 2 (ledgers are Phase 3).
- **Git:** work on branch `feat/merchant-partnership`; one commit per task; never commit to `main`.

---

## File Structure

**Created:**
- `supabase/migrations/20260628000001_submit_enquiry.sql` — `get_branch_link_context(text)` + `submit_enquiry(text,text,text,text,text,jsonb)` SECURITY DEFINER RPCs + anon grants
- `apps/admin-portal/src/hooks/useBranchLinks.ts` — list / create (house link) / deactivate branch links
- `apps/public-pages/src/pages/Enquiry.tsx` — public enquiry page (resolve → multi-vehicle form → submit → thank-you)

**Modified:**
- `apps/admin-portal/src/pages/merchants/MerchantDetail.tsx` — per-branch "Links" action + `BranchLinksDialog` (generate house link, list links, QR + copyable URL, deactivate)
- `apps/public-pages/src/router.tsx` — add `/public/enquiry/$linkCode` route

**Unchanged (already shipped in Phase 1, consumed here):** `packages/shared-types/src/merchant.ts` (`BranchLink`, `Enquiry`, `EnquiryVehicle`, `InsuranceProduct`), the `insurance_products` anon SELECT policy, all merchant tables/enums.

---

## Task 1: Migration — `get_branch_link_context` + `submit_enquiry` anon RPCs

**Files:**
- Create: `supabase/migrations/20260628000001_submit_enquiry.sql`

**Interfaces:**
- Consumes: tables `branch_links`, `merchant_branches`, `merchants`, `enquiries`, `enquiry_vehicles` (Phase 1); the unique index `uq_enquiry_vehicle_dedup` (Phase 1).
- Produces: RPCs `get_branch_link_context(p_link_code text)` → `TABLE(merchant_name text, merchant_logo_url text, branch_name text)` and `submit_enquiry(p_link_code text, p_customer_name text, p_customer_nric text, p_customer_phone text, p_customer_email text, p_vehicles jsonb)` → `uuid`; both `GRANT EXECUTE … TO anon`. Error codes: `P0001` (link inactive/not found), `P0006` (no vehicles), `P0007` (per-branch duplicate vehicle).

- [ ] **Step 1: Write the migration file**

Create `supabase/migrations/20260628000001_submit_enquiry.sql`:

```sql
-- ============================================================
-- Merchant Partnership — Phase 2: public enquiry capture
-- get_branch_link_context (public display fields) +
-- submit_enquiry (header + N vehicles, atomic).
-- Both SECURITY DEFINER, granted to anon. No broad anon SELECT
-- on merchants / branches / enquiries (PDPA): the form reads
-- only what these two functions return + active insurance_products.
-- ============================================================

-- Resolve an ACTIVE branch link to its public display fields only.
-- Returns 0 rows for an unknown or deactivated link (frontend treats
-- empty as "invalid / inactive link").
CREATE OR REPLACE FUNCTION get_branch_link_context(p_link_code text)
RETURNS TABLE (
  merchant_name     text,
  merchant_logo_url text,
  branch_name       text
) AS $$
  SELECT m.name, m.logo_url, b.name
  FROM branch_links bl
  JOIN merchant_branches b ON b.id = bl.merchant_branch_id
  JOIN merchants m         ON m.id = b.merchant_id
  WHERE bl.link_code = p_link_code
    AND bl.is_active = true;
$$ LANGUAGE sql SECURITY DEFINER STABLE;

-- Public enquiry submission. Atomic: the whole enquiry rolls back if any
-- vehicle is a duplicate. p_vehicles is a jsonb array of objects:
--   { "car_plate": text, "expiry_date": "YYYY-MM-DD", "insurance_product_id": uuid }
CREATE OR REPLACE FUNCTION submit_enquiry(
  p_link_code      text,
  p_customer_name  text,
  p_customer_nric  text,
  p_customer_phone text,
  p_customer_email text,
  p_vehicles       jsonb
) RETURNS uuid AS $$
DECLARE
  v_link       branch_links%ROWTYPE;
  v_enquiry_id uuid;
  v_nric_norm  text;
  v_phone_norm text;
  v_digits     text;
  v_vehicle    jsonb;
BEGIN
  -- 1. Resolve the branch link (must be active). FOR UPDATE serializes
  --    concurrent submits on the same link and snapshots agent_id cleanly.
  SELECT * INTO v_link
  FROM branch_links
  WHERE link_code = p_link_code AND is_active = true
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Link not found or inactive' USING ERRCODE = 'P0001';
  END IF;

  -- 2. Require at least one vehicle.
  IF p_vehicles IS NULL
     OR jsonb_typeof(p_vehicles) <> 'array'
     OR jsonb_array_length(p_vehicles) = 0 THEN
    RAISE EXCEPTION 'At least one vehicle is required' USING ERRCODE = 'P0006';
  END IF;

  -- 3. Normalize NRIC: strip non-alphanumerics + uppercase (mirrors normalizeNric()).
  v_nric_norm := upper(regexp_replace(coalesce(p_customer_nric, ''), '[^a-zA-Z0-9]', '', 'g'));

  -- 4. Normalize phone to canonical Malaysian MSISDN "60XXXXXXXXX"
  --    (mirrors toMalaysianMsisdn()).
  v_digits := regexp_replace(coalesce(p_customer_phone, ''), '\D', '', 'g');
  IF left(v_digits, 2) = '60' THEN
    v_phone_norm := v_digits;
  ELSE
    v_digits := regexp_replace(v_digits, '^0+', '');
    v_phone_norm := CASE WHEN v_digits = '' THEN '' ELSE '60' || v_digits END;
  END IF;

  -- 5. Insert the enquiry header. Snapshot branch + agent from the link.
  INSERT INTO enquiries (
    branch_link_id, merchant_branch_id, agent_id,
    customer_name,
    customer_nric, customer_nric_normalized,
    customer_phone, customer_phone_normalized,
    customer_email,
    status
  ) VALUES (
    v_link.id, v_link.merchant_branch_id, v_link.agent_id,
    p_customer_name,
    p_customer_nric, v_nric_norm,
    p_customer_phone, v_phone_norm,
    NULLIF(trim(coalesce(p_customer_email, '')), ''),
    'open'
  ) RETURNING id INTO v_enquiry_id;

  -- 6. Insert each vehicle. Denormalize merchant_branch_id for the dedup index;
  --    normalize plate the same way as NRIC (strip + uppercase). Catch the
  --    per-branch unique violation and re-raise as a friendly P0007 — this
  --    aborts the whole transaction so no partial enquiry is left behind.
  FOR v_vehicle IN SELECT * FROM jsonb_array_elements(p_vehicles)
  LOOP
    BEGIN
      INSERT INTO enquiry_vehicles (
        enquiry_id, merchant_branch_id,
        car_plate, car_plate_normalized,
        insurance_expiry_date, insurance_product_id,
        status
      ) VALUES (
        v_enquiry_id, v_link.merchant_branch_id,
        v_vehicle->>'car_plate',
        upper(regexp_replace(coalesce(v_vehicle->>'car_plate', ''), '[^a-zA-Z0-9]', '', 'g')),
        (v_vehicle->>'expiry_date')::date,
        (v_vehicle->>'insurance_product_id')::uuid,
        'submitted'
      );
    EXCEPTION WHEN unique_violation THEN
      RAISE EXCEPTION 'This vehicle (plate %, expiry %) has already been submitted at this branch.',
        v_vehicle->>'car_plate', v_vehicle->>'expiry_date'
        USING ERRCODE = 'P0007';
    END;
  END LOOP;

  RETURN v_enquiry_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Anon may call both functions (and only these — the underlying tables stay RLS-locked).
GRANT EXECUTE ON FUNCTION get_branch_link_context(text) TO anon;
GRANT EXECUTE ON FUNCTION submit_enquiry(text, text, text, text, text, jsonb) TO anon;
```

- [ ] **Step 2: Start the stack and apply the new migration (NOT a reset)**

Run:
```bash
npx supabase start
npx supabase migration up
```
Expected: `migration up` reports `20260628000001_submit_enquiry.sql` applied; no errors. (If `start` reports the stack is already running, that is fine.)

- [ ] **Step 3: Assert the functions exist and are anon-executable**

Run:
```bash
docker exec supabase_db_DATA psql -U postgres -d postgres -tAc \
"SELECT proname FROM pg_proc WHERE proname IN ('submit_enquiry','get_branch_link_context') ORDER BY proname;"
docker exec supabase_db_DATA psql -U postgres -d postgres -tAc \
"SELECT has_function_privilege('anon','submit_enquiry(text,text,text,text,text,jsonb)','EXECUTE'), has_function_privilege('anon','get_branch_link_context(text)','EXECUTE');"
```
Expected: both function names listed; both privilege checks return `t`.

- [ ] **Step 4: Functional smoke test (header + N vehicles, dedup, agent snapshot) — runs in a rolled-back transaction**

Run (heredoc; the trailing `ROLLBACK` discards all test rows so the local DB stays clean):
```bash
docker exec -i supabase_db_DATA psql -U postgres -d postgres <<'SQL'
BEGIN;
DO $$
DECLARE
  v_merchant uuid;
  v_branch   uuid;
  v_link     text := 'phase2-smoke-link';
  v_prod     uuid;
  v_enq      uuid;
  v_vcount   int;
  v_agent    uuid;
  v_dup_ok   boolean := false;
BEGIN
  INSERT INTO merchants (name, status, gift_pool_amount, merchant_share_pct)
    VALUES ('SmokeMerchant', 'active', 1000, 40) RETURNING id INTO v_merchant;
  INSERT INTO merchant_branches (merchant_id, name, status)
    VALUES (v_merchant, 'Smoke HQ', 'active') RETURNING id INTO v_branch;
  -- House link (agent_id NULL) — exercises the untied snapshot path.
  INSERT INTO branch_links (merchant_branch_id, agent_id, link_code, is_active)
    VALUES (v_branch, NULL, v_link, true);
  SELECT id INTO v_prod FROM insurance_products WHERE is_active ORDER BY sort_order LIMIT 1;

  -- get_branch_link_context returns the public display fields.
  PERFORM 1 FROM get_branch_link_context(v_link) WHERE merchant_name = 'SmokeMerchant' AND branch_name = 'Smoke HQ';
  IF NOT FOUND THEN RAISE EXCEPTION 'FAIL: get_branch_link_context did not return display fields'; END IF;

  -- submit_enquiry inserts 1 header + 2 vehicles; phone/NRIC normalized.
  v_enq := submit_enquiry(
    v_link, 'Smoke Customer', '810315-14-5701', '012-345 6789', 'smoke@test.com',
    jsonb_build_array(
      jsonb_build_object('car_plate','WXY 1234','expiry_date','2026-12-31','insurance_product_id', v_prod),
      jsonb_build_object('car_plate','ABC 9999','expiry_date','2027-01-15','insurance_product_id', v_prod)
    )
  );

  SELECT count(*) INTO v_vcount FROM enquiry_vehicles WHERE enquiry_id = v_enq;
  IF v_vcount <> 2 THEN RAISE EXCEPTION 'FAIL: expected 2 vehicles, got %', v_vcount; END IF;

  SELECT agent_id INTO v_agent FROM enquiries WHERE id = v_enq;
  IF v_agent IS NOT NULL THEN RAISE EXCEPTION 'FAIL: house link should snapshot agent_id NULL'; END IF;

  PERFORM 1 FROM enquiries
    WHERE id = v_enq
      AND customer_nric_normalized = '810315145701'
      AND customer_phone_normalized = '60123456789';
  IF NOT FOUND THEN RAISE EXCEPTION 'FAIL: NRIC/phone not normalized as expected'; END IF;

  -- Dedup: same branch + same normalized plate ("wxy1234" -> "WXY1234") + same expiry -> P0007.
  BEGIN
    PERFORM submit_enquiry(
      v_link, 'Dup Customer', 'S7654321B', '012-000 0000', NULL,
      jsonb_build_array(jsonb_build_object('car_plate','wxy1234','expiry_date','2026-12-31','insurance_product_id', v_prod))
    );
  EXCEPTION WHEN sqlstate 'P0007' THEN
    v_dup_ok := true;
  END;
  IF NOT v_dup_ok THEN RAISE EXCEPTION 'FAIL: per-branch dedup (P0007) not enforced'; END IF;

  RAISE NOTICE 'PHASE2 SMOKE PASS (enquiry=%, vehicles=%)', v_enq, v_vcount;
END $$;
ROLLBACK;
SQL
```
Expected: a single `NOTICE: PHASE2 SMOKE PASS (...)` line, then `ROLLBACK`. No `FAIL` and no unhandled error.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260628000001_submit_enquiry.sql
git commit -m "feat(partnership): submit_enquiry + get_branch_link_context anon RPCs"
```

---

## Task 2: Admin — branch link generation + QR in `MerchantDetail.tsx`

**Files:**
- Create: `apps/admin-portal/src/hooks/useBranchLinks.ts`
- Modify: `apps/admin-portal/src/pages/merchants/MerchantDetail.tsx`

**Interfaces:**
- Consumes: `BranchLink`, `MerchantBranch` types; `supabase`; the existing `useMerchantBranches` hook (Task 7 of Phase 1).
- Produces: hooks `useBranchLinks(branchId)`, `useCreateBranchLink()`, `useDeactivateBranchLink(branchId)`; an inline `BranchLinksDialog` component + a per-branch "Links" action button in `MerchantDetail`.

- [ ] **Step 1: Create the branch-links hook**

Create `apps/admin-portal/src/hooks/useBranchLinks.ts`:

```typescript
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import type { BranchLink } from '@agent-system/shared-types';

export function useBranchLinks(branchId: string) {
  return useQuery({
    queryKey: ['branch_links', branchId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('branch_links')
        .select('*')
        .eq('merchant_branch_id', branchId)
        .order('created_at', { ascending: false });

      if (error) throw error;
      return data as BranchLink[];
    },
    enabled: !!branchId,
  });
}

// House link: agent_id NULL (no agent commission). link_code has no DB default,
// so generate a stable code client-side (crypto.randomUUID is available in the
// browser, mirroring the UUID link_code the agent_links flow uses).
export function useCreateBranchLink() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (branchId: string) => {
      const { data, error } = await supabase
        .from('branch_links')
        .insert({
          merchant_branch_id: branchId,
          agent_id: null,
          link_code: crypto.randomUUID(),
          is_active: true,
        })
        .select()
        .single();

      if (error) throw error;
      return data as BranchLink;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['branch_links', data.merchant_branch_id] });
    },
  });
}

// Deactivate (never delete) — enquiries FK-reference branch_links, so we keep the
// row and just flip is_active so the public link stops resolving.
export function useDeactivateBranchLink(branchId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from('branch_links')
        .update({ is_active: false })
        .eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['branch_links', branchId] });
    },
  });
}
```

- [ ] **Step 2: Replace `MerchantDetail.tsx` with the link-enabled version**

Overwrite `apps/admin-portal/src/pages/merchants/MerchantDetail.tsx` with the following (adds the `useToast`/`QRCodeSVG`/link-icon imports, a `linksBranch` state, a per-branch **Links** action button, and the `BranchLinksDialog` sub-component; the existing Branches CRUD + approval is preserved verbatim):

```tsx
import { useState } from 'react';
import { Link, useParams } from '@tanstack/react-router';
import {
  Button,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  Input,
  Label,
  Badge,
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  TableSkeleton,
  useToast,
} from '@agent-system/shared-ui';
import { Plus, Pencil, Trash2, Check, ArrowLeft, QrCode, Copy, Link2, Power } from 'lucide-react';
import { QRCodeSVG } from 'qrcode.react';
import { useMerchant } from '../../hooks/useMerchants';
import {
  useMerchantBranches,
  useCreateMerchantBranch,
  useUpdateMerchantBranch,
  useDeleteMerchantBranch,
  useApproveMerchantBranch,
} from '../../hooks/useMerchantBranches';
import {
  useBranchLinks,
  useCreateBranchLink,
  useDeactivateBranchLink,
} from '../../hooks/useBranchLinks';
import { MerchantStatus, type MerchantBranch } from '@agent-system/shared-types';

const publicBaseUrl = () => import.meta.env.VITE_PUBLIC_PAGES_URL || window.location.origin;
const enquiryUrl = (code: string) => `${publicBaseUrl()}/public/enquiry/${code}`;

function BranchLinksDialog({
  branch,
  open,
  onOpenChange,
}: {
  branch: MerchantBranch;
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const { toast } = useToast();
  const { data: links, isLoading } = useBranchLinks(branch.id);
  const createLink = useCreateBranchLink();
  const deactivateLink = useDeactivateBranchLink(branch.id);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const handleGenerate = async () => {
    try {
      await createLink.mutateAsync(branch.id);
      toast({ title: 'House link created', description: 'Share the QR or URL with the branch.' });
    } catch (err: any) {
      toast({ title: 'Failed to create link', description: err.message, variant: 'error' });
    }
  };

  const handleCopy = async (code: string, id: string) => {
    await navigator.clipboard.writeText(enquiryUrl(code));
    setCopiedId(id);
    toast({ title: 'Link copied!', description: 'Customer enquiry link copied to clipboard.' });
    setTimeout(() => setCopiedId(null), 2000);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Branch Links — {branch.name}</DialogTitle>
          <DialogDescription>
            House links (no agent) for the customer enquiry form. Print the QR on branch signage.
          </DialogDescription>
        </DialogHeader>

        <div className="flex justify-end">
          <Button onClick={handleGenerate} disabled={createLink.isPending}>
            <Link2 className="size-4 mr-1.5" />
            {createLink.isPending ? 'Generating...' : 'Generate house link'}
          </Button>
        </div>

        <div className="space-y-3 max-h-[60vh] overflow-auto">
          {isLoading ? (
            <p className="text-sm text-muted-foreground">Loading links...</p>
          ) : (links?.length ?? 0) === 0 ? (
            <p className="text-sm text-muted-foreground">No links yet. Generate the first house link.</p>
          ) : (
            links?.map((link) => (
              <div key={link.id} className="flex items-center gap-3 rounded-md border p-3">
                <div className="shrink-0 rounded bg-white p-1">
                  <QRCodeSVG value={enquiryUrl(link.link_code)} size={88} />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <Badge variant={link.is_active ? 'default' : 'secondary'}>
                      {link.is_active ? 'active' : 'inactive'}
                    </Badge>
                  </div>
                  <p className="mt-1 truncate text-xs text-muted-foreground" title={enquiryUrl(link.link_code)}>
                    {enquiryUrl(link.link_code)}
                  </p>
                  <div className="mt-2 flex items-center gap-2">
                    <Button variant="outline" size="sm" onClick={() => handleCopy(link.link_code, link.id)}>
                      {copiedId === link.id ? (
                        <>
                          <Check className="size-4 mr-1 text-emerald-600" /> Copied!
                        </>
                      ) : (
                        <>
                          <Copy className="size-4 mr-1" /> Copy URL
                        </>
                      )}
                    </Button>
                    {link.is_active && (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => deactivateLink.mutate(link.id)}
                        disabled={deactivateLink.isPending}
                      >
                        <Power className="size-4 mr-1 text-destructive" /> Deactivate
                      </Button>
                    )}
                  </div>
                </div>
              </div>
            ))
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Close</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function MerchantDetail() {
  const { merchantId } = useParams({ strict: false }) as { merchantId: string };
  const { data: merchant } = useMerchant(merchantId);
  const { data: branches, isLoading, error } = useMerchantBranches(merchantId);
  const createBranch = useCreateMerchantBranch();
  const updateBranch = useUpdateMerchantBranch();
  const deleteBranch = useDeleteMerchantBranch(merchantId);
  const approveBranch = useApproveMerchantBranch(merchantId);

  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editing, setEditing] = useState<MerchantBranch | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [linksBranch, setLinksBranch] = useState<MerchantBranch | null>(null);
  const [formData, setFormData] = useState({ name: '', address: '', phone: '' });

  const handleOpenDialog = (branch?: MerchantBranch) => {
    if (branch) {
      setEditing(branch);
      setFormData({ name: branch.name, address: branch.address ?? '', phone: branch.phone ?? '' });
    } else {
      setEditing(null);
      setFormData({ name: '', address: '', phone: '' });
    }
    setIsDialogOpen(true);
  };

  const handleSave = async () => {
    const payload = {
      name: formData.name,
      address: formData.address.trim() === '' ? null : formData.address.trim(),
      phone: formData.phone.trim() === '' ? null : formData.phone.trim(),
    };
    try {
      if (editing) {
        await updateBranch.mutateAsync({ id: editing.id, ...payload });
      } else {
        await createBranch.mutateAsync({ merchant_id: merchantId, ...payload });
      }
      setIsDialogOpen(false);
    } catch (err) {
      console.error('Failed to save branch:', err);
    }
  };

  const confirmDelete = () => {
    if (deleteId) {
      deleteBranch.mutate(deleteId);
      setDeleteId(null);
    }
  };

  if (error) {
    return (
      <Card>
        <CardContent className="py-4">
          <p className="text-destructive">Error loading branches: {error.message}</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="flex flex-col gap-4 animate-fade-in">
      <div>
        <Link to="/merchants" className="inline-flex items-center text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft className="size-4 mr-1" />
          Back to Partnerships
        </Link>
      </div>

      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">{merchant?.name ?? 'Merchant'}</h1>
          <p className="text-sm text-muted-foreground">
            Pool RM{merchant?.gift_pool_amount?.toFixed(2) ?? '0.00'} ·{' '}
            {merchant?.merchant_share_pct ?? 0}% merchant / {100 - (merchant?.merchant_share_pct ?? 0)}% customer
          </p>
        </div>
        <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
          <DialogTrigger asChild>
            <Button onClick={() => handleOpenDialog()}>
              <Plus className="size-4 mr-1.5" />
              New Branch
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{editing ? 'Edit Branch' : 'Create Branch'}</DialogTitle>
              <DialogDescription>An outlet where customers can be referred.</DialogDescription>
            </DialogHeader>
            <div className="space-y-4">
              <div>
                <Label>Branch Name</Label>
                <Input
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  placeholder="Poh Kong — Sunway Pyramid"
                />
              </div>
              <div>
                <Label>Address (optional)</Label>
                <Input
                  value={formData.address}
                  onChange={(e) => setFormData({ ...formData, address: e.target.value })}
                />
              </div>
              <div>
                <Label>Phone (optional)</Label>
                <Input
                  value={formData.phone}
                  onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                />
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setIsDialogOpen(false)}>Cancel</Button>
              <Button onClick={handleSave} disabled={createBranch.isPending || updateBranch.isPending}>
                {createBranch.isPending || updateBranch.isPending ? 'Saving...' : 'Save'}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Branches</CardTitle>
          <CardDescription>{branches?.length ?? 0} branches</CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <TableSkeleton rows={4} columns={4} />
          ) : branches?.length === 0 ? (
            <p className="text-sm text-muted-foreground">No branches yet. Add the first outlet.</p>
          ) : (
            <div className="overflow-auto rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow className="hover:bg-transparent">
                    <TableHead>Name</TableHead>
                    <TableHead>Phone</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {branches?.map((branch) => (
                    <TableRow key={branch.id}>
                      <TableCell className="font-medium">{branch.name}</TableCell>
                      <TableCell className="text-muted-foreground">{branch.phone ?? '—'}</TableCell>
                      <TableCell className="capitalize text-muted-foreground">{branch.status}</TableCell>
                      <TableCell className="text-right">
                        <div className="flex items-center justify-end gap-2">
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => setLinksBranch(branch)}
                            aria-label="Manage branch links"
                          >
                            <QrCode className="size-4" />
                          </Button>
                          {branch.status === MerchantStatus.PENDING && (
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => approveBranch.mutate(branch.id)}
                              disabled={approveBranch.isPending}
                              aria-label="Approve branch"
                            >
                              <Check className="size-4 text-emerald-600" />
                            </Button>
                          )}
                          <Button variant="ghost" size="sm" onClick={() => handleOpenDialog(branch)} aria-label="Edit branch">
                            <Pencil className="size-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => setDeleteId(branch.id)}
                            disabled={deleteBranch.isPending}
                            aria-label="Delete branch"
                          >
                            <Trash2 className="size-4 text-destructive" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {linksBranch && (
        <BranchLinksDialog
          branch={linksBranch}
          open={!!linksBranch}
          onOpenChange={(o) => !o && setLinksBranch(null)}
        />
      )}

      <AlertDialog open={!!deleteId} onOpenChange={(open) => !open && setDeleteId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Branch</AlertDialogTitle>
            <AlertDialogDescription>
              Deleting a branch also deletes its links. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={confirmDelete} className="bg-red-600 hover:bg-red-700">Delete</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
```

- [ ] **Step 3: Verify build**

Run: `pnpm --filter admin-portal build`
Expected: build succeeds, no `tsc` errors. (If `Badge` is not exported from `@agent-system/shared-ui`, the build fails on the import — `Badge` is exported and already used by `MyLinks.tsx`/agent-portal, so this should pass; if it ever does not, drop the `Badge` import and render the status as plain `<span className="capitalize text-muted-foreground">`.)

- [ ] **Step 4: Manual UI check (user runs the dev server)**

Run `pnpm dev:admin`, log in as `admin@test.com`, open a Partnership → a branch → click the QR (Links) action. Expected: dialog opens; "Generate house link" creates a row showing a QR + a `/public/enquiry/<uuid>` URL; "Copy URL" copies it; "Deactivate" flips it to inactive.

- [ ] **Step 5: Commit**

```bash
git add apps/admin-portal/src/hooks/useBranchLinks.ts apps/admin-portal/src/pages/merchants/MerchantDetail.tsx
git commit -m "feat(partnership): admin per-branch link generation with QR"
```

---

## Task 3: Public — `/public/enquiry/$linkCode` page

**Files:**
- Create: `apps/public-pages/src/pages/Enquiry.tsx`
- Modify: `apps/public-pages/src/router.tsx`

**Interfaces:**
- Consumes: RPCs `get_branch_link_context` + `submit_enquiry` (Task 1); anon SELECT on active `insurance_products` (Phase 1); `supabase` from `../lib/supabase`; `toMalaysianE164` from `../lib/phone`.
- Produces: route `/public/enquiry/$linkCode` → `Enquiry` component (resolve → multi-vehicle form → submit → thank-you).

- [ ] **Step 1: Create the page**

Create `apps/public-pages/src/pages/Enquiry.tsx` (mirrors `Register.tsx`'s loading/error/success shell; the body is a `react-hook-form` + `zod` form with a `useFieldArray` vehicle list and the product `<Select>`):

```tsx
import { useState, useEffect } from 'react';
import { useParams } from '@tanstack/react-router';
import { useForm, useFieldArray } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Input,
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Skeleton,
  Logo,
} from '@agent-system/shared-ui';
import { Car, Plus, Trash2, CheckCircle } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { toMalaysianE164 } from '../lib/phone';

const enquirySchema = z.object({
  customer_name: z.string().min(2, 'Name must be at least 2 characters'),
  customer_nric: z.string().min(6, 'NRIC / MyKad is required'),
  customer_phone: z.string().min(8, 'Phone number must be at least 8 characters'),
  customer_email: z
    .string()
    .email('Invalid email address')
    .optional()
    .or(z.literal('')),
  vehicles: z
    .array(
      z.object({
        car_plate: z.string().min(1, 'Car plate is required'),
        insurance_expiry_date: z.string().min(1, 'Expiry date is required'),
        insurance_product_id: z.string().min(1, 'Select a product'),
      }),
    )
    .min(1, 'Add at least one vehicle'),
});

type EnquiryFormData = z.infer<typeof enquirySchema>;

interface BranchContext {
  merchant_name: string;
  merchant_logo_url: string | null;
  branch_name: string;
}

interface ProductOption {
  id: string;
  name: string;
}

export function Enquiry() {
  const { linkCode } = useParams({ strict: false });
  const [context, setContext] = useState<BranchContext | null>(null);
  const [products, setProducts] = useState<ProductOption[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isSuccess, setIsSuccess] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const form = useForm<EnquiryFormData>({
    resolver: zodResolver(enquirySchema),
    mode: 'onChange',
    defaultValues: {
      customer_name: '',
      customer_nric: '',
      customer_phone: '',
      customer_email: '',
      vehicles: [{ car_plate: '', insurance_expiry_date: '', insurance_product_id: '' }],
    },
  });

  const { fields, append, remove } = useFieldArray({ control: form.control, name: 'vehicles' });

  useEffect(() => {
    if (linkCode) {
      resolveLink(linkCode);
    }
  }, [linkCode]);

  const resolveLink = async (code: string) => {
    setIsLoading(true);
    setError(null);

    const [{ data: ctx, error: ctxError }, { data: prods, error: prodError }] = await Promise.all([
      supabase.rpc('get_branch_link_context', { p_link_code: code }),
      supabase
        .from('insurance_products')
        .select('id, name')
        .eq('is_active', true)
        .order('sort_order', { ascending: true }),
    ]);

    if (ctxError || !ctx || ctx.length === 0) {
      setError('Invalid or inactive enquiry link');
      setIsLoading(false);
      return;
    }

    setContext(ctx[0] as BranchContext);
    if (!prodError && prods) {
      setProducts(prods as ProductOption[]);
    }
    setIsLoading(false);
  };

  const onSubmit = async (formData: EnquiryFormData) => {
    setIsSubmitting(true);
    setError(null);

    const { error: rpcError } = await supabase.rpc('submit_enquiry', {
      p_link_code: linkCode,
      p_customer_name: formData.customer_name,
      p_customer_nric: formData.customer_nric,
      p_customer_phone: toMalaysianE164(formData.customer_phone),
      p_customer_email: formData.customer_email?.trim() || null,
      p_vehicles: formData.vehicles.map((v) => ({
        car_plate: v.car_plate,
        expiry_date: v.insurance_expiry_date,
        insurance_product_id: v.insurance_product_id,
      })),
    });

    if (rpcError) {
      if (rpcError.code === 'P0001') {
        setError('This enquiry link is no longer active.');
      } else if (rpcError.code === 'P0006') {
        setError('Please add at least one vehicle.');
      } else if (rpcError.code === 'P0007') {
        setError('One of these vehicles has already been submitted at this branch.');
      } else {
        setError('Failed to submit your enquiry. Please try again.');
      }
      setIsSubmitting(false);
      return;
    }

    setIsSuccess(true);
    setIsSubmitting(false);
  };

  if (isLoading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-indigo-950 via-slate-900 to-indigo-900 flex items-center justify-center p-4">
        <Card className="w-full max-w-lg bg-card backdrop-blur-sm shadow-2xl border-0">
          <CardHeader className="text-center pt-8">
            <Skeleton className="h-12 w-12 rounded-full mx-auto mb-4" />
            <Skeleton className="h-8 w-48 mx-auto mb-2" />
            <Skeleton className="h-4 w-64 mx-auto" />
          </CardHeader>
          <CardContent className="p-6 space-y-4">
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-20 w-full rounded-lg" />
          </CardContent>
        </Card>
      </div>
    );
  }

  if (error && !context) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-indigo-950 via-slate-900 to-indigo-900 flex items-center justify-center p-4">
        <Card className="w-full max-w-md bg-card backdrop-blur-sm shadow-2xl border-0 animate-slide-up">
          <CardContent className="p-6 text-center">
            <div className="size-16 rounded-full bg-red-100 flex items-center justify-center mx-auto mb-4">
              <span className="text-2xl">!</span>
            </div>
            <p className="text-red-600 font-medium">{error}</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (isSuccess) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-indigo-950 via-slate-900 to-indigo-900 flex items-center justify-center p-4">
        <Card className="w-full max-w-md bg-card backdrop-blur-sm shadow-2xl border-0 animate-slide-up">
          <CardContent className="p-6 text-center space-y-4">
            <div className="size-20 rounded-full bg-emerald-100 flex items-center justify-center mx-auto">
              <CheckCircle className="size-10 text-emerald-600" />
            </div>
            <div>
              <h2 className="text-xl font-semibold text-foreground">Enquiry Received!</h2>
              <p className="text-muted-foreground">
                Thank you. Our team will prepare your car-insurance quotation and be in touch soon.
              </p>
            </div>
            <div className="bg-muted p-4 rounded-xl text-left border">
              <p className="font-semibold text-foreground">{context?.merchant_name}</p>
              <p className="text-sm text-muted-foreground">{context?.branch_name}</p>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-indigo-950 via-slate-900 to-indigo-900 flex items-center justify-center p-4">
      <Card className="w-full max-w-lg bg-card backdrop-blur-sm shadow-2xl border-0 animate-slide-up">
        <CardHeader className="text-center pt-8">
          {context?.merchant_logo_url ? (
            <img
              src={context.merchant_logo_url}
              alt={context.merchant_name}
              className="mx-auto mb-4 h-12 w-auto object-contain"
            />
          ) : (
            <Logo size="lg" showText={false} className="mx-auto mb-4" />
          )}
          <CardTitle className="text-xl font-semibold text-foreground">
            {context?.merchant_name} — Gold Gift Enquiry
          </CardTitle>
          <CardDescription className="text-muted-foreground">
            Renew your car insurance with us at {context?.branch_name} and receive a gold gift.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4 px-6 pb-8">
          {error && (
            <div role="alert" className="p-3 text-sm text-red-700 bg-red-50 border-red-200 rounded-lg">
              {error}
            </div>
          )}

          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
              <FormField
                control={form.control}
                name="customer_name"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-foreground">Full Name (as per IC)</FormLabel>
                    <FormControl>
                      <Input placeholder="John Doe" className="h-11" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="customer_nric"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-foreground">NRIC / MyKad Number</FormLabel>
                    <FormControl>
                      <Input placeholder="901020-10-1234" className="h-11" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="customer_phone"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-foreground">Phone Number</FormLabel>
                    <FormControl>
                      <div className="relative">
                        <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">
                          +60
                        </span>
                        <Input
                          type="tel"
                          inputMode="numeric"
                          placeholder="12-345 6789"
                          className="h-11 pl-12"
                          {...field}
                        />
                      </div>
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="customer_email"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-foreground">Email Address (optional)</FormLabel>
                    <FormControl>
                      <Input type="email" placeholder="you@example.com" className="h-11" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              {/* Vehicles */}
              <div className="border-t pt-4 mt-2 space-y-3">
                <div className="flex items-center justify-between">
                  <FormLabel className="text-foreground">Vehicles</FormLabel>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() =>
                      append({ car_plate: '', insurance_expiry_date: '', insurance_product_id: '' })
                    }
                  >
                    <Plus className="size-4 mr-1" /> Add vehicle
                  </Button>
                </div>

                {fields.map((vField, index) => (
                  <div key={vField.id} className="rounded-lg border bg-muted p-4 space-y-3">
                    <div className="flex items-center justify-between">
                      <span className="flex items-center gap-1.5 text-sm font-medium text-foreground">
                        <Car className="size-4" /> Vehicle {index + 1}
                      </span>
                      {fields.length > 1 && (
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          onClick={() => remove(index)}
                          aria-label="Remove vehicle"
                        >
                          <Trash2 className="size-4 text-destructive" />
                        </Button>
                      )}
                    </div>

                    <FormField
                      control={form.control}
                      name={`vehicles.${index}.car_plate`}
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel className="text-foreground">Car Plate</FormLabel>
                          <FormControl>
                            <Input placeholder="WXY 1234" className="h-11" {...field} />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />

                    <FormField
                      control={form.control}
                      name={`vehicles.${index}.insurance_expiry_date`}
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel className="text-foreground">Insurance Expiry Date</FormLabel>
                          <FormControl>
                            <Input type="date" className="h-11" {...field} />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />

                    <FormField
                      control={form.control}
                      name={`vehicles.${index}.insurance_product_id`}
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel className="text-foreground">Insurance Product</FormLabel>
                          <Select onValueChange={field.onChange} value={field.value}>
                            <FormControl>
                              <SelectTrigger className="h-11">
                                <SelectValue placeholder="Select a product" />
                              </SelectTrigger>
                            </FormControl>
                            <SelectContent>
                              {products.map((p) => (
                                <SelectItem key={p.id} value={p.id}>
                                  {p.name}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </div>
                ))}
              </div>

              <Button
                type="submit"
                className="w-full h-11 font-medium mt-2"
                disabled={isSubmitting || !form.formState.isValid}
              >
                {isSubmitting ? 'Submitting...' : 'Submit Enquiry'}
              </Button>
            </form>
          </Form>
        </CardContent>
      </Card>
    </div>
  );
}
```

- [ ] **Step 2: Register the route**

In `apps/public-pages/src/router.tsx`:
1. Add the import after the `Register` import:
```tsx
import { Enquiry } from './pages/Enquiry';
```
2. Add the route definition after `registerRoute`:
```tsx
const enquiryRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/public/enquiry/$linkCode',
  component: Enquiry,
});
```
3. Add `enquiryRoute,` to the `rootRoute.addChildren([...])` array (after `registerRoute,`).

- [ ] **Step 3: Verify build**

Run: `pnpm --filter public-pages build`
Expected: build succeeds, no `tsc` errors.

- [ ] **Step 4: Manual UI check (user runs the dev server)**

With `npx supabase start` running and `pnpm dev:public` up: in admin, generate a house link for an active branch, copy its `/public/enquiry/<code>` URL, open it (replace the host with `http://localhost:3002` if needed). Expected: the merchant/branch branding renders; the product `<Select>` lists the seeded products; "Add vehicle"/remove works; submitting shows the thank-you state; re-submitting the same plate + expiry shows the friendly duplicate error.

- [ ] **Step 5: Commit**

```bash
git add apps/public-pages/src/pages/Enquiry.tsx apps/public-pages/src/router.tsx
git commit -m "feat(partnership): public enquiry page with multi-vehicle form"
```

---

## Phase 2 done — verification summary

- `npx supabase migration up` applies `20260628000001_submit_enquiry.sql` cleanly; `get_branch_link_context` + `submit_enquiry` exist and are anon-EXECUTE; the rolled-back smoke test passes (header + 2 vehicles, NRIC→`810315145701` / phone→`60123456789`, house-link `agent_id` NULL snapshot, `P0007` dedup enforced).
- `pnpm --filter admin-portal build` and `pnpm --filter public-pages build` both pass.
- Admin can generate/list/deactivate per-branch house links (QR + copyable `/public/enquiry/<code>` URL).
- A customer can open `/public/enquiry/:linkCode`, see merchant/branch branding, submit a multi-vehicle enquiry, and reach a thank-you state — all without any broad anon SELECT on merchant/enquiry tables.

## Next phases (separate plans)

3. Admin pipeline — vehicle state machine, `confirm_vehicle_renewal` (mints gift + commission + settlement), status RPCs, payout/redemption UIs (migrations `20260628000010..`).
4. Reminders — `pg_cron` + `pg_net`, `enqueue_expiry_reminders`, `send-expiry-reminders` edge function (migrations `20260628000020..`).
5. Agent portal — propose merchant/branch, generate branch links (tied, `agent_id = get_agent_id()`), my enquiries & commissions.
