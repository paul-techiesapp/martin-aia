# Partnership Feedback Round 3 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement round-3 partnership feedback: full propose-partner flow with agreement upload + admin review, unit-viewer visibility of unit enquiries, Unit Manager/Unit Admin relabel, and gold-reward T&Cs.

**Architecture:** Three new SQL migrations (agreement bucket + merchant columns, unit-viewer enquiry RLS, T&C content), agent-portal propose dialog rework, admin MerchantDetail review additions, unit-wide MyEnquiries. Monorepo: React 18 + Vite + TanStack Query + Supabase.

**Tech Stack:** Supabase (Postgres RLS, Storage), React, react-query, shadcn/ui via `@agent-system/shared-ui`, types via `@agent-system/shared-types`.

## Global Constraints

- Branch: ALL commits go on `feat/merchant-partnership`. Run `git branch --show-current` before every commit (multiple workflows share this working tree).
- No test runner and no eslint in this repo. Verification = `pnpm -r typecheck` (and `pnpm build` at the end). Do NOT run dev servers (user runs them separately).
- Do NOT `pnpm add` anything (dual-zod tsc breakage risk).
- Migrations: create files under `supabase/migrations/`; they are applied to STAGING (Supabase project `lyjdlietzmmejrxjvwgp`) via MCP `apply_migration` in the final task — never `supabase db push`, never prod.
- Spec: `docs/superpowers/specs/2026-07-02-partnership-round-3-design.md`. Item 5 (header/footer on all public forms) is ALREADY IMPLEMENTED (Register.tsx, CheckOut.tsx, Display.tsx all use `useFormBranding`) — verify-only, no code.
- UI naming after this round: top-level agent (no parent) = **Unit Manager**; `is_unit_manager` flag = **Unit Admin** (deputy, same unit-wide view). DB column name `is_unit_manager` is NOT renamed.

---

### Task 1: Migration + types — merchant agreements bucket & proposal columns

**Files:**
- Create: `supabase/migrations/20260703000001_merchant_agreements.sql`
- Modify: `packages/shared-types/src/database.ts` (Merchant interface)

**Interfaces:**
- Produces: `merchants.agreement_path text`, `merchants.contact_person text`, `merchants.contact_phone text`; private bucket `merchant-agreements`; storage policies (agent uploads under own `<agent_id>/` prefix, agent reads own prefix, admin reads all). Merchant TS type gains `agreement_path: string | null; contact_person: string | null; contact_phone: string | null;`

- [ ] **Step 1: Write the migration**

```sql
-- ============================================================
-- Round 3 item 1: agent-proposed partnerships carry contact info
-- and a signed agreement uploaded to a PRIVATE bucket.
-- ============================================================

ALTER TABLE merchants
  ADD COLUMN IF NOT EXISTS agreement_path text,
  ADD COLUMN IF NOT EXISTS contact_person text,
  ADD COLUMN IF NOT EXISTS contact_phone  text;

-- Private bucket for signed partnership agreements (PDF/JPG/PNG, <=10MB).
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'merchant-agreements', 'merchant-agreements', false, 10485760,
  ARRAY['application/pdf','image/jpeg','image/png']
)
ON CONFLICT (id) DO NOTHING;

-- UPLOAD: an authenticated agent may only write under their own <agent_id>/ prefix.
DROP POLICY IF EXISTS "merchant-agreements agent upload own" ON storage.objects;
CREATE POLICY "merchant-agreements agent upload own"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'merchant-agreements'
    AND (storage.foldername(name))[1] = get_agent_id()::text
  );

-- READ: admins read all; agents read their own prefix (signed URLs).
DROP POLICY IF EXISTS "merchant-agreements admin read" ON storage.objects;
CREATE POLICY "merchant-agreements admin read"
  ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'merchant-agreements' AND is_admin());

DROP POLICY IF EXISTS "merchant-agreements agent read own" ON storage.objects;
CREATE POLICY "merchant-agreements agent read own"
  ON storage.objects FOR SELECT TO authenticated
  USING (
    bucket_id = 'merchant-agreements'
    AND (storage.foldername(name))[1] = get_agent_id()::text
  );
```

