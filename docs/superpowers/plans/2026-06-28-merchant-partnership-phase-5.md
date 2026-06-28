# Merchant Partnership — Phase 5: Agent Portal Surfaces — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the agent-facing "Partnership" surfaces in `apps/agent-portal`: (1) a **Partnerships** page to browse approved merchants + branches, propose a new merchant and/or branch (which await admin approval), and generate + share a per-agent **branch QR** for any approved branch; (2) a **My Enquiries** page listing the enquiries that flowed through the agent's branch links; (3) a **My Commissions** page showing the agent's `merchant_commissions` ledger. **No database migration** — the schema and all RLS this phase relies on already exist from Phase 1 (migrations `20260627000001`–`20260627000003`).

**Architecture:** Four new TanStack Query hook modules wrap RLS-scoped Supabase reads/writes against the Phase-1 tables (`merchants`, `merchant_branches`, `branch_links`, `enquiries`, `enquiry_vehicles`, `merchant_commissions`, `insurance_products`). Three new pages copy existing agent-portal patterns — `MyLinks.tsx` (link generation/sharing) for **Partnerships**, and `Rewards.tsx` (ledger stat-cards + status table) for **My Commissions**. The branch QR uses `qrcode.react`'s `QRCodeSVG` exactly as `admin-portal/src/pages/PinCodes.tsx` does. Routes are registered in `apps/agent-portal/src/router.tsx`; nav entries are added to the `agentAdminNavigation` and `agentNavigation` arrays in `apps/agent-portal/src/components/Layout.tsx` (partner role excluded — partners have no `agents` row, so `get_agent_id()` is null for them).

**Tech Stack:** React 18 + Vite + TypeScript, TanStack Router (code-based routes), TanStack Query, shadcn/ui (`@agent-system/shared-ui`), `qrcode.react`, Supabase (Postgres 15 + RLS). Types in `packages/shared-types` (`merchant.ts` already exists from Phase 1).

## Global Constraints

- **No test framework** in this repo. **Never add vitest/jest/any test runner.** Verify the frontend with `pnpm --filter agent-portal build` (runs `tsc && vite build`). Run it after every task; a green build is the acceptance gate.
- **`noUnusedLocals` and `noUnusedParameters` are ON** in `apps/agent-portal/tsconfig.json`. Every imported symbol (component, icon, hook, type) and every local must be used **in the same commit**, or `tsc` fails the build. When you add an icon to the `lucide-react` import in `Layout.tsx`, add its nav line in the same task.
- **Phase 5 ships NO migration.** All tables, enums, helper functions, and RLS policies already exist from Phase 1. **Do NOT create a migration, and do NOT redefine** `is_admin()`, `get_agent_id()`, or `update_updated_at()`. If — against expectation — a migration ever becomes necessary, it must be `supabase/migrations/YYYYMMDDNNNNNN_name.sql`, strictly increasing after the latest existing prefix `20260627000003` (use `2026062800000N`+), applied locally with `npx supabase migration up` (NOT `db reset`) and asserted via `docker exec supabase_db_DATA psql -U postgres -d postgres -tAc "<SQL>"` (the host `psql` binary is NOT installed). None of that applies to the tasks below.
- **RLS this phase depends on (already created in Phase 1, `20260627000001_merchant_core.sql` + `20260627000002_merchant_enquiries.sql` + `20260627000003_merchant_ledgers.sql`):**
  - `merchants`: `"Agents read active or own merchants"` (SELECT `status='active' OR created_by_agent_id=get_agent_id()`); `"Agents propose merchants"` (INSERT `WITH CHECK created_by_agent_id=get_agent_id() AND status='pending'`).
  - `merchant_branches`: `"Agents read active or own branches"` (SELECT `status='active' OR created_by_agent_id=get_agent_id()`); `"Agents propose branches"` (INSERT `WITH CHECK created_by_agent_id=get_agent_id() AND status='pending'`).
  - `branch_links`: `"Agents manage own branch_links"` (ALL `USING agent_id=get_agent_id() WITH CHECK agent_id=get_agent_id()`).
  - `enquiries`: `"Agents read own enquiries"` (SELECT `agent_id=get_agent_id()`).
  - `enquiry_vehicles`: `"Agents read own enquiry_vehicles"` (SELECT `enquiry_id IN (SELECT id FROM enquiries WHERE agent_id=get_agent_id())`).
  - `merchant_commissions`: `"Agents read own commissions"` (SELECT `agent_id=get_agent_id()`).
  - `insurance_products`: `"Authenticated read active products"` (SELECT `is_active`).
