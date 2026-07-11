# Partnership Feedback Round 5 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix client feedback round 5 (PDF 080726): master-partner scoping of the Assign-partner dropdown, My Partners visibility for all agents, per-partner form design, "Submitted via" chip on branch forms, collision-proof event link colors, date filters/sorting on Branch Performance and My Enquiries, and Unit-Manager-to-unit linking.

**Architecture:** One migration adds `merchants.is_master` + `merchants.form_settings`, a shared `merchant_available_to_agent()` SQL helper reused by a tightened `assign_vehicle_merchant`, and an extended `get_enquiry_context`. Frontend mirrors the same availability rule in one TS helper used by both the dropdown and My Partners. Everything else is per-page UI work.

**Tech Stack:** React 18 + TanStack Query, Supabase (Postgres RLS/RPC, edge functions on Deno), pnpm monorepo.

## Global Constraints

- **Branch:** all commits on `feat/partnership-round-5` — run `git branch --show-current` before EVERY commit (shared working tree; HEAD can thrash).
- **No test runner in this repo.** The verification gate for every task is: `pnpm -r typecheck` (must exit 0). Run `pnpm build` once in the final task. Do not add a test framework.
- **Migrations:** files go in `supabase/migrations/`; they are applied to hosted staging (`lyjdlietzmmejrxjvwgp`) and prod (`mjtdsevynrtcmafsnxsj`) via the Supabase MCP `apply_migration` tool in the deployment task — NEVER `supabase db push`.
- **Zod stays at 3.23.8 everywhere** — do not run `pnpm add` for any package.
- All portals import supabase from `../lib/supabase` (re-export of shared-ui client) — never `createClient`.
- UI terminology: top-level agent = "Unit"; `is_unit_manager` deputy is labeled **"Unit Admin"** in the admin portal.

---

### Task 1: Migration — `is_master`, `form_settings`, scoped assign RPC, extended enquiry context

**Files:**
- Create: `supabase/migrations/20260711000001_partner_master_scope.sql`
- Modify: `packages/shared-types/src/merchant.ts:9-31`

**Interfaces:**
- Produces (DB): `merchants.is_master boolean NOT NULL DEFAULT false`; `merchants.form_settings jsonb NULL`; `merchant_available_to_agent(p_merchant_id uuid, p_agent_id uuid) RETURNS boolean`; `assign_vehicle_merchant(p_vehicle_id uuid, p_merchant_id uuid)` now raises `P0008` for out-of-scope merchants; `get_enquiry_context(p_link_code text)` now returns a 6th column `merchant_form_settings jsonb`.
- Produces (TS): `Merchant.is_master: boolean`, `Merchant.form_settings: MerchantFormSettings | null`, exported `interface MerchantFormSettings`.

- [ ] **Step 1: Write the migration**

Create `supabase/migrations/20260711000001_partner_master_scope.sql`:

```sql
-- Round 5 item 1 (CRITICAL): explicit Master Partner flag. Round 4 treated
-- "admin-created" (created_by_agent_id IS NULL) as master, which put EVERY
-- admin-created partner in every agent's Assign dropdown. Now only merchants
-- explicitly flagged is_master are assignable by all agents; other merchants
-- stay scoped to the proposing agent or agents holding a branch link.
ALTER TABLE merchants ADD COLUMN IF NOT EXISTS is_master boolean NOT NULL DEFAULT false;
-- Backfill: merchants with a portal login are the client's Master Partners today.
UPDATE merchants SET is_master = true WHERE user_id IS NOT NULL;

-- Round 5 item 3 (NEW): per-partner form design for branch enquiry forms.
-- Optional keys: header_image_url, header_logo_url, header_title,
-- header_subtitle, footer_text. Absent keys fall back to global settings.
ALTER TABLE merchants ADD COLUMN IF NOT EXISTS form_settings jsonb;

-- Single source of truth for "may this agent use this partner?", mirrored by
-- isMerchantAvailableToAgent() in the agent portal.
CREATE OR REPLACE FUNCTION merchant_available_to_agent(p_merchant_id uuid, p_agent_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM merchants m
    WHERE m.id = p_merchant_id AND m.status = 'active'
      AND (
        m.is_master
        OR m.created_by_agent_id = p_agent_id
        OR EXISTS (
          SELECT 1 FROM branch_links bl
          JOIN merchant_branches b ON b.id = bl.merchant_branch_id
          WHERE bl.agent_id = p_agent_id AND b.merchant_id = m.id
        )
      )
  );
$$;
GRANT EXECUTE ON FUNCTION merchant_available_to_agent(uuid, uuid) TO authenticated;

-- Same body as 20260706000001 but the merchant check now uses the helper
-- (is_master / own proposal / branch link) instead of created_by IS NULL.
CREATE OR REPLACE FUNCTION assign_vehicle_merchant(p_vehicle_id uuid, p_merchant_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_agent_id uuid := get_agent_id();
BEGIN
  IF v_agent_id IS NULL THEN
    RAISE EXCEPTION 'Not an agent' USING ERRCODE='42501';
  END IF;
  IF NOT merchant_available_to_agent(p_merchant_id, v_agent_id) THEN
    RAISE EXCEPTION 'Partnership not found, not active, or not assignable by you' USING ERRCODE='P0008';
  END IF;
  UPDATE enquiry_vehicles ev
     SET merchant_id = p_merchant_id
    FROM enquiries e
   WHERE ev.id = p_vehicle_id
     AND e.id = ev.enquiry_id
     AND (e.agent_id = v_agent_id OR e.agent_id IN (SELECT unit_member_ids()));
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Vehicle not found or not yours' USING ERRCODE='42501';
  END IF;
END;
$$;
GRANT EXECUTE ON FUNCTION assign_vehicle_merchant(uuid, uuid) TO authenticated;

-- get_enquiry_context gains merchant_form_settings. Return type changes, so
-- drop + recreate (CREATE OR REPLACE cannot change OUT columns).
DROP FUNCTION IF EXISTS get_enquiry_context(text);
CREATE FUNCTION get_enquiry_context(p_link_code text)
RETURNS TABLE (
  kind text, agent_name text, merchant_name text, merchant_logo_url text,
  branch_name text, merchant_form_settings jsonb
) AS $$
  SELECT 'agent'::text, a.name, NULL::text, NULL::text, NULL::text, NULL::jsonb
  FROM agents a WHERE a.enquiry_link_code = p_link_code AND a.status = 'active'
  UNION ALL
  SELECT 'branch'::text, NULL::text, m.name, m.logo_url, b.name, m.form_settings
  FROM branch_links bl
  JOIN merchant_branches b ON b.id = bl.merchant_branch_id
  JOIN merchants m ON m.id = b.merchant_id
  WHERE bl.link_code = p_link_code AND bl.is_active = true
    AND b.status = 'active' AND m.status = 'active'
  LIMIT 1;
$$ LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public;
GRANT EXECUTE ON FUNCTION get_enquiry_context(text) TO anon;
```