- [ ] **Step 2: Sync the Merchant type**

In `packages/shared-types/src/database.ts`, find the `Merchant` interface (search `interface Merchant`) and add after `logo_url`:

```typescript
  /** Storage path of the signed partnership agreement (merchant-agreements bucket). */
  agreement_path: string | null;
  contact_person: string | null;
  contact_phone: string | null;
```

- [ ] **Step 3: Verify**

Run: `pnpm -r typecheck` — Expected: PASS (all packages).

- [ ] **Step 4: Commit**

```bash
git branch --show-current   # must print feat/merchant-partnership
git add supabase/migrations/20260703000001_merchant_agreements.sql packages/shared-types/src/database.ts
git commit -m "feat(partnership): merchant agreements bucket + proposal contact columns"
```

---

### Task 2: Migration — unit viewers read unit enquiries

**Files:**
- Create: `supabase/migrations/20260703000002_unit_enquiries_rls.sql`

**Interfaces:**
- Consumes: `is_unit_viewer()`, `unit_member_ids()`, `get_agent_id()` from `20260702000002_unit_manager.sql`.
- Produces: unit viewers can SELECT unit members' rows in `enquiries`, `enquiry_vehicles`, `enquiry_attachments`, and read their attachment objects.

- [ ] **Step 1: Write the migration**

```sql
-- ============================================================
-- Round 3 item 2: unit viewers (Unit Manager = top-level agent,
-- Unit Admin = is_unit_manager deputy) can read their whole unit's
-- enquiries. Additive OR to the existing own-enquiry policies.
-- ============================================================

DROP POLICY IF EXISTS "Unit viewers read unit enquiries" ON enquiries;
CREATE POLICY "Unit viewers read unit enquiries" ON enquiries
  FOR SELECT TO authenticated
  USING (agent_id IN (SELECT unit_member_ids()));

DROP POLICY IF EXISTS "Unit viewers read unit enquiry_vehicles" ON enquiry_vehicles;
CREATE POLICY "Unit viewers read unit enquiry_vehicles" ON enquiry_vehicles
  FOR SELECT TO authenticated
  USING (enquiry_id IN (
    SELECT e.id FROM enquiries e WHERE e.agent_id IN (SELECT unit_member_ids())
  ));

DROP POLICY IF EXISTS "Unit viewers read unit enquiry_attachments" ON enquiry_attachments;
CREATE POLICY "Unit viewers read unit enquiry_attachments" ON enquiry_attachments
  FOR SELECT TO authenticated
  USING (enquiry_id IN (
    SELECT e.id FROM enquiries e WHERE e.agent_id IN (SELECT unit_member_ids())
  ));

-- Storage: allow signed-URL reads of unit members' attachment files.
DROP POLICY IF EXISTS "enquiry-attachments unit viewer read" ON storage.objects;
CREATE POLICY "enquiry-attachments unit viewer read"
  ON storage.objects FOR SELECT TO authenticated
  USING (
    bucket_id = 'enquiry-attachments'
    AND EXISTS (
      SELECT 1 FROM enquiry_attachments ea
      JOIN enquiries e ON e.id = ea.enquiry_id
      WHERE ea.storage_path = storage.objects.name
        AND e.agent_id IN (SELECT unit_member_ids())
    )
  );
```

- [ ] **Step 2: Commit**

```bash
git branch --show-current
git add supabase/migrations/20260703000002_unit_enquiries_rls.sql
git commit -m "feat(partnership): unit viewers read unit enquiries (RLS)"
```

---

### Task 3: Migration + default — gold-reward T&Cs