- **`branch_links.link_code` has NO database default** (Phase-1 `merchant_core.sql` declares it `TEXT NOT NULL UNIQUE` with no default — unlike `agent_links.link_code`, which is auto-generated). The agent client therefore **must supply** `link_code` on insert. Generate it with `crypto.randomUUID()` (available in the browser secure context: Vite dev on `localhost` and prod over HTTPS).
- **Agents propose without setting money fields.** When an agent proposes a merchant, insert only `{ name, status:'pending', created_by_agent_id }` — `gift_pool_amount` and `merchant_share_pct` default to `0` in the DB and are configured by the admin at approval. The agent UI must never expose the split.
- **Supabase client:** import `{ supabase }` from `../lib/supabase` (the single shared-ui client re-export). **Never** call `createClient` (duplicate `GoTrueClient`s broke agent-portal sessions before).
- **`qrcode.react` is NOT yet an agent-portal dependency** (it has `qrcode` — the canvas/data-URL lib — not the React component). Add `"qrcode.react": "^3.2.0"` (the exact version `apps/public-pages` already uses) by **hand-editing `apps/agent-portal/package.json`**, then `pnpm install`. **Do NOT run `pnpm add`** — it re-resolves the lockfile and re-trips the known dual-`zod` `tsc` failure (all packages must stay on `zod` 3.23.8).
- **Public enquiry URL:** `${import.meta.env.VITE_PUBLIC_PAGES_URL || window.location.origin}/public/enquiry/${link_code}` (matches Phase 2's `/public/enquiry/:linkCode` route and the `MyLinks.tsx` `VITE_PUBLIC_PAGES_URL` fallback convention).
- **Naming:** UI labels this area **"Partnerships"** / "Partnership"; the database says `merchant`. Do not relabel DB objects. (The existing `partners`/`Partners.tsx` recruiter concept is unrelated — do not touch it.)
- **Git:** work on branch `feat/merchant-partnership`; **one commit per task**; never commit to `main`. The working tree is shared by concurrent workflows and `HEAD` can thrash between turns — **before every commit run `git rev-parse --abbrev-ref HEAD` and, if it is not `feat/merchant-partnership`, `git checkout feat/merchant-partnership` first**, then stage only this task's files.

---

## File Structure

**Created:**
- `apps/agent-portal/src/hooks/useAgentMerchants.ts` — browse approved/own merchants (+ embedded branches); propose merchant; propose branch
- `apps/agent-portal/src/hooks/useAgentBranchLinks.ts` — list own `branch_links` (+ branch + merchant); create own `branch_link`
- `apps/agent-portal/src/hooks/useMyEnquiries.ts` — agent's enquiries (+ vehicles + branch/merchant + product)
- `apps/agent-portal/src/hooks/useMyCommissions.ts` — agent's `merchant_commissions` (+ vehicle/customer context)
- `apps/agent-portal/src/pages/Partnerships.tsx` — browse + propose + generate/share branch QR
- `apps/agent-portal/src/pages/MyEnquiries.tsx` — enquiry list with per-vehicle detail
- `apps/agent-portal/src/pages/MyCommissions.tsx` — commission ledger (stat cards + table)

**Modified:**
- `apps/agent-portal/package.json` — add `qrcode.react` dependency
- `apps/agent-portal/src/router.tsx` — add 3 routes (`/partnerships`, `/my-enquiries`, `/my-commissions`)
- `apps/agent-portal/src/components/Layout.tsx` — add 3 nav entries to `agentAdminNavigation` and `agentNavigation`

**Unchanged but consumed:** `apps/agent-portal/src/lib/supabase.ts`, `apps/agent-portal/src/hooks/useAuth.ts` (`agent.id`, `role`), `packages/shared-types/src/merchant.ts` (`Merchant`, `MerchantBranch`, `BranchLink`, `Enquiry`, `EnquiryVehicle`, `MerchantCommission`), `packages/shared-types/src/enums.ts` (`MerchantStatus`, `RewardStatus`).

---

## Task 1: Add `qrcode.react` dependency to agent-portal

**Files:**
- Modify: `apps/agent-portal/package.json`

**Interfaces:**
- Consumes: nothing.
- Produces: `qrcode.react@^3.2.0` available to import in `apps/agent-portal` (used by `Partnerships.tsx` in Task 5).

- [ ] **Step 1: Hand-edit `apps/agent-portal/package.json`**

In the `"dependencies"` block, add the `qrcode.react` line immediately after the existing `"qrcode": "^1.5.4",` line so the two QR entries sit together:

```json
    "qrcode": "^1.5.4",
    "qrcode.react": "^3.2.0",
```

Leave every other dependency (especially `"zod": "3.23.8"`) exactly as-is. **Do not run `pnpm add`.**

- [ ] **Step 2: Install from the edited manifest**

Run: `pnpm install`
Expected: resolves quickly, adds `qrcode.react` to the lockfile, and does **not** change any `zod` version. If `pnpm-lock.yaml` shows a `zod` diff, revert and stop — the install must touch only `qrcode.react`.

- [ ] **Step 3: Verify the build still passes**

Run: `pnpm --filter agent-portal build`
Expected: `tsc && vite build` succeeds (no new errors; the dep is unused until Task 5, which is fine — package.json deps are not subject to `noUnusedLocals`).

- [ ] **Step 4: Commit**

```bash
git rev-parse --abbrev-ref HEAD   # must be feat/merchant-partnership; if not: git checkout feat/merchant-partnership
git add apps/agent-portal/package.json pnpm-lock.yaml
git commit -m "chore(agent-portal): add qrcode.react for branch QR rendering"
```

---

## Task 2: Hook — browse + propose merchants/branches

**Files:**
- Create: `apps/agent-portal/src/hooks/useAgentMerchants.ts`

**Interfaces:**
- Consumes: `supabase` from `../lib/supabase`; types `Merchant`, `MerchantBranch` from `@agent-system/shared-types`; RLS `"Agents read active or own merchants"`, `"Agents read active or own branches"`, `"Agents propose merchants"`, `"Agents propose branches"`.
- Produces: type `MerchantWithBranches`; hooks `useAgentMerchants()`, `useProposeMerchant()`, `useProposeBranch()`. The query key is `['agent-merchants']`.

- [ ] **Step 1: Create the hook file**

Create `apps/agent-portal/src/hooks/useAgentMerchants.ts`:

```typescript
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { MerchantStatus, type Merchant, type MerchantBranch } from '@agent-system/shared-types';

export interface MerchantWithBranches extends Merchant {
  // RLS returns only active OR agent-owned branches, so this array already
  // excludes other agents' pending proposals.
  branches: MerchantBranch[];
}

// Every merchant row the agent is allowed to see (active ones for browsing +
// the agent's own pending proposals), each with its visible branches embedded.
export function useAgentMerchants() {
  return useQuery({
    queryKey: ['agent-merchants'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('merchants')
        .select('*, branches:merchant_branches(*)')
        .order('name', { ascending: true });

      if (error) throw error;
      return data as MerchantWithBranches[];
    },
  });
}

// Agent proposes a new merchant. RLS requires status='pending' and
// created_by_agent_id=get_agent_id(); the money split is admin-set on approval.
export function useProposeMerchant() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ name, agentId }: { name: string; agentId: string }) => {
      const { data, error } = await supabase
        .from('merchants')
        .insert({
          name,
          status: MerchantStatus.PENDING,
          created_by_agent_id: agentId,
        })
        .select()
        .single();

      if (error) throw error;
      return data as Merchant;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['agent-merchants'] });
    },
  });
}

// Agent proposes a branch under a merchant (the merchant may be active or the
// agent's own pending one). RLS requires status='pending' + own created_by.
export function useProposeBranch() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      merchantId,
      name,
      address,
      phone,
      agentId,
    }: {
      merchantId: string;
      name: string;
      address: string;
      phone: string;
      agentId: string;
    }) => {
      const { data, error } = await supabase
        .from('merchant_branches')
        .insert({
          merchant_id: merchantId,
          name,
          address: address.trim() === '' ? null : address.trim(),
          phone: phone.trim() === '' ? null : phone.trim(),
          status: MerchantStatus.PENDING,
          created_by_agent_id: agentId,
        })
        .select()
        .single();

      if (error) throw error;
      return data as MerchantBranch;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['agent-merchants'] });
    },
  });
}
```

- [ ] **Step 2: Verify build**

Run: `pnpm --filter agent-portal build`
Expected: succeeds. (`tsc` type-checks the new file even though no page imports it yet; its own imports — `supabase`, `MerchantStatus`, `Merchant`, `MerchantBranch` — are all used.)

- [ ] **Step 3: Commit**

```bash
git rev-parse --abbrev-ref HEAD   # guard: feat/merchant-partnership
git add apps/agent-portal/src/hooks/useAgentMerchants.ts
git commit -m "feat(partnership): agent hook to browse and propose merchants/branches"
```

---

## Task 3: Hook — own branch links (list + create)

**Files:**
- Create: `apps/agent-portal/src/hooks/useAgentBranchLinks.ts`

**Interfaces:**
- Consumes: `supabase`; types `BranchLink`, `MerchantBranch`, `Merchant`; RLS `"Agents manage own branch_links"`, `"Agents read active or own branches"`, `"Agents read active or own merchants"`.
- Produces: type `BranchLinkWithBranch`; hooks `useMyBranchLinks(agentId)`, `useCreateBranchLink()`. Query key `['my-branch-links', agentId]`. Mirrors `useAgentLinks.ts` (`useMyLinks` + `useCreateLink` upsert pattern).

- [ ] **Step 1: Create the hook file**

Create `apps/agent-portal/src/hooks/useAgentBranchLinks.ts`:

```typescript
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import type { BranchLink, MerchantBranch, Merchant } from '@agent-system/shared-types';

export interface BranchLinkWithBranch extends BranchLink {
  branch: MerchantBranch & { merchant: Merchant | null };
}

export function useMyBranchLinks(agentId: string | undefined) {
  return useQuery({
    queryKey: ['my-branch-links', agentId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('branch_links')
        .select('*, branch:merchant_branches(*, merchant:merchants(*))')
        .eq('agent_id', agentId!)
        .eq('is_active', true)
        .order('created_at', { ascending: false });

      if (error) throw error;
      // Drop any link whose branch the client can't read (e.g. branch later
      // deactivated → branch=null) so the non-null `branch` type holds.
      return ((data ?? []) as BranchLinkWithBranch[]).filter((l) => l.branch != null);
    },
    enabled: !!agentId,
  });
}

export function useCreateBranchLink() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      agentId,
      merchantBranchId,
    }: {
      agentId: string;
      merchantBranchId: string;
    }) => {
      // Upsert: reuse the agent's existing active link for this branch if any
      // (one shareable QR per agent+branch), mirroring useCreateLink.
      const { data: existing, error: findError } = await supabase
        .from('branch_links')
        .select('*')
        .eq('agent_id', agentId)
        .eq('merchant_branch_id', merchantBranchId)
        .eq('is_active', true)
        .maybeSingle();

      if (findError) throw findError;
      if (existing) return existing as BranchLink;

      // link_code has no DB default — generate it client-side (see Global Constraints).
      const { data, error } = await supabase
        .from('branch_links')
        .insert({
          agent_id: agentId,
          merchant_branch_id: merchantBranchId,
          link_code: crypto.randomUUID(),
          is_active: true,
        })
        .select()
        .single();

      if (error) throw error;
      return data as BranchLink;
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ['my-branch-links', variables.agentId] });
    },
  });
}
```

- [ ] **Step 2: Verify build**

Run: `pnpm --filter agent-portal build`
Expected: succeeds.

- [ ] **Step 3: Commit**

```bash
git rev-parse --abbrev-ref HEAD   # guard
git add apps/agent-portal/src/hooks/useAgentBranchLinks.ts
git commit -m "feat(partnership): agent hook to list and create own branch links"
```

---

## Task 4: Hooks — my enquiries + my commissions

**Files:**
- Create: `apps/agent-portal/src/hooks/useMyEnquiries.ts`
- Create: `apps/agent-portal/src/hooks/useMyCommissions.ts`

**Interfaces:**
- Consumes: `supabase`; types `Enquiry`, `EnquiryVehicle`, `MerchantCommission`; RLS `"Agents read own enquiries"`, `"Agents read own enquiry_vehicles"`, `"Agents read own commissions"`, `"Agents read active or own branches/merchants"`, `"Authenticated read active products"`.
- Produces: type `EnquiryWithDetails` + hook `useMyEnquiries(agentId)` (key `['my-enquiries', agentId]`); type `MerchantCommissionWithVehicle` + hook `useMyCommissions(agentId)` (key `['my-commissions', agentId]`).

- [ ] **Step 1: Create `useMyEnquiries.ts`**

Create `apps/agent-portal/src/hooks/useMyEnquiries.ts`:

```typescript
import { useQuery } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import type { Enquiry, EnquiryVehicle } from '@agent-system/shared-types';

export interface EnquiryVehicleWithProduct extends EnquiryVehicle {
  product: { name: string } | null;
}

export interface EnquiryWithDetails extends Enquiry {
  branch: { name: string; merchant: { name: string } | null } | null;
  vehicles: EnquiryVehicleWithProduct[];
}

// Enquiries that flowed through the agent's branch links (agent_id snapshot =
// get_agent_id()), with each car and its product, for follow-up.
export function useMyEnquiries(agentId: string | undefined) {
  return useQuery({
    queryKey: ['my-enquiries', agentId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('enquiries')
        .select(`
          *,
          branch:merchant_branches(name, merchant:merchants(name)),
          vehicles:enquiry_vehicles(*, product:insurance_products(name))
        `)
        .eq('agent_id', agentId!)
        .order('created_at', { ascending: false });

      if (error) throw error;
      return (data ?? []) as EnquiryWithDetails[];
    },
    enabled: !!agentId,
  });
}
```

- [ ] **Step 2: Create `useMyCommissions.ts`**

Create `apps/agent-portal/src/hooks/useMyCommissions.ts`:

```typescript
import { useQuery } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import type { MerchantCommission } from '@agent-system/shared-types';

export interface MerchantCommissionWithVehicle extends MerchantCommission {
  vehicle: {
    car_plate: string;
    insurance_expiry_date: string;
    enquiry: { customer_name: string } | null;
  } | null;
}

// The agent's commission ledger (one row per renewed vehicle on a tied link),
// with the car + customer for context. Mirrors how Rewards.tsx reads rewards.
export function useMyCommissions(agentId: string | undefined) {
  return useQuery({
    queryKey: ['my-commissions', agentId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('merchant_commissions')
        .select(`
          *,
          vehicle:enquiry_vehicles(
            car_plate,
            insurance_expiry_date,
            enquiry:enquiries(customer_name)
          )
        `)
        .eq('agent_id', agentId!)
        .order('created_at', { ascending: false });

      if (error) throw error;
      return (data ?? []) as MerchantCommissionWithVehicle[];
    },
    enabled: !!agentId,
  });
}
```

- [ ] **Step 3: Verify build**

Run: `pnpm --filter agent-portal build`
Expected: succeeds.

- [ ] **Step 4: Commit**

```bash
git rev-parse --abbrev-ref HEAD   # guard
git add apps/agent-portal/src/hooks/useMyEnquiries.ts apps/agent-portal/src/hooks/useMyCommissions.ts
git commit -m "feat(partnership): agent hooks for my enquiries and my commissions"
```

---

## Task 5: Page — Partnerships (browse, propose, generate/share branch QR)

**Files:**
- Create: `apps/agent-portal/src/pages/Partnerships.tsx`
- Modify: `apps/agent-portal/src/router.tsx`
- Modify: `apps/agent-portal/src/components/Layout.tsx`

**Interfaces:**
- Consumes: `useAuth` (`agent.id`, `role`); `useAgentMerchants`, `useProposeMerchant`, `useProposeBranch`, `MerchantWithBranches` (Task 2); `useMyBranchLinks`, `useCreateBranchLink` (Task 3); `QRCodeSVG` from `qrcode.react` (Task 1); `MerchantStatus`, `MerchantBranch` types.
- Produces: component `Partnerships`; route `/partnerships`; nav entry "Partnerships" (icon `Store`) in both agent nav arrays.

- [ ] **Step 1: Create the page**

Create `apps/agent-portal/src/pages/Partnerships.tsx`:

```tsx
import { useState } from 'react';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Button,
  Badge,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  Label,
  Skeleton,
  useToast,
} from '@agent-system/shared-ui';
import { QRCodeSVG } from 'qrcode.react';
import { Store, QrCode, Copy, Check, Plus, MapPin } from 'lucide-react';
import { useAuth } from '../hooks/useAuth';
import {
  useAgentMerchants,
  useProposeMerchant,
  useProposeBranch,
} from '../hooks/useAgentMerchants';
import { useMyBranchLinks, useCreateBranchLink } from '../hooks/useAgentBranchLinks';
import { MerchantStatus, type MerchantBranch } from '@agent-system/shared-types';

const enquiryUrl = (code: string) =>
  `${import.meta.env.VITE_PUBLIC_PAGES_URL || window.location.origin}/public/enquiry/${code}`;

export function Partnerships() {
  const { agent, role } = useAuth();
  const { toast } = useToast();

  const { data: merchants, isLoading } = useAgentMerchants();
  const { data: myLinks } = useMyBranchLinks(agent?.id);
  const proposeMerchant = useProposeMerchant();
  const proposeBranch = useProposeBranch();
  const createBranchLink = useCreateBranchLink();

  const [selectedMerchantId, setSelectedMerchantId] = useState<string | null>(null);
  const [isMerchantOpen, setIsMerchantOpen] = useState(false);
  const [isBranchOpen, setIsBranchOpen] = useState(false);
  const [merchantName, setMerchantName] = useState('');
  const [branchForm, setBranchForm] = useState({ name: '', address: '', phone: '' });
  const [qr, setQr] = useState<{ code: string; label: string } | null>(null);
  const [copied, setCopied] = useState(false);
  const [busyBranchId, setBusyBranchId] = useState<string | null>(null);

  // Partner-role users have no agents row (get_agent_id() is null), so this
  // surface does not apply to them.
  if (role === 'partner') {
    return (
      <div className="p-6 text-center text-muted-foreground">
        <p>This page is only available to agents.</p>
      </div>
    );
  }

  const activeMerchants = merchants?.filter((m) => m.status === MerchantStatus.ACTIVE) ?? [];
  const myPending =
    merchants?.filter(
      (m) => m.status === MerchantStatus.PENDING && m.created_by_agent_id === agent?.id,
    ) ?? [];
  const selectedMerchant = merchants?.find((m) => m.id === selectedMerchantId) ?? null;

  const handleProposeMerchant = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!agent?.id) return;
    try {
      await proposeMerchant.mutateAsync({ name: merchantName, agentId: agent.id });
      toast({ title: 'Merchant proposed', description: 'An admin will review and approve it.' });
      setIsMerchantOpen(false);
      setMerchantName('');
    } catch (err: any) {
      toast({ title: 'Failed to propose merchant', description: err.message, variant: 'error' });
    }
  };

  const handleProposeBranch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!agent?.id || !selectedMerchantId) return;
    try {
      await proposeBranch.mutateAsync({
        merchantId: selectedMerchantId,
        name: branchForm.name,
        address: branchForm.address,
        phone: branchForm.phone,
        agentId: agent.id,
      });
      toast({ title: 'Branch proposed', description: 'An admin will review and approve it.' });
      setIsBranchOpen(false);
      setBranchForm({ name: '', address: '', phone: '' });
    } catch (err: any) {
      toast({ title: 'Failed to propose branch', description: err.message, variant: 'error' });
    }
  };

  const handleGenerateQr = async (branch: MerchantBranch, merchantName: string) => {
    if (!agent?.id) return;
    setBusyBranchId(branch.id);
    try {
      const link = await createBranchLink.mutateAsync({
        agentId: agent.id,
        merchantBranchId: branch.id,
      });
      setQr({ code: link.link_code, label: `${merchantName} — ${branch.name}` });
    } catch (err: any) {
      toast({ title: 'Failed to generate QR', description: err.message, variant: 'error' });
    } finally {
      setBusyBranchId(null);
    }
  };

  const handleCopy = async (code: string) => {
    await navigator.clipboard.writeText(enquiryUrl(code));
    setCopied(true);
    toast({ title: 'Link copied!', description: 'Share this enquiry link with customers.' });
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="flex flex-col gap-4 animate-fade-in">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">Partnerships</h1>
          <p className="text-sm text-muted-foreground">
            Browse gift-partner merchants, propose new ones, and share your branch QR
          </p>
        </div>
        <Button onClick={() => setIsMerchantOpen(true)}>
          <Plus className="size-4 mr-1.5" />
          Propose Merchant
        </Button>
      </div>

      {/* Approved merchants to browse */}
      <div>
        <h2 className="text-lg font-semibold text-foreground mb-3">Approved Merchants</h2>
        {isLoading ? (
          <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
            {[1, 2, 3].map((i) => (
              <Card key={i}>
                <CardHeader>
                  <Skeleton className="h-6 w-3/4" />
                  <Skeleton className="h-4 w-1/2 mt-2" />
                </CardHeader>
              </Card>
            ))}
          </div>
        ) : activeMerchants.length === 0 ? (
          <Card>
            <CardContent className="py-4">
              <p className="text-muted-foreground text-center">
                No approved merchants yet. Propose one above.
              </p>
            </CardContent>
          </Card>
        ) : (
          <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
            {activeMerchants.map((merchant) => (
              <Card
                key={merchant.id}
                className={`cursor-pointer transition-colors duration-150 ${
                  selectedMerchantId === merchant.id
                    ? 'ring-2 ring-primary shadow-sm'
                    : 'hover:bg-muted/50'
                }`}
                onClick={() => setSelectedMerchantId(merchant.id)}
              >
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-medium flex items-center gap-2">
                    <Store className="size-4 text-muted-foreground" />
                    {merchant.name}
                  </CardTitle>
                  <CardDescription>
                    {merchant.branches.filter((b) => b.status === MerchantStatus.ACTIVE).length} approved
                    branch(es)
                  </CardDescription>
                </CardHeader>
              </Card>
            ))}
          </div>
        )}
      </div>

      {/* Branches of the selected merchant */}
      {selectedMerchant && (
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <div>
              <CardTitle>{selectedMerchant.name} — Branches</CardTitle>
              <CardDescription>Generate and share your QR for an approved branch</CardDescription>
            </div>
            <Button variant="outline" size="sm" onClick={() => setIsBranchOpen(true)}>
              <Plus className="size-4 mr-1.5" />
              Propose Branch
            </Button>
          </CardHeader>
          <CardContent>
            {selectedMerchant.branches.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No branches yet. Propose one for admin approval.
              </p>
            ) : (
              <div className="space-y-3">
                {selectedMerchant.branches.map((branch) => (
                  <div
                    key={branch.id}
                    className="flex items-center justify-between p-4 rounded-lg border hover:bg-muted/50"
                  >
                    <div>
                      <div className="font-medium text-foreground flex items-center gap-2">
                        {branch.name}
                        {branch.status !== MerchantStatus.ACTIVE && (
                          <Badge variant="warning" className="text-xs">
                            Pending approval
                          </Badge>
                        )}
                      </div>
                      {branch.address && (
                        <div className="text-sm text-muted-foreground flex items-center gap-1">
                          <MapPin className="size-3" />
                          {branch.address}
                        </div>
                      )}
                    </div>
                    <Button
                      size="sm"
                      disabled={branch.status !== MerchantStatus.ACTIVE || busyBranchId === branch.id}
                      onClick={() => handleGenerateQr(branch, selectedMerchant.name)}
                    >
                      <QrCode className="size-4 mr-1" />
                      {busyBranchId === branch.id ? 'Creating...' : 'Get QR'}
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Agent's own pending merchant proposals */}
      {myPending.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>My Pending Proposals</CardTitle>
            <CardDescription>Merchants you proposed, awaiting admin approval</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {myPending.map((m) => (
                <div key={m.id} className="flex items-center justify-between text-sm">
                  <span className="font-medium text-foreground">{m.name}</span>
                  <Badge variant="warning">Pending approval</Badge>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Existing shared branch links */}
      {myLinks && myLinks.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>My Shared Branches</CardTitle>
            <CardDescription>
              {myLinks.length} branch QR{myLinks.length !== 1 ? 's' : ''} generated
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {myLinks.map((link) => (
                <div
                  key={link.id}
                  className="flex items-center justify-between p-4 rounded-lg border hover:bg-muted/50"
                >
                  <div>
                    <div className="font-medium text-foreground">{link.branch.name}</div>
                    <div className="text-sm text-muted-foreground">
                      {link.branch.merchant?.name ?? 'Unknown merchant'}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() =>
                        setQr({
                          code: link.link_code,
                          label: `${link.branch.merchant?.name ?? ''} — ${link.branch.name}`,
                        })
                      }
                    >
                      <QrCode className="size-4 mr-1" />
                      Show QR
                    </Button>
                    <Button variant="outline" size="sm" onClick={() => handleCopy(link.link_code)}>
                      {copied ? (
                        <>
                          <Check className="size-4 mr-1 text-emerald-600" /> Copied!
                        </>
                      ) : (
                        <>
                          <Copy className="size-4 mr-1" /> Copy Link
                        </>
                      )}
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Propose Merchant dialog */}
      <Dialog open={isMerchantOpen} onOpenChange={setIsMerchantOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Propose Merchant</DialogTitle>
            <DialogDescription>
              Suggest a new gift-partner merchant. An admin reviews, configures the gift split, and
              approves it before it goes live.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleProposeMerchant} className="space-y-4">
            <div>
              <Label htmlFor="merchant-name">Merchant Name</Label>
              <Input
                id="merchant-name"
                value={merchantName}
                onChange={(e) => setMerchantName(e.target.value)}
                placeholder="Poh Kong"
                required
                className="mt-1.5"
              />
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setIsMerchantOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={proposeMerchant.isPending}>
                {proposeMerchant.isPending ? 'Submitting...' : 'Propose'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Propose Branch dialog */}
      <Dialog open={isBranchOpen} onOpenChange={setIsBranchOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Propose Branch</DialogTitle>
            <DialogDescription>
              Add a branch under {selectedMerchant?.name ?? 'this merchant'}. It awaits admin approval
              before you can share its QR.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleProposeBranch} className="space-y-4">
            <div>
              <Label htmlFor="branch-name">Branch Name</Label>
              <Input
                id="branch-name"
                value={branchForm.name}
                onChange={(e) => setBranchForm((f) => ({ ...f, name: e.target.value }))}
                placeholder="Mid Valley"
                required
                className="mt-1.5"
              />
            </div>
            <div>
              <Label htmlFor="branch-address">Address (optional)</Label>
              <Input
                id="branch-address"
                value={branchForm.address}
                onChange={(e) => setBranchForm((f) => ({ ...f, address: e.target.value }))}
                className="mt-1.5"
              />
            </div>
            <div>
              <Label htmlFor="branch-phone">Phone (optional)</Label>
              <Input
                id="branch-phone"
                value={branchForm.phone}
                onChange={(e) => setBranchForm((f) => ({ ...f, phone: e.target.value }))}
                className="mt-1.5"
              />
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setIsBranchOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={proposeBranch.isPending}>
                {proposeBranch.isPending ? 'Submitting...' : 'Propose'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* QR display dialog */}
      <Dialog open={!!qr} onOpenChange={(open) => !open && setQr(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Branch QR</DialogTitle>
            <DialogDescription>{qr?.label}</DialogDescription>
          </DialogHeader>
          <div className="flex flex-col items-center gap-4 py-4">
            {qr && <QRCodeSVG value={enquiryUrl(qr.code)} size={256} />}
            <p className="text-xs text-muted-foreground break-all text-center">
              {qr && enquiryUrl(qr.code)}
            </p>
            {qr && (
              <Button variant="outline" onClick={() => handleCopy(qr.code)}>
                {copied ? (
                  <>
                    <Check className="size-4 mr-1 text-emerald-600" /> Copied!
                  </>
                ) : (
                  <>
                    <Copy className="size-4 mr-1" /> Copy Link
                  </>
                )}
              </Button>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
```

- [ ] **Step 2: Register the route**

In `apps/agent-portal/src/router.tsx`:
1. Add the import after the `Partners` import (line 15):
```tsx
import { Partnerships } from './pages/Partnerships';
```
2. Add the route definition after `partnersRoute` (around line 107):
```tsx
const partnershipsRoute = createRoute({
  getParentRoute: () => authenticatedRoute,
  path: '/partnerships',
  component: Partnerships,
});
```
3. Add `partnershipsRoute,` to the `authenticatedRoute.addChildren([...])` array (after `partnersRoute,`).

- [ ] **Step 3: Add the nav entry**

In `apps/agent-portal/src/components/Layout.tsx`:
1. Add `Store` to the `lucide-react` import on line 4 (append to the existing list).
2. Insert this line into **both** `agentAdminNavigation` and `agentNavigation`, immediately after their `{ name: 'Rewards', href: '/rewards', icon: Award },` entry:
```tsx
  { name: 'Partnerships', href: '/partnerships', icon: Store },
```
(Do **not** add it to `partnerNavigation`.)

- [ ] **Step 4: Verify build**

Run: `pnpm --filter agent-portal build`
Expected: succeeds with no `tsc` errors (confirm `Store`, `QRCodeSVG`, and every imported hook are used).

- [ ] **Step 5: Manual UI check (user runs the dev server)**

Run `pnpm dev:agent`, log in as `agent@test.com`, open `/partnerships`. Expected: approved merchants list; clicking one shows its branches; "Get QR" on an approved branch opens a dialog with a scannable QR + the `…/public/enquiry/<code>` URL and a working Copy; "Propose Merchant"/"Propose Branch" submit and show a pending badge.

- [ ] **Step 6: Commit**

```bash
git rev-parse --abbrev-ref HEAD   # guard
git add apps/agent-portal/src/pages/Partnerships.tsx apps/agent-portal/src/router.tsx apps/agent-portal/src/components/Layout.tsx
git commit -m "feat(partnership): agent Partnerships page with propose + branch QR sharing"
```

---

## Task 6: Page — My Enquiries

**Files:**
- Create: `apps/agent-portal/src/pages/MyEnquiries.tsx`
- Modify: `apps/agent-portal/src/router.tsx`
- Modify: `apps/agent-portal/src/components/Layout.tsx`

**Interfaces:**
- Consumes: `useAuth` (`agent.id`); `useMyEnquiries`, `EnquiryWithDetails` (Task 4); `getStatusVariant`, `Badge`, table primitives from shared-ui; `format`/`parseISO` from `date-fns`.
- Produces: component `MyEnquiries`; route `/my-enquiries`; nav entry "My Enquiries" (icon `Inbox`).

- [ ] **Step 1: Create the page**

Create `apps/agent-portal/src/pages/MyEnquiries.tsx`:

```tsx
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  Badge,
  getStatusVariant,
  TableSkeleton,
} from '@agent-system/shared-ui';
import { format, parseISO } from 'date-fns';
import { useAuth } from '../hooks/useAuth';
import { useMyEnquiries } from '../hooks/useMyEnquiries';

export function MyEnquiries() {
  const { agent } = useAuth();
  const { data: enquiries, isLoading } = useMyEnquiries(agent?.id);

  return (
    <div className="flex flex-col gap-4 animate-fade-in">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">My Enquiries</h1>
        <p className="text-sm text-muted-foreground">
          Car-insurance enquiries customers submitted through your branch QR links
        </p>
      </div>

      {isLoading ? (
        <Card>
          <CardContent className="py-4">
            <TableSkeleton rows={4} columns={4} />
          </CardContent>
        </Card>
      ) : !enquiries || enquiries.length === 0 ? (
        <Card>
          <CardContent className="py-8 text-center">
            <p className="text-muted-foreground">
              No enquiries yet. Share a branch QR from Partnerships to start receiving them.
            </p>
          </CardContent>
        </Card>
      ) : (
        enquiries.map((enq) => (
          <Card key={enq.id}>
            <CardHeader className="flex flex-row items-start justify-between gap-2">
              <div className="space-y-1">
                <CardTitle className="text-base">{enq.customer_name}</CardTitle>
                <CardDescription>
                  {enq.customer_phone}
                  {enq.customer_email ? ` · ${enq.customer_email}` : ''}
                  {' · '}
                  {enq.branch?.merchant?.name ?? 'Unknown merchant'} — {enq.branch?.name ?? 'Unknown branch'}
                </CardDescription>
                <p className="text-xs text-muted-foreground">
                  Submitted {format(parseISO(enq.created_at), 'd MMM yyyy, HH:mm')}
                </p>
              </div>
              <Badge variant={getStatusVariant(enq.status)} className="capitalize">
                {enq.status}
              </Badge>
            </CardHeader>
            <CardContent>
              <div className="overflow-auto rounded-md border">
                <Table>
                  <TableHeader>
                    <TableRow className="hover:bg-transparent">
                      <TableHead>Car Plate</TableHead>
                      <TableHead>Insurance Expiry</TableHead>
                      <TableHead>Product</TableHead>
                      <TableHead>Status</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {enq.vehicles.map((v) => (
                      <TableRow key={v.id}>
                        <TableCell className="font-medium">{v.car_plate}</TableCell>
                        <TableCell className="text-muted-foreground">
                          {format(parseISO(v.insurance_expiry_date), 'd MMM yyyy')}
                        </TableCell>
                        <TableCell className="text-muted-foreground">
                          {v.product?.name ?? '-'}
                        </TableCell>
                        <TableCell>
                          <Badge variant={getStatusVariant(v.status)} className="capitalize">
                            {v.status}
                          </Badge>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
        ))
      )}
    </div>
  );
}
```

- [ ] **Step 2: Register the route**

In `apps/agent-portal/src/router.tsx`:
1. Add the import after the `Partnerships` import (added in Task 5):
```tsx
import { MyEnquiries } from './pages/MyEnquiries';
```
2. Add the route definition after `partnershipsRoute`:
```tsx
const myEnquiriesRoute = createRoute({
  getParentRoute: () => authenticatedRoute,
  path: '/my-enquiries',
  component: MyEnquiries,
});
```
3. Add `myEnquiriesRoute,` to the `authenticatedRoute.addChildren([...])` array (after `partnershipsRoute,`).

- [ ] **Step 3: Add the nav entry**

In `apps/agent-portal/src/components/Layout.tsx`:
1. Add `Inbox` to the `lucide-react` import on line 4.
2. Insert this line into **both** `agentAdminNavigation` and `agentNavigation`, immediately after the `{ name: 'Partnerships', href: '/partnerships', icon: Store },` entry added in Task 5:
```tsx
  { name: 'My Enquiries', href: '/my-enquiries', icon: Inbox },
```

- [ ] **Step 4: Verify build**

Run: `pnpm --filter agent-portal build`
Expected: succeeds.

- [ ] **Step 5: Commit**

```bash
git rev-parse --abbrev-ref HEAD   # guard
git add apps/agent-portal/src/pages/MyEnquiries.tsx apps/agent-portal/src/router.tsx apps/agent-portal/src/components/Layout.tsx
git commit -m "feat(partnership): agent My Enquiries page"
```

---

## Task 7: Page — My Commissions

**Files:**
- Create: `apps/agent-portal/src/pages/MyCommissions.tsx`
- Modify: `apps/agent-portal/src/router.tsx`
- Modify: `apps/agent-portal/src/components/Layout.tsx`

**Interfaces:**
- Consumes: `useAuth` (`agent.id`); `useMyCommissions`, `MerchantCommissionWithVehicle` (Task 4); `StatCard`/`StatCardGrid`/`Badge`/table primitives from shared-ui; `RewardStatus` enum; `format`/`parseISO` from `date-fns`. Mirrors the status-display + stat-card pattern in `Rewards.tsx` (`paid` === Issued).
- Produces: component `MyCommissions`; route `/my-commissions`; nav entry "My Commissions" (icon `Coins`).

- [ ] **Step 1: Create the page**

Create `apps/agent-portal/src/pages/MyCommissions.tsx`:

```tsx
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  Badge,
  StatCard,
  StatCardGrid,
  TableSkeleton,
} from '@agent-system/shared-ui';
import { Banknote, Clock, CheckCircle } from 'lucide-react';
import { format, parseISO } from 'date-fns';
import { useAuth } from '../hooks/useAuth';
import { useMyCommissions } from '../hooks/useMyCommissions';
import { RewardStatus } from '@agent-system/shared-types';

function fmtDateTime(value: string | null): string {
  if (!value) return '';
  return new Date(value).toLocaleString('en-SG', { dateStyle: 'medium', timeStyle: 'short' });
}

// 'paid' === Issued/Sent, matching the Rewards page semantics.
function commissionDisplay(status: RewardStatus): {
  label: string;
  variant: 'pending' | 'paid' | 'error';
} {
  switch (status) {
    case RewardStatus.PAID:
      return { label: 'Issued', variant: 'paid' };
    case RewardStatus.FAILED:
      return { label: 'Failed', variant: 'error' };
    default:
      return { label: 'Pending', variant: 'pending' };
  }
}

export function MyCommissions() {
  const { agent } = useAuth();
  const { data: commissions, isLoading } = useMyCommissions(agent?.id);

  const rows = commissions ?? [];
  const total = rows.reduce((sum, c) => sum + (c.amount || 0), 0);
  const pending = rows
    .filter((c) => c.status !== RewardStatus.PAID && c.status !== RewardStatus.FAILED)
    .reduce((sum, c) => sum + (c.amount || 0), 0);
  const issued = rows
    .filter((c) => c.status === RewardStatus.PAID)
    .reduce((sum, c) => sum + (c.amount || 0), 0);

  return (
    <div className="flex flex-col gap-4 animate-fade-in">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">My Commissions</h1>
        <p className="text-sm text-muted-foreground">
          Commissions earned when customers renew through your tied branch links
        </p>
      </div>

      <StatCardGrid columns={3}>
        <StatCard
          title="Total"
          value={`RM${total.toFixed(2)}`}
          icon={Banknote}
          iconColor="emerald"
          description={`${rows.length} commission${rows.length !== 1 ? 's' : ''}`}
          loading={isLoading}
        />
        <StatCard
          title="Pending"
          value={`RM${pending.toFixed(2)}`}
          icon={Clock}
          iconColor="amber"
          description="Awaiting issuance"
          loading={isLoading}
        />
        <StatCard
          title="Issued"
          value={`RM${issued.toFixed(2)}`}
          icon={CheckCircle}
          iconColor="sky"
          description="Sent to you"
          loading={isLoading}
        />
      </StatCardGrid>

      <Card>
        <CardHeader>
          <CardTitle>Commission History</CardTitle>
          <CardDescription>One row per renewed vehicle on a tied branch link</CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <TableSkeleton rows={5} columns={5} />
          ) : rows.length === 0 ? (
            <p className="text-muted-foreground">
              No commissions yet. You earn one when a customer renews through a branch QR tied to you.
            </p>
          ) : (
            <div className="overflow-auto rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow className="hover:bg-transparent">
                    <TableHead>Customer</TableHead>
                    <TableHead>Car Plate</TableHead>
                    <TableHead>Expiry</TableHead>
                    <TableHead className="text-right">Amount</TableHead>
                    <TableHead>Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((c) => {
                    const display = commissionDisplay(c.status);
                    return (
                      <TableRow key={c.id}>
                        <TableCell className="font-medium">
                          {c.vehicle?.enquiry?.customer_name ?? '-'}
                        </TableCell>
                        <TableCell className="text-muted-foreground">
                          {c.vehicle?.car_plate ?? '-'}
                        </TableCell>
                        <TableCell className="text-muted-foreground">
                          {c.vehicle?.insurance_expiry_date
                            ? format(parseISO(c.vehicle.insurance_expiry_date), 'd MMM yyyy')
                            : '-'}
                        </TableCell>
                        <TableCell className="text-right font-semibold text-emerald-600">
                          RM{c.amount.toFixed(2)}
                        </TableCell>
                        <TableCell>
                          <Badge variant={display.variant}>{display.label}</Badge>
                          {c.status === RewardStatus.PAID && c.paid_at && (
                            <div className="text-xs text-muted-foreground mt-1">
                              {fmtDateTime(c.paid_at)}
                            </div>
                          )}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
```

- [ ] **Step 2: Register the route**

In `apps/agent-portal/src/router.tsx`:
1. Add the import after the `MyEnquiries` import (added in Task 6):
```tsx
import { MyCommissions } from './pages/MyCommissions';
```
2. Add the route definition after `myEnquiriesRoute`:
```tsx
const myCommissionsRoute = createRoute({
  getParentRoute: () => authenticatedRoute,
  path: '/my-commissions',
  component: MyCommissions,
});
```
3. Add `myCommissionsRoute,` to the `authenticatedRoute.addChildren([...])` array (after `myEnquiriesRoute,`).

- [ ] **Step 3: Add the nav entry**

In `apps/agent-portal/src/components/Layout.tsx`:
1. Add `Coins` to the `lucide-react` import on line 4.
2. Insert this line into **both** `agentAdminNavigation` and `agentNavigation`, immediately after the `{ name: 'My Enquiries', href: '/my-enquiries', icon: Inbox },` entry added in Task 6:
```tsx
  { name: 'My Commissions', href: '/my-commissions', icon: Coins },
```

- [ ] **Step 4: Verify build**

Run: `pnpm --filter agent-portal build`
Expected: succeeds.

- [ ] **Step 5: Manual UI check (user runs the dev server)**

Run `pnpm dev:agent`, log in as `agent@test.com`, open `/my-commissions`. Expected: three stat cards (Total / Pending / Issued) and a commission history table; empty-state copy shows when the agent has no commissions yet.

- [ ] **Step 6: Commit**

```bash
git rev-parse --abbrev-ref HEAD   # guard
git add apps/agent-portal/src/pages/MyCommissions.tsx apps/agent-portal/src/router.tsx apps/agent-portal/src/components/Layout.tsx
git commit -m "feat(partnership): agent My Commissions page"
```

---

## Final verification (after all tasks)

- [ ] `pnpm --filter agent-portal build` is green.
- [ ] `apps/agent-portal/src/router.tsx` registers `/partnerships`, `/my-enquiries`, `/my-commissions` and all three are listed in `authenticatedRoute.addChildren([...])`.
- [ ] `agentAdminNavigation` and `agentNavigation` in `Layout.tsx` each contain the three new entries (Partnerships/My Enquiries/My Commissions); `partnerNavigation` is unchanged.
- [ ] Manual: as `agent@test.com`, propose a merchant → it appears under "My Pending Proposals"; once an admin approves it (Phase 1 admin UI), it moves to "Approved Merchants"; generating a branch QR yields a `…/public/enquiry/<code>` link that resolves to the Phase 2 public enquiry form.
- [ ] No new migration file was created; `is_admin()`/`get_agent_id()`/`update_updated_at()` were not redefined; the only dependency change is `qrcode.react` in `apps/agent-portal/package.json` with `zod` untouched in `pnpm-lock.yaml`.