- [ ] **Step 2: Update the Merchant shared type**

In `packages/shared-types/src/merchant.ts`, add above `export interface Merchant {`:

```typescript
/** Per-partner overrides for the public branch enquiry form (Round 5 item 3). */
export interface MerchantFormSettings {
  header_image_url?: string;
  header_logo_url?: string;
  header_title?: string;
  header_subtitle?: string;
  footer_text?: string;
}
```

Inside `Merchant`, after `portal_email: string | null;` add:

```typescript
  /** Master Partner: assignable/visible to every agent (Round 5 item 1). */
  is_master: boolean;
  /** Per-partner form design; null = use global enquiry-form settings. */
  form_settings: MerchantFormSettings | null;
```

- [ ] **Step 3: Verify**

Run: `pnpm -r typecheck`
Expected: exit 0 (new fields are additive; no consumer breaks yet).

- [ ] **Step 4: Commit**

```bash
git branch --show-current   # must print feat/partnership-round-5
git add supabase/migrations/20260711000001_partner_master_scope.sql packages/shared-types/src/merchant.ts
git commit -m "feat(partner): is_master flag + per-partner form_settings; scope assign RPC and enquiry context"
```

---

### Task 2: Agent portal — availability helper + scoped Assign dropdown

**Files:**
- Create: `apps/agent-portal/src/lib/partnerScope.ts`
- Modify: `apps/agent-portal/src/hooks/useAgentMerchants.ts` (append hook)
- Modify: `apps/agent-portal/src/pages/MyEnquiries.tsx:430-447`

**Interfaces:**
- Consumes: `Merchant.is_master` from Task 1.
- Produces: `isMerchantAvailableToAgent(m: Merchant, agentId: string | undefined, linkedMerchantIds: ReadonlySet<string>): boolean`; `useMyLinkedMerchantIds(agentId: string | undefined)` returning `Set<string>` of merchant ids. Task 3 reuses both.

- [ ] **Step 1: Create the helper**

Create `apps/agent-portal/src/lib/partnerScope.ts`:

```typescript
import { MerchantStatus, type Merchant } from '@agent-system/shared-types';

// Round 5 item 1: a merchant is available to an agent when it is active AND
// (explicitly Master, OR proposed by this agent, OR the agent holds a branch
// link into it). Mirrors merchant_available_to_agent() in Postgres — keep the
// two in sync.
export function isMerchantAvailableToAgent(
  m: Merchant,
  agentId: string | undefined,
  linkedMerchantIds: ReadonlySet<string>,
): boolean {
  return (
    m.status === MerchantStatus.ACTIVE &&
    (m.is_master ||
      (!!agentId && m.created_by_agent_id === agentId) ||
      linkedMerchantIds.has(m.id))
  );
}
```

- [ ] **Step 2: Add the linked-merchants hook**

Append to `apps/agent-portal/src/hooks/useAgentMerchants.ts`:

```typescript
// Merchant ids the agent is branch-linked to (their own branch QR links).
// RLS "Agents manage own branch_links" already scopes rows to the caller.
export function useMyLinkedMerchantIds(agentId: string | undefined) {
  return useQuery({
    queryKey: ['my-linked-merchants', agentId],
    enabled: !!agentId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('branch_links')
        .select('branch:merchant_branches(merchant_id)')
        .eq('agent_id', agentId!);
      if (error) throw error;
      const ids = new Set<string>();
      for (const row of (data ?? []) as unknown as { branch: { merchant_id: string } | null }[]) {
        if (row.branch?.merchant_id) ids.add(row.branch.merchant_id);
      }
      return ids;
    },
  });
}
```

- [ ] **Step 3: Scope the dropdown in MyEnquiries**

In `apps/agent-portal/src/pages/MyEnquiries.tsx`:

Add imports (extend the existing import lines):

```typescript
import { useAgentMerchants, useMyLinkedMerchantIds, type MerchantWithBranches } from '../hooks/useAgentMerchants';
import { isMerchantAvailableToAgent } from '../lib/partnerScope';
```

Inside `MyEnquiries()`, after `const { data: merchants } = useAgentMerchants();` add:

```typescript
  const { data: linkedMerchantIds } = useMyLinkedMerchantIds(agent?.id);
```

Replace the `activeMerchants` computation (currently `m.status === MerchantStatus.ACTIVE && (m.created_by_agent_id === null || m.created_by_agent_id === agent?.id)`):

```typescript
  // Round 5 item 1: only Master Partners, own proposals, or branch-linked
  // merchants may be assigned — never every admin-created partner.
  const activeMerchants =
    merchants?.filter((m) =>
      isMerchantAvailableToAgent(m, agent?.id, linkedMerchantIds ?? new Set<string>()),
    ) ?? [];
```