**Files:**
- Create: `supabase/migrations/20260703000003_gold_reward_tnc.sql`
- Modify: `packages/shared-types` — the `DEFAULT_ENQUIRY_FORM` constant (search `DEFAULT_ENQUIRY_FORM` in `packages/shared-types/src/`; it holds `tnc_body`)

**Interfaces:**
- Produces: gold-reward terms appended to `system_settings.enquiry_form.tnc_body` (stored row) and to the frontend fallback default. Marker string: `Gold Reward Terms & Conditions`.

- [ ] **Step 1: Write the migration** (idempotent: append only when marker absent; skips rows where the admin already added them)

```sql
-- Round 3 item 6: append gold-reward T&Cs (bilingual) to the enquiry-form
-- T&C body. Idempotent via the marker string. Content stays admin-editable.
UPDATE system_settings
SET enquiry_form = jsonb_set(
  enquiry_form,
  '{tnc_body}',
  to_jsonb((enquiry_form->>'tnc_body') || $gold$


Gold Reward Terms & Conditions

1. 必须更新车险才能享有此优惠
Offer only applicable for customers who renew their car insurance.

2. 黄金奖励额度为车险总保费（Gross Premium）的 10%
Gold reward is equivalent to 10% of your car insurance Gross Premium.

3. 相等于车险总保费（Gross Premium）10% 的黄金奖励仅用于兑换黄金，不可兑换现金
Gold reward equivalent to 10% of the car insurance Gross Premium can only be used to redeem gold products through the appointed Gold Partners and strictly not transferable for cash.

4. 黄金奖励仅可用于指定金店兑换黄金产品
The gold reward can only be redeemed for gold products at the appointed Gold Partners.

5. 客户必须在 3 个月内完成兑换
Customers must redeem their gold reward within 3 months from the date of issuance.

6. Example（例子说明）
如果您的车险总保费（Gross Premium）是 RM10,000，您将获得相等于 10%（RM1,000）的黄金奖励。RM1,000 将支付给指定金店，并可用于兑换黄金产品。
If your car insurance Gross Premium is RM10,000, you will receive a gold reward equivalent to 10% (RM1,000). The RM1,000 amount will be paid to the appointed gold shop and can be used to redeem gold products.$gold$)
)
WHERE enquiry_form->>'tnc_body' NOT LIKE '%Gold Reward Terms & Conditions%';
```

- [ ] **Step 2: Append the same block to the frontend fallback**

In `packages/shared-types`, locate `DEFAULT_ENQUIRY_FORM` and append the identical text (starting with two newlines then `Gold Reward Terms & Conditions`) to the end of its `tnc_body` template string. Content must match the migration exactly.

- [ ] **Step 3: Verify**

Run: `pnpm -r typecheck` — Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git branch --show-current
git add supabase/migrations/20260703000003_gold_reward_tnc.sql packages/shared-types
git commit -m "feat(partnership): gold reward T&Cs appended to enquiry form"
```

---

### Task 4: Agent portal — full Propose Partner dialog with agreement upload

**Files:**
- Create: `apps/agent-portal/src/components/ProposePartnerDialog.tsx`
- Modify: `apps/agent-portal/src/hooks/useAgentMerchants.ts` (extend `useProposeMerchant`)
- Modify: `apps/agent-portal/src/pages/MyEnquiries.tsx` (replace inline dialog, lines ~317-337 and 383-416)

**Interfaces:**
- Consumes: `merchants.agreement_path/contact_person/contact_phone` (Task 1), bucket `merchant-agreements`, `useProposeBranch` (exists), `MerchantStatus` enum.
- Produces: `useProposeMerchant().mutateAsync(input: ProposeMerchantInput)` where

```typescript
export interface ProposeMerchantInput {
  agentId: string;
  name: string;
  contactPerson: string;
  contactPhone: string;
  branch: { name: string; address: string; phone: string };
  agreementFile: File;
}
```

- [ ] **Step 1: Extend the hook** — replace the existing `useProposeMerchant` in `useAgentMerchants.ts` with:

```typescript
export interface ProposeMerchantInput {
  agentId: string;
  name: string;
  contactPerson: string;
  contactPhone: string;
  branch: { name: string; address: string; phone: string };
  agreementFile: File;
}