Remove `MerchantStatus` from the `@agent-system/shared-types` import in this file if it becomes unused (check the rest of the file first — `EnquiryStatus` and `VehicleStatus` stay).

- [ ] **Step 4: Verify**

Run: `pnpm -r typecheck`
Expected: exit 0.

- [ ] **Step 5: Commit**

```bash
git branch --show-current   # must print feat/partnership-round-5
git add apps/agent-portal/src/lib/partnerScope.ts apps/agent-portal/src/hooks/useAgentMerchants.ts apps/agent-portal/src/pages/MyEnquiries.tsx
git commit -m "fix(agent): assign-partner dropdown limited to master/own/linked partners"
```

---

### Task 3: My Partners shows available partners; Event Partners clarifying copy

**Files:**
- Modify: `apps/agent-portal/src/pages/MyPartners.tsx`
- Modify: `apps/agent-portal/src/pages/Partners.tsx:191`

**Interfaces:**
- Consumes: `isMerchantAvailableToAgent`, `useMyLinkedMerchantIds` from Task 2.

- [ ] **Step 1: Rework MyPartners**

In `apps/agent-portal/src/pages/MyPartners.tsx`:

Add imports:

```typescript
import { useAgentMerchants, useMyLinkedMerchantIds } from '../hooks/useAgentMerchants';
import { isMerchantAvailableToAgent } from '../lib/partnerScope';
```

(keep the existing `useAgentMerchants` import line updated rather than duplicated).

Inside `MyPartners()`, replace:

```typescript
  const myMerchants = (merchants ?? []).filter((m) => m.created_by_agent_id === agent?.id);
```

with:

```typescript
  const { data: linkedMerchantIds } = useMyLinkedMerchantIds(agent?.id);
  // Round 5 item 4b: every agent sees the partners available to them —
  // masters + branch-linked + own proposals (own pending ones included).
  const myMerchants = (merchants ?? []).filter(
    (m) =>
      m.created_by_agent_id === agent?.id ||
      isMerchantAvailableToAgent(m, agent?.id, linkedMerchantIds ?? new Set<string>()),
  );
  const sourceOf = (m: (typeof myMerchants)[number]): string =>
    m.created_by_agent_id === agent?.id
      ? 'Proposed by you'
      : m.is_master
        ? 'Master'
        : 'Linked';
```

Update the page copy: change the `<p className="text-sm text-muted-foreground">` description under the "My Partners" h1 to:

```
Partnership merchants available to you — master partners, branch-linked partners, and your own proposals
```

Change the card title/description block from `Proposed Partners` / `{myMerchants.length} partners` to `Available Partners` / `{myMerchants.length} partners`, and the empty state text to:

```
No partners available yet. Master partners appear here automatically once set up.
```

Add a **Source** column: in the `<TableHeader>` row insert `<TableHead>Source</TableHead>` after `<TableHead>Branches</TableHead>`, and in the body row insert after the branches cell:

```tsx
                    <TableCell>
                      <Badge variant="outline">{sourceOf(m)}</Badge>
                    </TableCell>
```

(If the shared-ui `Badge` has no `outline` variant per typecheck, use `<Badge variant="inactive">` instead — check `packages/shared-ui/src/components/badge.tsx` variants.)

- [ ] **Step 2: Event Partners clarifying line**

In `apps/agent-portal/src/pages/Partners.tsx:191` replace:

```tsx
          <p className="text-sm text-muted-foreground">Manage your recruitment partners and track their activity</p>
```

with:

```tsx
          <p className="text-sm text-muted-foreground">
            Recruitment partners for events — insurance partnership merchants are managed under Partnership → My Partners
          </p>
```

- [ ] **Step 3: Verify**

Run: `pnpm -r typecheck`
Expected: exit 0.

- [ ] **Step 4: Commit**

```bash
git branch --show-current   # must print feat/partnership-round-5
git add apps/agent-portal/src/pages/MyPartners.tsx apps/agent-portal/src/pages/Partners.tsx
git commit -m "feat(agent): My Partners lists available partners for every agent; clarify Event Partners copy"
```

---

### Task 4: Admin — Master Partner toggle + Form Design section in Partner setup

**Files:**
- Modify: `apps/admin-portal/src/pages/merchants/MerchantDetail.tsx`
- Modify: `apps/admin-portal/src/pages/merchants/MerchantList.tsx` (Master badge)

**Interfaces:**
- Consumes: `Merchant.is_master`, `Merchant.form_settings`, `MerchantFormSettings` (Task 1); existing `useUpdateMerchant` (accepts `Partial<Merchant> & { id }`), `useUploadFormImage` from `../../hooks/useCompanyAssets` (uploads to public `company-assets` bucket, returns public URL).

- [ ] **Step 1: Master Partner toggle**

In `apps/admin-portal/src/pages/merchants/MerchantDetail.tsx`:

Add `Switch` to the `@agent-system/shared-ui` import list and `MerchantFormSettings` to the shared-types import:

```typescript
import { MerchantStatus, type MerchantBranch, type MerchantFormSettings } from '@agent-system/shared-types';
```

Add a handler inside `MerchantDetail()` (near `handleSaveShare`):

```typescript
  const handleToggleMaster = async (checked: boolean) => {
    try {
      await updateMerchant.mutateAsync({ id: merchantId, is_master: checked });
      toast({
        title: checked ? 'Marked as Master Partner' : 'Master Partner removed',
        description: checked
          ? 'Every agent can now assign this partner.'
          : 'Only the proposing/linked agents can assign this partner now.',
      });
    } catch (err: unknown) {
      toast({ title: 'Failed to update', description: (err as Error)?.message, variant: 'error' });
    }
  };
```

In the "Partnership Details" `CardContent`, after the merchant-share row `</div>` add:

```tsx
          <div className="flex items-center gap-2 pt-2">
            <Switch
              checked={!!merchant?.is_master}
              onCheckedChange={handleToggleMaster}
              disabled={updateMerchant.isPending}
            />
            <span>
              Master Partner — appears in <span className="text-foreground">every</span> agent's Assign-partner list
            </span>
          </div>
```

- [ ] **Step 2: Form Design card**

In the same file, add a `FormDesignCard` component above `export function MerchantDetail()`:

```tsx
function FormDesignCard({ merchantId, formSettings }: { merchantId: string; formSettings: MerchantFormSettings | null }) {
  const { toast } = useToast();
  const updateMerchant = useUpdateMerchant();
  const uploadFormImage = useUploadFormImage();
  const [draft, setDraft] = useState<MerchantFormSettings>(formSettings ?? {});
  const [uploadingKey, setUploadingKey] = useState<'header_image_url' | 'header_logo_url' | null>(null);

  const handleUpload = async (
    key: 'header_image_url' | 'header_logo_url',
    e: React.ChangeEvent<HTMLInputElement>,
  ) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (!['image/png', 'image/jpeg'].includes(file.type)) {
      toast({ title: 'Invalid file type', description: 'Please upload a PNG or JPEG image.', variant: 'error' });
      return;
    }
    setUploadingKey(key);
    try {
      const url = await uploadFormImage.mutateAsync({ file, key: `merchant-${merchantId}-${key}` });
      setDraft((prev) => ({ ...prev, [key]: url }));
      toast({ title: 'Image uploaded', description: 'Remember to save the form design.' });
    } catch {
      toast({ title: 'Upload failed', variant: 'error' });
    } finally {
      setUploadingKey(null);
    }
  };

  const handleSave = async () => {
    // Empty strings mean "use the global setting" — strip them so the public
    // form's per-field fallback works.
    const cleaned = Object.fromEntries(
      Object.entries(draft).filter(([, v]) => typeof v === 'string' && v.trim() !== ''),
    ) as MerchantFormSettings;
    try {
      await updateMerchant.mutateAsync({
        id: merchantId,
        form_settings: Object.keys(cleaned).length > 0 ? cleaned : null,
      });
      toast({ title: 'Form design saved' });
    } catch (err: unknown) {
      toast({ title: 'Failed to save', description: (err as Error)?.message, variant: 'error' });
    }
  };

  const textField = (key: 'header_title' | 'header_subtitle' | 'footer_text', label: string, placeholder: string) => (
    <div>
      <Label>{label}</Label>
      <Input
        value={draft[key] ?? ''}
        onChange={(e) => setDraft((prev) => ({ ...prev, [key]: e.target.value }))}
        placeholder={placeholder}
      />
    </div>
  );

  const imageField = (key: 'header_image_url' | 'header_logo_url', label: string) => (
    <div>
      <Label>{label}</Label>
      <div className="mt-1 flex items-center gap-3">
        {draft[key] ? (
          <img src={draft[key]} alt="" className="h-12 rounded border object-contain" />
        ) : (
          <span className="text-xs text-muted-foreground">Using global image</span>
        )}
        <Button variant="outline" size="sm" asChild disabled={uploadingKey === key}>
          <label className="cursor-pointer">
            {uploadingKey === key ? 'Uploading…' : 'Upload'}
            <input type="file" accept="image/png,image/jpeg" className="hidden" onChange={(e) => handleUpload(key, e)} />
          </label>
        </Button>
        {draft[key] && (
          <Button variant="ghost" size="sm" onClick={() => setDraft((prev) => ({ ...prev, [key]: '' }))}>
            Reset to global
          </Button>
        )}
      </div>
    </div>
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle>Form Design</CardTitle>
        <CardDescription>
          Customise this partner's branch enquiry form. Empty fields fall back to the global form settings.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {imageField('header_image_url', 'Header banner image')}
        {imageField('header_logo_url', 'Form logo')}
        {textField('header_title', 'Header title', 'Car Insurance Enquiry — Gold Gift on Renewal')}
        {textField('header_subtitle', 'Header subtitle', 'Submit your details and our team will be in touch…')}
        {textField('footer_text', 'Footer text', '© RACC Agency. All rights reserved.')}
        <div className="flex justify-end">
          <Button onClick={handleSave} disabled={updateMerchant.isPending}>
            {updateMerchant.isPending ? 'Saving…' : 'Save form design'}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
```

Add the import: `import { useUploadFormImage } from '../../hooks/useCompanyAssets';`

Render it in `MerchantDetail`'s JSX between the "Portal Access" card and the "Branches" card:

```tsx
      {merchant && <FormDesignCard merchantId={merchantId} formSettings={merchant.form_settings ?? null} key={merchant.updated_at} />}
```

(`key={merchant.updated_at}` reseeds the draft after a save/refetch.)

- [ ] **Step 3: Master badge in MerchantList**

In `apps/admin-portal/src/pages/merchants/MerchantList.tsx`, find the table row rendering the merchant name and append a badge when `m.is_master` (adapt to the actual row variable name in the file):

```tsx
{m.is_master && <Badge className="ml-2">Master</Badge>}
```

Import `Badge` from `@agent-system/shared-ui` if not already imported.

- [ ] **Step 4: Verify**

Run: `pnpm -r typecheck`
Expected: exit 0.

- [ ] **Step 5: Commit**

```bash
git branch --show-current   # must print feat/partnership-round-5
git add apps/admin-portal/src/pages/merchants/MerchantDetail.tsx apps/admin-portal/src/pages/merchants/MerchantList.tsx
git commit -m "feat(admin): Master Partner toggle + per-partner Form Design in partner setup"
```

---

### Task 5: Public form — per-partner design + "Submitted via MERCHANT (branch)" chip