// Agent proposes a new merchant with full info + signed agreement.
// RLS requires status='pending' and created_by_agent_id=get_agent_id();
// money terms are admin-set on approval. The agreement goes to the private
// merchant-agreements bucket under the agent's own prefix.
export function useProposeMerchant() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: ProposeMerchantInput) => {
      const safeName = input.agreementFile.name.replace(/[^a-zA-Z0-9._-]/g, '_');
      const path = `${input.agentId}/${crypto.randomUUID()}-${safeName}`;
      const { error: uploadError } = await supabase.storage
        .from('merchant-agreements')
        .upload(path, input.agreementFile, {
          contentType: input.agreementFile.type,
          upsert: false,
        });
      if (uploadError) throw uploadError;

      const { data: merchant, error } = await supabase
        .from('merchants')
        .insert({
          name: input.name,
          contact_person: input.contactPerson.trim() || null,
          contact_phone: input.contactPhone.trim() || null,
          agreement_path: path,
          status: MerchantStatus.PENDING,
          created_by_agent_id: input.agentId,
        })
        .select()
        .single();
      if (error) throw error;

      const { error: branchError } = await supabase.from('merchant_branches').insert({
        merchant_id: merchant.id,
        name: input.branch.name.trim() || input.name,
        address: input.branch.address.trim() || null,
        phone: input.branch.phone.trim() || null,
        status: MerchantStatus.PENDING,
        created_by_agent_id: input.agentId,
      });
      if (branchError) throw branchError;

      return merchant as Merchant;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['agent-merchants'] });
    },
  });
}
```

- [ ] **Step 2: Create `ProposePartnerDialog.tsx`**

```tsx
import { useRef, useState } from 'react';
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  Label,
  useToast,
} from '@agent-system/shared-ui';
import { FileText, Upload } from 'lucide-react';
import { useProposeMerchant } from '../hooks/useAgentMerchants';

const ACCEPTED = 'application/pdf,image/jpeg,image/png';
const MAX_BYTES = 10 * 1024 * 1024;