**Files:**
- Modify: `apps/public-pages/src/pages/Enquiry.tsx:66-72` (context type) and `:334-352` (header resolution)

**Interfaces:**
- Consumes: `get_enquiry_context` 6th column `merchant_form_settings` (Task 1); `MerchantFormSettings` type (Task 1).

- [ ] **Step 1: Extend the context type**

In `apps/public-pages/src/pages/Enquiry.tsx`, add `MerchantFormSettings` to the shared-types import:

```typescript
import { DEFAULT_ENQUIRY_FORM, type MerchantFormSettings } from '@agent-system/shared-types';
```

Extend `EnquiryContext` (line 66):

```typescript
interface EnquiryContext {
  kind: 'agent' | 'branch';
  agent_name: string | null;
  merchant_name: string | null;
  merchant_logo_url: string | null;
  branch_name: string | null;
  merchant_form_settings: MerchantFormSettings | null;
}
```

- [ ] **Step 2: Rewrite the header/footer resolution block**

Replace lines 334-352 (from the `// Header/footer + T&C copy:` comment through the `footerText` assignment) with:

```typescript
  // Header/footer + T&C copy resolution (Round 5 items 3 + 6):
  // per-merchant form_settings → admin-editable global Settings → shared
  // branding → hardcoded defaults. Branch forms no longer use a
  // merchant-specific title — the merchant identity renders as a small
  // "Submitted via …" line instead, matching the agent form.
  const merchantForm = context?.merchant_form_settings ?? null;
  const headerImageUrl = merchantForm?.header_image_url || formSettings?.header_image_url || null;
  const headerLogoUrl =
    merchantForm?.header_logo_url ||
    formBranding.logoUrl ||
    formSettings?.header_logo_url ||
    context?.merchant_logo_url ||
    null;
  const headerTitle =
    merchantForm?.header_title ??
    formSettings?.header_title ??
    'Car Insurance Enquiry — Gold Gift on Renewal';
  const headerSubtitle =
    merchantForm?.header_subtitle ??
    formSettings?.header_subtitle ??
    'Submit your details and our team will be in touch about your renewal and gold gift.';
  const overlayCopy =
    context?.kind === 'branch' && context.merchant_name
      ? `Submitted via ${context.merchant_name}${context.branch_name ? ` (${context.branch_name})` : ''}`
      : context?.kind === 'agent'
        ? `Submitted via ${context?.agent_name ?? ''}`
        : '';
  const footerText =
    merchantForm?.footer_text || formBranding.footerText || formSettings?.footer_text || DEFAULT_ENQUIRY_FORM.footer_text;
```

- [ ] **Step 3: Use the resolved header image**

At line ~365, the header image currently reads `formSettings?.header_image_url` twice — replace both with `headerImageUrl`:

```tsx
        {headerImageUrl && (
          <img
            src={headerImageUrl}
            alt=""
            className="w-full h-auto rounded-t-lg object-cover"
          />
        )}
```

The `overlayCopy` render at line ~384 stays as-is (`<p className="mt-1 text-xs text-muted-foreground">{overlayCopy}</p>`) — the same style the agent form already shows.

- [ ] **Step 4: Verify**

Run: `pnpm -r typecheck`
Expected: exit 0.

- [ ] **Step 5: Commit**

```bash
git branch --show-current   # must print feat/partnership-round-5
git add apps/public-pages/src/pages/Enquiry.tsx
git commit -m "feat(enquiry-form): per-partner design + 'Submitted via MERCHANT (branch)' chip"
```

---

### Task 6: Collision-proof event link card colors

**Files:**
- Modify: `packages/shared-ui/src/utils/cardGradient.ts` (add `assignCampaignGradients`)
- Modify: `packages/shared-ui/src/index.ts:140` (export)
- Modify: `apps/agent-portal/src/pages/MyLinks.tsx:388-395`, `apps/agent-portal/src/pages/AllLinks.tsx:180-187`, `apps/agent-portal/src/pages/PartnerLinks.tsx:374-381`

**Interfaces:**
- Produces: `assignCampaignGradients(campaigns: Array<{ id: string; card_template_overrides?: Partial<CardTemplate> | null } | null | undefined>, systemTemplate: CardTemplate): Map<string, [string, string]>`

- [ ] **Step 1: Add the assigner to cardGradient.ts**

Append to `packages/shared-ui/src/utils/cardGradient.ts`:

```typescript
/**
 * Round 5 item 5: assign every campaign in a rendered list a DISTINCT palette
 * gradient. The hash in campaignGradient() can collide (8 slots), which put
 * two different events on the same color. Campaigns whose gradient derives
 * from an explicit panelColor override keep it (admin's choice, collisions
 * intentional). Palette-derived campaigns probe forward (ids processed in
 * sorted order for determinism) to the next free slot; after 8 palette
 * campaigns the slots cycle.
 */
export function assignCampaignGradients(
  campaigns: Array<
    { id: string; card_template_overrides?: Partial<CardTemplate> | null } | null | undefined
  >,
  systemTemplate: CardTemplate,
): Map<string, [string, string]> {
  const unique = new Map<string, Partial<CardTemplate> | null | undefined>();
  for (const c of campaigns) {
    if (c?.id && !unique.has(c.id)) unique.set(c.id, c.card_template_overrides);
  }
  const result = new Map<string, [string, string]>();
  const usedSlots = new Set<number>();
  for (const id of Array.from(unique.keys()).sort()) {
    const resolved = resolveCardGradient(id, unique.get(id), systemTemplate);
    const paletteIdx = CARD_GRADIENTS.findIndex(([f, t]) => f === resolved[0] && t === resolved[1]);
    if (paletteIdx === -1) {
      result.set(id, resolved); // override-derived — keep as-is
      continue;
    }
    let idx = paletteIdx;
    if (usedSlots.size < CARD_GRADIENTS.length) {
      while (usedSlots.has(idx)) idx = (idx + 1) % CARD_GRADIENTS.length;
    }
    usedSlots.add(idx);
    result.set(id, CARD_GRADIENTS[idx]);
  }
  return result;
}
```

- [ ] **Step 2: Export it**

In `packages/shared-ui/src/index.ts` change line 140 to:

```typescript
export { resolveCardGradient, assignCampaignGradients } from './utils/cardGradient';
```

- [ ] **Step 3: Use it in the three link pages**

Each page has the identical pattern. In **`MyLinks.tsx`** add `assignCampaignGradients` to the `@agent-system/shared-ui` import, then directly before the `{activeLinks.map((link) => {` line (inside the "My Active Links" card, around line 389) the map callback computes the gradient — replace the whole computation with a lookup. Above the `return (` of the component (or immediately before the JSX using it), add:

```typescript
  const activeGradients = assignCampaignGradients(
    (activeLinks ?? []).map((l) => l.slot?.campaign),
    systemSettings?.card_template ?? DEFAULT_CARD_TEMPLATE,
  );
```

and inside the map replace:

```typescript
                  const [gradientFrom, gradientTo] = resolveCardGradient(
                    link.slot?.campaign?.id,
                    link.slot?.campaign?.card_template_overrides,
                    systemSettings?.card_template ?? DEFAULT_CARD_TEMPLATE,
                  );
```

with:

```typescript
                  const [gradientFrom, gradientTo] =
                    activeGradients.get(link.slot?.campaign?.id ?? '') ??
                    resolveCardGradient(
                      link.slot?.campaign?.id,
                      link.slot?.campaign?.card_template_overrides,
                      systemSettings?.card_template ?? DEFAULT_CARD_TEMPLATE,
                    );
```