interface Props {
  agentId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

// Round 3 item 1: agents submit the full partner profile + signed agreement;
// a master admin reviews the agreement and sets money terms before approval.
export function ProposePartnerDialog({ agentId, open, onOpenChange }: Props) {
  const { toast } = useToast();
  const proposeMerchant = useProposeMerchant();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [name, setName] = useState('');
  const [contactPerson, setContactPerson] = useState('');
  const [contactPhone, setContactPhone] = useState('');
  const [branchName, setBranchName] = useState('');
  const [branchAddress, setBranchAddress] = useState('');
  const [branchPhone, setBranchPhone] = useState('');
  const [agreementFile, setAgreementFile] = useState<File | null>(null);

  const reset = () => {
    setName(''); setContactPerson(''); setContactPhone('');
    setBranchName(''); setBranchAddress(''); setBranchPhone('');
    setAgreementFile(null);
  };

  const handleFile = (file: File | undefined) => {
    if (!file) return;
    if (file.size > MAX_BYTES) {
      toast({ title: 'File too large', description: 'Max 10 MB.', variant: 'error' });
      return;
    }
    setAgreementFile(file);
  };

  const canSubmit = name.trim() !== '' && agreementFile !== null && !proposeMerchant.isPending;

  const handleSubmit = async () => {
    if (!canSubmit || !agreementFile) return;
    try {
      await proposeMerchant.mutateAsync({
        agentId,
        name: name.trim(),
        contactPerson,
        contactPhone,
        branch: { name: branchName, address: branchAddress, phone: branchPhone },
        agreementFile,
      });
      toast({ title: 'Submitted for admin approval' });
      reset();
      onOpenChange(false);
    } catch (err: unknown) {
      toast({ title: 'Failed to submit', description: (err as Error)?.message, variant: 'error' });
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Propose a Partnership</DialogTitle>
          <DialogDescription>
            Complete the partner info and upload the signed agreement. A master admin will
            review and approve before the partnership becomes active.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3 py-2">
          <div className="space-y-1.5">
            <Label htmlFor="propose-partner-name">Merchant name *</Label>
            <Input id="propose-partner-name" value={name} onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Golden Jewellers" autoFocus />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="propose-contact-person">Contact person</Label>
              <Input id="propose-contact-person" value={contactPerson}
                onChange={(e) => setContactPerson(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="propose-contact-phone">Contact phone</Label>
              <Input id="propose-contact-phone" value={contactPhone}
                onChange={(e) => setContactPhone(e.target.value)} />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="propose-branch-name">First branch / outlet</Label>
            <Input id="propose-branch-name" value={branchName}
              onChange={(e) => setBranchName(e.target.value)}
              placeholder="Defaults to merchant name" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="propose-branch-address">Branch address</Label>
            <Input id="propose-branch-address" value={branchAddress}
              onChange={(e) => setBranchAddress(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="propose-branch-phone">Branch phone</Label>
            <Input id="propose-branch-phone" value={branchPhone}
              onChange={(e) => setBranchPhone(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label>Signed agreement (PDF or image) *</Label>
            <input
              ref={fileInputRef}
              type="file"
              accept={ACCEPTED}
              className="hidden"
              onChange={(e) => handleFile(e.target.files?.[0])}
            />
            <Button type="button" variant="outline" className="w-full justify-start"
              onClick={() => fileInputRef.current?.click()}>
              {agreementFile ? (
                <><FileText className="size-4 mr-2" />
                  <span className="truncate">{agreementFile.name}</span></>
              ) : (
                <><Upload className="size-4 mr-2" />Upload agreement</>
              )}
            </Button>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={handleSubmit} disabled={!canSubmit}>
            {proposeMerchant.isPending ? 'Submitting…' : 'Submit for approval'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 3: Rewire `MyEnquiries.tsx`**

Remove: `useProposeMerchant` import + usage, `proposeName` state, `handlePropose`, and the whole inline `<Dialog>` block (`{role === 'agent_admin' && (<Dialog …>…</Dialog>)}`). Also remove now-unused imports (`Dialog*`, `Input`, `Label`) if nothing else uses them. Keep `proposeOpen` state and the button. Add:

```tsx
import { ProposePartnerDialog } from '../components/ProposePartnerDialog';
```

and where the inline dialog was:

```tsx
{role === 'agent_admin' && agent?.id && (
  <ProposePartnerDialog agentId={agent.id} open={proposeOpen} onOpenChange={setProposeOpen} />
)}
```

Rename button text `Propose Partner` → `Propose Partnership`.

- [ ] **Step 4: Verify**

Run: `pnpm -r typecheck` — Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git branch --show-current
git add apps/agent-portal packages/shared-types
git commit -m "feat(partnership): full propose-partnership dialog with agreement upload"
```

---

### Task 5: Admin portal — review proposal (contact info, agreement, share %)

**Files:**
- Modify: `apps/admin-portal/src/pages/merchants/MerchantDetail.tsx` (Partnership Details card, ~lines 270-285)
- Modify: `apps/admin-portal/src/hooks/useMerchants.ts` (no change needed — `useUpdateMerchant` already accepts partial updates)

**Interfaces:**
- Consumes: `merchant.contact_person/contact_phone/agreement_path` (Task 1), `useUpdateMerchant`, `useApproveMerchant` (unchanged), supabase storage signed URLs.

- [ ] **Step 1: Add a view-agreement helper + share% editor to `MerchantDetail.tsx`**

Imports to add: `useUpdateMerchant` from `../../hooks/useMerchants`, `FileText` from `lucide-react`, `supabase` from `../../lib/supabase` (check the existing import path used by hooks in this app — hooks use `../lib/supabase`, so from the page it is `../../lib/supabase`).

Inside `MerchantDetail()` add:

```tsx
const { toast } = useToast();
const updateMerchant = useUpdateMerchant();
const [sharePct, setSharePct] = useState<string>('');

const handleViewAgreement = async () => {
  if (!merchant?.agreement_path) return;
  const { data, error } = await supabase.storage
    .from('merchant-agreements')
    .createSignedUrl(merchant.agreement_path, 60);
  if (error || !data?.signedUrl) {
    toast({ title: 'Could not open agreement', description: error?.message, variant: 'error' });
    return;
  }
  window.open(data.signedUrl, '_blank');
};

const handleSaveShare = async () => {
  const pct = Number(sharePct);
  if (Number.isNaN(pct) || pct < 0 || pct > 100) {
    toast({ title: 'Invalid share %', description: 'Enter a number 0-100.', variant: 'error' });
    return;
  }
  try {
    await updateMerchant.mutateAsync({ id: merchantId, merchant_share_pct: pct });
    toast({ title: 'Merchant share updated' });
  } catch (err: unknown) {
    toast({ title: 'Failed to update', description: (err as Error)?.message, variant: 'error' });
  }
};
```

Extend the "Partnership Details" `CardContent` (after the existing customer-gift lines):

```tsx
{(merchant?.contact_person || merchant?.contact_phone) && (
  <div>
    Contact:{' '}
    <span className="text-foreground">
      {merchant?.contact_person ?? '—'}
      {merchant?.contact_phone ? ` · ${merchant.contact_phone}` : ''}
    </span>
  </div>
)}
{merchant?.agreement_path && (
  <div>
    <Button variant="outline" size="sm" onClick={handleViewAgreement}>
      <FileText className="size-4 mr-1.5" />
      View signed agreement
    </Button>
  </div>
)}
<div className="flex items-center gap-2 pt-1">
  <span>Merchant share %:</span>
  <Input
    className="h-8 w-24"
    inputMode="decimal"
    placeholder={String(merchant?.merchant_share_pct ?? 0)}
    value={sharePct}
    onChange={(e) => setSharePct(e.target.value)}
  />
  <Button size="sm" variant="outline" onClick={handleSaveShare}
    disabled={sharePct.trim() === '' || updateMerchant.isPending}>
    Save
  </Button>
</div>
```

- [ ] **Step 2: Verify**

Run: `pnpm -r typecheck` — Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git branch --show-current
git add apps/admin-portal
git commit -m "feat(partnership): admin reviews proposal agreement + sets merchant share"
```

---

### Task 6: Agent portal — unit-wide enquiries for unit viewers

**Files:**
- Modify: `apps/agent-portal/src/hooks/useMyEnquiries.ts`
- Modify: `apps/agent-portal/src/pages/MyEnquiries.tsx`

**Interfaces:**
- Consumes: RLS from Task 2; `useAuth()` already exposes `isUnitViewer` (see `apps/agent-portal/src/hooks/useAuth.ts:63`) — verify the exact exported name before using.
- Produces: `useMyEnquiries(agentId, unitWide)`; `EnquiryWithDetails` gains `agent: { id: string; name: string; agent_code: string } | null`.

- [ ] **Step 1: Extend the hook**

```typescript
export interface EnquiryWithDetails extends Enquiry {
  merchant_id: string | null;
  merchant: { name: string } | null;
  branch: { name: string; merchant: { name: string } | null } | null;
  vehicles: EnquiryVehicleWithProduct[];
  /** Owning agent (for unit viewers seeing the whole unit). */
  agent: { id: string; name: string; agent_code: string } | null;
}

// Enquiries visible to this agent. Unit viewers (Unit Manager / Unit Admin)
// fetch WITHOUT the agent filter — RLS scopes rows to their unit.
export function useMyEnquiries(agentId: string | undefined, unitWide = false) {
  return useQuery({
    queryKey: ['my-enquiries', agentId, unitWide],
    queryFn: async () => {
      let query = supabase
        .from('enquiries')
        .select(`
          *,
          agent:agents(id, name, agent_code),
          merchant:merchants(name),
          branch:merchant_branches(name, merchant:merchants(name)),
          vehicles:enquiry_vehicles(*, product:insurance_products(name), merchant:merchants(name))
        `)
        .order('created_at', { ascending: false });
      if (!unitWide) query = query.eq('agent_id', agentId!);
      const { data, error } = await query;
      if (error) throw error;
      return (data ?? []) as EnquiryWithDetails[];
    },
    enabled: !!agentId,
  });
}
```

- [ ] **Step 2: Update `MyEnquiries.tsx`**

- Get `isUnitViewer` from `useAuth()` (confirm exported field name in `useAuth.ts`) and call `useMyEnquiries(agent?.id, isUnitViewer)`.
- Add an agent filter above the list when `isUnitViewer`:

```tsx
const [agentFilter, setAgentFilter] = useState<string>('all');
const agentOptions = Array.from(
  new Map(
    (enquiries ?? [])
      .filter((e) => e.agent)
      .map((e) => [e.agent!.id, e.agent!])
  ).values()
);
const visibleEnquiries = sortedEnquiries.filter(
  (e) => agentFilter === 'all' || e.agent?.id === agentFilter
);
```

Render (next to the Download button, only when `isUnitViewer && agentOptions.length > 1`):

```tsx
<Select value={agentFilter} onValueChange={setAgentFilter}>
  <SelectTrigger className="w-44 h-9 text-sm">
    <SelectValue placeholder="All agents" />
  </SelectTrigger>
  <SelectContent>
    <SelectItem value="all">All agents</SelectItem>
    {agentOptions.map((a) => (
      <SelectItem key={a.id} value={a.id}>{a.name} ({a.agent_code})</SelectItem>
    ))}
  </SelectContent>
</Select>
```

- Map over `visibleEnquiries` instead of `sortedEnquiries`.
- On each `EnquiryCard` header, when `isUnitViewer` and `enq.agent`, show the owning agent — pass a new optional prop `showAgent` and render under the customer description:

```tsx
{showAgent && enq.agent && (
  <p className="text-xs text-muted-foreground">Agent: {enq.agent.name} ({enq.agent.agent_code})</p>
)}
```

- Export rows: in `toEnquiryExportRows`, use the row's own agent when present:

```typescript
const base = {
  unit,
  agent: e.agent?.name ?? agentName,
  agentCode: e.agent?.agent_code ?? agentCode,
  ...
```

(and export `visibleEnquiries`, not all).

- Note: `useAssignVehicleMerchant`/`useRequestQuote` act on the enquiry's vehicles; they keep working for the viewer's OWN enquiries. RLS still prevents a unit viewer from mutating other agents' rows — actions on unit members' enquiries will error. Hide mutating controls on rows not owned by the viewer: pass `readOnly={enq.agent_id !== agent?.id}` to `EnquiryCard` and skip rendering the Assign select and Get Quote button when `readOnly`.

- [ ] **Step 3: Verify**

Run: `pnpm -r typecheck` — Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git branch --show-current
git add apps/agent-portal
git commit -m "feat(partnership): unit viewers see unit-wide enquiries with agent filter"
```

---

### Task 7: Relabel — Unit Manager (head) / Unit Admin (deputy)

**Files:** user-facing strings only; DB names unchanged.
- Modify: `apps/admin-portal/src/pages/agents/AgentForm.tsx:304-307`
- Modify: `apps/admin-portal/src/pages/agents/AgentList.tsx:132`
- Modify: `apps/agent-portal/src/components/Layout.tsx:98`
- Modify: `apps/agent-portal/src/pages/TeamReport.tsx:64`, `MyAgents.tsx:64`, `Campaigns.tsx:43`, `Dashboard.tsx:151`, `MyLinks.tsx:76`, `PartnerLinks.tsx:55`

**Interfaces:** none (copy changes only).

- [ ] **Step 1: Apply the relabels**

- `AgentForm.tsx`: `<FormLabel>Unit Manager</FormLabel>` → `<FormLabel>Unit Admin</FormLabel>`; description → `Deputy who can view the whole unit's data (same view as the Unit Manager).`
- `Layout.tsx:98`: `'Unit Administrator'` → `'Unit Manager'`.
- `TeamReport.tsx:64`: `only available to unit administrators and managers.` → `only available to unit managers and unit admins.`
- `MyAgents.tsx:64`: `only available to unit administrators.` → `only available to unit managers.`
- `Campaigns.tsx:43`, `Dashboard.tsx:151`, `MyLinks.tsx:76`, `PartnerLinks.tsx:55`: `unit administrator` → `unit manager`.
- `AgentList.tsx:132`: `from unit administrators` → `from unit managers`.
- Comments referencing the old meaning (e.g. `AgentForm`, `useAuth.ts`, `unit_manager.sql` is history — leave migrations untouched) may be updated where touched, but do not chase every comment.

- [ ] **Step 2: Verify**

Run: `pnpm -r typecheck` — Expected: PASS. Then `grep -rn "Unit Administrator" apps | grep -v node_modules` — Expected: no user-facing hits remain.

- [ ] **Step 3: Commit**

```bash
git branch --show-current
git add apps
git commit -m "feat(partnership): relabel hierarchy Unit Manager > Unit Admin > Agents"
```

---

### Task 8: Build, apply to staging, operational setup

**Files:** none new (operational).

- [ ] **Step 1: Full verification**

Run: `pnpm -r typecheck && pnpm build` — Expected: all apps build.

- [ ] **Step 2: Apply the three migrations to STAGING** (project `lyjdlietzmmejrxjvwgp`) via MCP `apply_migration`, in filename order, names `merchant_agreements`, `unit_enquiries_rls`, `gold_reward_tnc`. Verify with `execute_sql`: `SELECT column_name FROM information_schema.columns WHERE table_name='merchants' AND column_name IN ('agreement_path','contact_person','contact_phone');` and `SELECT enquiry_form->>'tnc_body' LIKE '%Gold Reward Terms%' FROM system_settings;` — Expected: 3 columns; `t`.

- [ ] **Step 3: A-Z logo (item 4)** — upload `/Users/paullee/Downloads/A-Z LOGO.png` to the STAGING `company-assets` bucket (path `branding/a-z-logo.png`; use a small Node script with the staging service key, or ask the user to drop it via admin Settings UI which already uploads to company-assets). Then set `system_settings.form_branding.logo_url` to the public URL via `execute_sql`:

```sql
UPDATE system_settings SET form_branding = jsonb_set(
  COALESCE(form_branding, '{}'::jsonb), '{logo_url}',
  to_jsonb('https://lyjdlietzmmejrxjvwgp.supabase.co/storage/v1/object/public/company-assets/branding/a-z-logo.png'::text));
```

- [ ] **Step 4: Item 5 verify-only** — confirm Register/CheckOut/Display still render `useFormBranding` logo+footer (code check only; user tests in browser).

- [ ] **Step 5: Push branch** (`git push`) so staging Render sites redeploy. Do NOT touch prod (Supabase `mjtdsevynrtcmafsnxsj` / prod settings) — prod rollout happens only on the user's explicit go.