Apply the SAME two edits in **`AllLinks.tsx`** (list variable is `sortedLinks` — use `(sortedLinks ?? []).map((l) => l.slot?.campaign)` and name the map `linkGradients`) and in **`PartnerLinks.tsx`** (list variable is `activeLinks`, same as MyLinks). Keep `resolveCardGradient` imported in all three (it's the fallback).

- [ ] **Step 4: Verify**

Run: `pnpm -r typecheck`
Expected: exit 0.

- [ ] **Step 5: Commit**

```bash
git branch --show-current   # must print feat/partnership-round-5
git add packages/shared-ui/src/utils/cardGradient.ts packages/shared-ui/src/index.ts apps/agent-portal/src/pages/MyLinks.tsx apps/agent-portal/src/pages/AllLinks.tsx apps/agent-portal/src/pages/PartnerLinks.tsx
git commit -m "fix(links): distinct card colors per event in a list (collision-free palette assignment)"
```

---

### Task 7: Branch Performance — date filter + sorting

**Files:**
- Modify: `apps/agent-portal/src/pages/BranchPerformance.tsx:47-54` (state/filtering) and `:113-139` (controls)

- [ ] **Step 1: Add state, filtering, sorting**

In `apps/agent-portal/src/pages/BranchPerformance.tsx` add `Input` to the `@agent-system/shared-ui` import. Replace lines 47-54 with:

```typescript
  const [branchFilter, setBranchFilter] = useState<string>('all');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [sortKey, setSortKey] = useState<'newest' | 'oldest' | 'staff' | 'branch'>('newest');
  const branchNames = Array.from(new Set((leads ?? []).map((l) => l.branch_name)));
  // Date range compares the yyyy-mm-dd prefix of the ISO timestamp; empty
  // bounds are unbounded. From > To simply matches nothing.
  const visibleLeads = (leads ?? [])
    .filter(
      (l) =>
        (branchFilter === 'all' || l.branch_name === branchFilter) &&
        (statusFilter === 'all' || l.vehicle_status === statusFilter) &&
        (!dateFrom || l.lead_created_at.slice(0, 10) >= dateFrom) &&
        (!dateTo || l.lead_created_at.slice(0, 10) <= dateTo),
    )
    .sort((a, b) => {
      switch (sortKey) {
        case 'oldest':
          return a.lead_created_at.localeCompare(b.lead_created_at);
        case 'staff':
          return (a.staff_id ?? '').localeCompare(b.staff_id ?? '') || b.lead_created_at.localeCompare(a.lead_created_at);
        case 'branch':
          return a.branch_name.localeCompare(b.branch_name) || b.lead_created_at.localeCompare(a.lead_created_at);
        default:
          return b.lead_created_at.localeCompare(a.lead_created_at);
      }
    });
```

- [ ] **Step 2: Add the controls**

Inside the Recent Leads `CardHeader` controls `<div className="flex flex-wrap items-center gap-2">`, add BEFORE the existing branch Select:

```tsx
            <Select value={sortKey} onValueChange={(v) => setSortKey(v as typeof sortKey)}>
              <SelectTrigger className="w-36 h-9 text-sm">
                <SelectValue placeholder="Sort" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="newest">Newest first</SelectItem>
                <SelectItem value="oldest">Oldest first</SelectItem>
                <SelectItem value="staff">Staff ID</SelectItem>
                <SelectItem value="branch">Branch</SelectItem>
              </SelectContent>
            </Select>
            <Input
              type="date"
              value={dateFrom}
              onChange={(e) => setDateFrom(e.target.value)}
              className="w-36 h-9 text-sm"
              aria-label="Submitted from"
            />
            <Input
              type="date"
              value={dateTo}
              onChange={(e) => setDateTo(e.target.value)}
              className="w-36 h-9 text-sm"
              aria-label="Submitted to"
            />
```

- [ ] **Step 3: Verify**

Run: `pnpm -r typecheck`
Expected: exit 0.

- [ ] **Step 4: Commit**

```bash
git branch --show-current   # must print feat/partnership-round-5
git add apps/agent-portal/src/pages/BranchPerformance.tsx
git commit -m "feat(merchant): Branch Performance leads get date range filter + sorting"
```

---

### Task 8: My Enquiries — date-of-submission filter

**Files:**
- Modify: `apps/agent-portal/src/pages/MyEnquiries.tsx:437-491` (state + filter) and `:515-569` (controls)

- [ ] **Step 1: Add state and filter**

In `MyEnquiries()` (add `Input` to the `@agent-system/shared-ui` import — check it isn't already imported), after the `statusFilter` state add:

```typescript
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
```

After `matchesStatus` add:

```typescript
  // Round 5 item 8.1: filter by submission date (yyyy-mm-dd prefix of the ISO
  // timestamp); empty bounds are unbounded.
  const matchesDate = (e: EnquiryWithDetails): boolean =>
    (!dateFrom || e.created_at.slice(0, 10) >= dateFrom) &&
    (!dateTo || e.created_at.slice(0, 10) <= dateTo);
```

Extend `visibleEnquiries`:

```typescript
  const visibleEnquiries = sortedEnquiries.filter(
    (e) =>
      (agentFilter === 'all' || e.agent?.id === agentFilter) &&
      matchesPartner(e) &&
      matchesStatus(e) &&
      matchesDate(e)
  );
```

- [ ] **Step 2: Add the date inputs**

In the header controls `<div className="flex flex-wrap items-center gap-2">`, immediately BEFORE the sort `<Select value={sortKey} …>`, add:

```tsx
          <Input
            type="date"
            value={dateFrom}
            onChange={(e) => setDateFrom(e.target.value)}
            className="w-36 h-9 text-sm"
            aria-label="Submitted from"
          />
          <Input
            type="date"
            value={dateTo}
            onChange={(e) => setDateTo(e.target.value)}
            className="w-36 h-9 text-sm"
            aria-label="Submitted to"
          />
```

- [ ] **Step 3: Verify**

Run: `pnpm -r typecheck`
Expected: exit 0.

- [ ] **Step 4: Commit**

```bash
git branch --show-current   # must print feat/partnership-round-5
git add apps/agent-portal/src/pages/MyEnquiries.tsx
git commit -m "feat(agent): My Enquiries date-of-submission range filter"
```

---

### Task 9: Unit Manager linked to a unit

**Files:**
- Modify: `apps/admin-portal/src/hooks/useAgents.ts:5-22` (list query), `:44-56` (CreateAgentInput)
- Modify: `apps/admin-portal/src/pages/agents/AgentForm.tsx`
- Modify: `supabase/functions/create-agent/index.ts:29-50` (payload) and `:106-121` (insert)

**Interfaces:**
- Consumes: `agents.parent_agent_id`, `agents.is_unit_manager` (existing columns); `get_unit_root()` RLS (existing).
- Produces: `CreateAgentInput.parent_agent_id?: string | null`; `create-agent` accepts optional `parent_agent_id` (must reference a top-level agent).

- [ ] **Step 1: Admin list keeps managers visible**

In `apps/admin-portal/src/hooks/useAgents.ts`, `useAgents()` currently hides any parented agent. Replace `.is('parent_agent_id', null)` with:

```typescript
        .or('parent_agent_id.is.null,is_unit_manager.eq.true')
```

(so unit-linked deputies still appear in the admin Agents list).

- [ ] **Step 2: Extend CreateAgentInput**

In the same file add to `CreateAgentInput`:

```typescript
  parent_agent_id?: string | null;
```

- [ ] **Step 3: AgentForm unit selector**

In `apps/admin-portal/src/pages/agents/AgentForm.tsx`:

Add to the zod schema after `is_unit_manager: z.boolean(),`:

```typescript
  parent_agent_id: z.string().optional(),
```

and wrap the schema with a refinement (replace `const agentSchema = z.object({ … });` closing with):

```typescript
}).superRefine((data, ctx) => {
  if (data.is_unit_manager && !data.parent_agent_id) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['parent_agent_id'],
      message: 'Select the unit this Unit Admin belongs to',
    });
  }
});
```

Add `useAgents` to the hooks import:

```typescript
import { CreateAgentError, useAgent, useAgents, useCreateAgent, useUpdateAgent } from '../../hooks/useAgents';
```

Inside `AgentForm()` add:

```typescript
  const { data: allUnits } = useAgents();
  // Only true top-level units can be a parent; exclude self when editing.
  const unitOptions = (allUnits ?? []).filter(
    (u) => u.parent_agent_id === null && u.id !== agentId,
  );
```

Add `parent_agent_id: ''` to `defaultValues` (after `is_unit_manager: false,`) and `parent_agent_id: agent.parent_agent_id ?? ''` to the `form.reset({...})` in the `useEffect`.

In `onSubmit`, normalize before sending — replace the two mutate calls:

```typescript
      const parentId = data.is_unit_manager ? data.parent_agent_id || null : null;
      if (isEditing && agentId) {
        const { password: _password, parent_agent_id: _p, ...updates } = data;
        await updateAgent.mutateAsync({ id: agentId, ...updates, parent_agent_id: parentId });
      } else {
        if (!data.password || data.password.length < 6) {
          form.setError('password', { message: 'Password must be at least 6 characters' });
          return;
        }
        await createAgent.mutateAsync({
          name: data.name,
          email: data.email,
          phone: data.phone,
          nric: data.nric,
          agent_code: data.agent_code,
          unit_name: data.unit_name,
          tier_id: data.tier_id,
          status: data.status,
          is_unit_manager: data.is_unit_manager,
          parent_agent_id: parentId,
          password: data.password,
        });
      }
```

Add the unit selector field to the JSX directly AFTER the `is_unit_manager` FormField block, conditionally rendered:

```tsx
              {form.watch('is_unit_manager') && (
                <FormField
                  control={form.control}
                  name="parent_agent_id"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Unit</FormLabel>
                      <Select
                        onValueChange={(v) => {
                          field.onChange(v);
                          // Deputy inherits the unit's name for reporting.
                          const unit = unitOptions.find((u) => u.id === v);
                          if (unit) form.setValue('unit_name', unit.unit_name);
                        }}
                        value={field.value ?? ''}
                      >
                        <FormControl>
                          <SelectTrigger>
                            <SelectValue placeholder="Select the unit this account belongs to" />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          {unitOptions.map((u) => (
                            <SelectItem key={u.id} value={u.id}>
                              {u.name} — {u.unit_name} ({u.agent_code})
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <FormDescription>
                        The Unit Admin sees this unit's data (same view as the unit owner).
                      </FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              )}
```

- [ ] **Step 4: create-agent edge function**

In `supabase/functions/create-agent/index.ts`:

Add `parent_agent_id,` to the destructured payload (after `is_unit_manager,`).

After the admin check (the `403` return) and BEFORE `supabase.auth.admin.createUser`, add:

```typescript
    // A Unit Admin (deputy) must hang off a real top-level unit; otherwise
    // get_unit_root() makes them their own empty unit and they see nothing.
    if (parent_agent_id) {
      const { data: parentRow, error: parentError } = await supabase
        .from("agents")
        .select("id, parent_agent_id")
        .eq("id", parent_agent_id)
        .single();
      if (parentError || !parentRow || parentRow.parent_agent_id !== null) {
        return new Response(
          JSON.stringify({ error: "parent_agent_id must reference a top-level unit" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
    }
```

In the `agents` insert, change `parent_agent_id: null,` to:

```typescript
        parent_agent_id: parent_agent_id ?? null,
```

- [ ] **Step 5: Verify**

Run: `pnpm -r typecheck`
Expected: exit 0. (Edge functions are Deno — not covered by typecheck; re-read your diff of `create-agent/index.ts` once for syntax.)

- [ ] **Step 6: Commit**

```bash
git branch --show-current   # must print feat/partnership-round-5
git add apps/admin-portal/src/hooks/useAgents.ts apps/admin-portal/src/pages/agents/AgentForm.tsx supabase/functions/create-agent/index.ts
git commit -m "fix(admin): Unit Admin accounts link to their unit (parent_agent_id) at create/edit"
```

---

### Task 10: Build gate, staging deploy, smoke tests, data fix, PR, prod

**Files:** none (operations task)

- [ ] **Step 1: Full build gate**

Run: `pnpm -r typecheck && pnpm build`
Expected: both exit 0.

- [ ] **Step 2: Apply migration to STAGING**

Supabase MCP `apply_migration` on project `lyjdlietzmmejrxjvwgp` with the exact content of `20260711000001_partner_master_scope.sql` (name `partner_master_scope`).

- [ ] **Step 3: Deploy create-agent to STAGING**

Supabase MCP `deploy_edge_function` for `create-agent` on `lyjdlietzmmejrxjvwgp` with the updated `index.ts`.

- [ ] **Step 4: Push branch, verify staging Render deploys**

```bash
git push -u origin feat/partnership-round-5
```

The three `racc-*-staging` Render services build from the staging branch config — if they track `feat/merchant-partnership`, sync it: `git push origin feat/partnership-round-5:feat/merchant-partnership --force-with-lease` (check `mcp__render__list_services` branch setting first). Wait for deploys live.

- [ ] **Step 5: Staging smoke tests**

1. Dropdown scope: as `agent@test.com`, My Enquiries Assign dropdown lists ONLY master-flagged merchants (+ own/linked). Un-flag a merchant in admin → it disappears.
2. RPC enforcement: with the agent's access token, `POST /rest/v1/rpc/assign_vehicle_merchant` with a non-master, non-owned merchant id → error P0008.
3. My Partners: standard agent sees master partners with Source=Master.
4. Branch form: open a branch link → generic title, "Submitted via {merchant} ({branch})" line; set merchant Form Design title/banner in admin → branch form shows them; clear → falls back to global.
5. Unit Admin: create a deputy with the new Unit selector → login sees unit-wide My Enquiries/Team Report.
6. Filters: date ranges + sorting on Branch Performance (merchant login) and My Enquiries.
7. Link colors: two campaigns that previously collided now render distinct card colors.

- [ ] **Step 6: STAGING data fix (orphaned manager)**

```sql
SELECT id, name, email, unit_name FROM agents WHERE is_unit_manager AND parent_agent_id IS NULL;
```

For each row the client created as a "Manager", link it (confirm the intended unit with the user if ambiguous):

```sql
UPDATE agents
   SET parent_agent_id = '<unit-admin-agent-id>',
       unit_name = (SELECT unit_name FROM agents WHERE id = '<unit-admin-agent-id>')
 WHERE id = '<manager-agent-id>';
```

- [ ] **Step 7: PR to main**

```bash
gh pr create --base main --head feat/partnership-round-5 --title "feat: partnership feedback round 5" --body "..."
```

Body summarises items A–K from the spec. Merge after review.

- [ ] **Step 8: PROD deploy**

1. MCP `apply_migration` on `mjtdsevynrtcmafsnxsj` (same SQL, name `partner_master_scope`).
2. MCP `deploy_edge_function` `create-agent` on prod.
3. Verify Render prod services auto-deployed the merge commit (`mcp__render__list_deploys`).
4. Run the Step 6 data-fix queries on prod.
5. Re-run smoke tests 1, 4 on prod URLs.

- [ ] **Step 9: Update project memory + client reply notes**

Write `partnership-feedback-round-5.md` memory (what shipped, is_master semantics, form_settings pipeline) and draft the client reply covering: items already working (Get Quote, per-quotation confirm, IC 1-month window rationale), the Event Partners explanation, and the new behaviours.
