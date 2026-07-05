# Partnership Round 4 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the 10 items from "Feedback Changes - 5 Jul.pdf" per the approved spec `docs/superpowers/specs/2026-07-06-partnership-round-4-design.md`.

**Architecture:** pnpm monorepo — apps/{admin-portal,agent-portal,public-pages} (React 18 + Vite + TanStack Router/Query), packages/{shared-types,shared-ui}, supabase/ (Postgres migrations + Deno edge functions). RLS-first authz; RPCs (SECURITY DEFINER) for cross-role writes.

**Tech Stack:** React 18, TypeScript, Tailwind, shadcn/ui via shared-ui, Supabase (RLS/RPC/storage/edge fns), Resend email.

## Global Constraints

- **No test runner exists.** Verification per task = `pnpm -r typecheck` (and `pnpm build` in the final verify task). Do not add test frameworks.
- **Branch guard:** every commit must land on `feat/partnership-round-4`. Run `git branch --show-current` before each commit.
- Migrations are FILES ONLY during implementation (numbered `202607060000NN_*.sql`); they are applied to staging/prod later via MCP `apply_migration` (NEVER `supabase db push`).
- Follow existing file conventions: hooks in `src/hooks/`, pages in `src/pages/`, comments explain constraints only.
- Merchant "master" = `merchants.created_by_agent_id IS NULL`.
- Timezone: any server-side date formatting uses `Asia/Singapore`.
- Shared supabase client only (`@agent-system/shared-ui` re-export / app `lib/supabase`); never `createClient` in app code.

---

### Task 1: Database migrations + shared types

**Files:**
- Create: `supabase/migrations/20260706000001_partner_scope_unit_actions.sql`
- Create: `supabase/migrations/20260706000002_agent_attachment_write.sql`
- Create: `supabase/migrations/20260706000003_form_branding_event_logo.sql`
- Create: `supabase/migrations/20260706000004_enquiry_form_images.sql`
- Create: `supabase/migrations/20260706000005_merchant_portal.sql`
- Create: `supabase/migrations/20260706000006_enquiry_staff_id.sql`
- Modify: `packages/shared-types/src/database.ts` (Merchant: `user_id`, `portal_email`; Enquiry: `staff_id`; system settings types if present)

**Interfaces produced:** RPCs `assign_vehicle_merchant(p_vehicle_id uuid, p_merchant_id uuid)` (behavior change), `merchant_branch_stats()`, `submit_enquiry(..., p_staff_id text DEFAULT NULL)`.

- [ ] **Step 1: Write migration 1 — partner scoping + unit-viewer actions (PDF items 1, 10b)**

```sql
-- Round 4 item 1: an agent may only assign MASTER partners (created_by_agent_id
-- IS NULL) or partners they proposed themselves. Round 4 item 10b: unit viewers
-- (unit admin/boss + is_unit_manager deputies) may act on any unit member's
-- enquiry, not just their own.
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
  IF NOT EXISTS (
    SELECT 1 FROM merchants
    WHERE id = p_merchant_id AND status = 'active'
      AND (created_by_agent_id IS NULL OR created_by_agent_id = v_agent_id)
  ) THEN
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
```

- [ ] **Step 2: Write migration 2 — agent attachment write (PDF item 4)**

```sql
-- Round 4 item 4: agents can amend files on their customers' enquiries —
-- upload new + delete old. Unit viewers get the same on unit members' rows
-- (item 10b). Public-form inserts still go through submit_enquiry (definer).
DROP POLICY IF EXISTS "Agent writes own enquiry_attachments" ON enquiry_attachments;
CREATE POLICY "Agent writes own enquiry_attachments"
  ON enquiry_attachments FOR INSERT TO authenticated
  WITH CHECK (EXISTS (
    SELECT 1 FROM enquiries e
    WHERE e.id = enquiry_attachments.enquiry_id
      AND (e.agent_id = get_agent_id() OR e.agent_id IN (SELECT unit_member_ids()))
  ));

DROP POLICY IF EXISTS "Agent deletes own enquiry_attachments" ON enquiry_attachments;
CREATE POLICY "Agent deletes own enquiry_attachments"
  ON enquiry_attachments FOR DELETE TO authenticated
  USING (EXISTS (
    SELECT 1 FROM enquiries e
    WHERE e.id = enquiry_attachments.enquiry_id
      AND (e.agent_id = get_agent_id() OR e.agent_id IN (SELECT unit_member_ids()))
  ));

-- Storage: agents may remove objects backing attachments they may delete.
-- (INSERT to the bucket is already open to authenticated at 20260629000030.)
DROP POLICY IF EXISTS "enquiry-attachments agent delete own" ON storage.objects;
CREATE POLICY "enquiry-attachments agent delete own"
  ON storage.objects FOR DELETE TO authenticated
  USING (
    bucket_id = 'enquiry-attachments'
    AND EXISTS (
      SELECT 1 FROM enquiry_attachments ea
      JOIN enquiries e ON e.id = ea.enquiry_id
      WHERE ea.storage_path = storage.objects.name
        AND (e.agent_id = get_agent_id() OR e.agent_id IN (SELECT unit_member_ids()))
    )
  );

-- Unit viewers must also be able to READ unit attachments' objects (View button)
-- — already granted by 20260703000002_unit_enquiries_rls.sql.
```

- [ ] **Step 3: Write migration 3 — event logo key (PDF item 5)**

```sql
-- Round 4 item 5: event forms (register/checkout/display) get their OWN logo,
-- separate from the partnership enquiry logo. Empty string means "use the
-- built-in RACC logo" on the event forms.
UPDATE system_settings
SET form_branding = COALESCE(form_branding, '{}'::jsonb)
  || jsonb_build_object('event_logo_url', COALESCE(form_branding->>'event_logo_url', ''));
COMMENT ON COLUMN system_settings.form_branding IS
  'Public-form branding: logo_url + footer_text apply to the partnership enquiry form; event_logo_url applies to event forms (register/checkout/display), blank = built-in RACC logo.';
```

- [ ] **Step 4: Write migration 4 — enquiry form header/footer images (PDF item 6)**

```sql
-- Round 4 item 6: designer-supplied photo header/footer on the public enquiry
-- form. Recommended dimensions: header 1600x400 (4:1), footer 1600x200 (8:1).
UPDATE system_settings
SET enquiry_form = COALESCE(enquiry_form, '{}'::jsonb)
  || jsonb_build_object(
       'header_image_url', COALESCE(enquiry_form->>'header_image_url', ''),
       'footer_image_url', COALESCE(enquiry_form->>'footer_image_url', ''));
```

- [ ] **Step 5: Write migration 5 — merchant portal (PDF item 7a)**

```sql
-- Round 4 item 7a: Master Partner (merchant) read-only portal access.
ALTER TABLE merchants ADD COLUMN IF NOT EXISTS user_id uuid UNIQUE REFERENCES auth.users(id) ON DELETE SET NULL;
ALTER TABLE merchants ADD COLUMN IF NOT EXISTS portal_email text;

-- The linked merchant user may read their own merchant row (auth resolution).
DROP POLICY IF EXISTS "Merchant user reads own merchant" ON merchants;
CREATE POLICY "Merchant user reads own merchant"
  ON merchants FOR SELECT TO authenticated
  USING (user_id = auth.uid());

-- Branch performance counts for the logged-in merchant user. Counts ONLY leads
-- submitted through branch links (branch_link_id set) — agent-assigned
-- partnership leads are excluded by design. No customer PII returned.
CREATE OR REPLACE FUNCTION merchant_branch_stats()
RETURNS TABLE (
  branch_id uuid,
  branch_name text,
  branch_status merchant_status,
  total_leads bigint,
  leads_this_month bigint,
  last_lead_at timestamptz
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT b.id, b.name, b.status,
    count(e.id) FILTER (WHERE e.branch_link_id IS NOT NULL),
    count(e.id) FILTER (
      WHERE e.branch_link_id IS NOT NULL
        AND e.created_at >= (date_trunc('month', now() AT TIME ZONE 'Asia/Singapore') AT TIME ZONE 'Asia/Singapore')),
    max(e.created_at) FILTER (WHERE e.branch_link_id IS NOT NULL)
  FROM merchant_branches b
  JOIN merchants m ON m.id = b.merchant_id
  LEFT JOIN enquiries e ON e.merchant_branch_id = b.id
  WHERE m.user_id = auth.uid()
  GROUP BY b.id, b.name, b.status
  ORDER BY b.name;
$$;
GRANT EXECUTE ON FUNCTION merchant_branch_stats() TO authenticated;
```

- [ ] **Step 6: Write migration 6 — staff ID (PDF item 7b)**

```sql
-- Round 4 item 7b: branch (master-partner) enquiry forms capture the referring
-- STAFF ID. Optional; only shown on branch links.
ALTER TABLE enquiries ADD COLUMN IF NOT EXISTS staff_id text;
```

Then recreate `submit_enquiry` with the extra parameter. **Copy the ENTIRE current function body from `supabase/migrations/20260629000030_enquiry_attachments.sql:74-137`** (it is the latest definition; `20260630000003` predates it — verify with `grep -l "FUNCTION submit_enquiry" supabase/migrations/*.sql` and use the newest) with exactly these three edits:

```sql
DROP FUNCTION IF EXISTS submit_enquiry(text,text,text,text,text,jsonb);
CREATE OR REPLACE FUNCTION submit_enquiry(
  p_link_code text, p_customer_name text, p_customer_nric text,
  p_customer_phone text, p_customer_email text, p_vehicles jsonb,
  p_staff_id text DEFAULT NULL) RETURNS uuid AS $$
-- ... identical body, except the enquiries INSERT gains staff_id:
--   INSERT INTO enquiries (branch_link_id, ..., status, assigned_at, assigned_by, staff_id)
--   VALUES (..., NULLIF(trim(coalesce(p_staff_id,'')),''))
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions, net, vault;
GRANT EXECUTE ON FUNCTION submit_enquiry(text,text,text,text,text,jsonb,text) TO anon;
```

- [ ] **Step 7: shared-types** — in `packages/shared-types/src/database.ts` add to `Merchant`: `user_id: string | null; portal_email: string | null;` and to `Enquiry`: `staff_id: string | null;` (match existing style/nullability).

- [ ] **Step 8:** `pnpm -r typecheck` → PASS. Commit: `git add supabase/migrations packages/shared-types && git commit -m "feat(db): round-4 migrations — partner scope, attachment write, branding split, form images, merchant portal, staff id"`

---

### Task 2: Agent portal — partner dropdown scope + unit-viewer actions (items 1, 10b)

**Files:**
- Modify: `apps/agent-portal/src/pages/MyEnquiries.tsx`
- Modify: `apps/agent-portal/src/components/Layout.tsx`

**Interfaces consumed:** hardened `assign_vehicle_merchant` (Task 1).

- [ ] **Step 1:** In `MyEnquiries.tsx:323` scope the dropdown:

```ts
const activeMerchants =
  merchants?.filter(
    (m) =>
      m.status === MerchantStatus.ACTIVE &&
      (m.created_by_agent_id === null || m.created_by_agent_id === agent?.id),
  ) ?? [];
```

- [ ] **Step 2:** Unit viewers can act on unit rows: at `MyEnquiries.tsx:425` change `readOnly={isUnitViewer && enq.agent_id !== agent?.id}` to `readOnly={false}` and delete the now-unused prop wiring **only if** nothing else uses it — keep the `readOnly` prop on `EnquiryCard` (still used to guard rendering) but pass `false`. Also change the Propose Partnership gate at `:362` and `:393` from `role === 'agent_admin'` to `isUnitViewer`.

- [ ] **Step 3:** `Layout.tsx` — deputy manage powers + labels (item 10b):
  - `buildAgentGroups` (`:24-35`): show **My Agents** and the partners page when `isUnitViewer` (not only `agent_admin`); rename nav label `'Partners'` → `'Event Partners'` (item 8, href stays `/partners`).
  - Header subtitle (`:95-99`): deputy label — replace the agent branch with:

```ts
: role === 'agent_admin'
  ? 'Unit Manager'
  : agent?.is_unit_manager
    ? 'Unit Admin'
    : agent?.tier?.name ?? 'No Tier';
```

  (`is_unit_manager` is already on the `agents` row returned by `useAuth`; extend the `AgentWithTier` type if it lacks the field.)

- [ ] **Step 4:** Check `apps/agent-portal/src/pages/Partners.tsx` and `MyAgents.tsx` for internal `role === 'agent_admin'` guards (Partners.tsx:58 has one) — change to `isUnitViewer`. Update the page heading "Partners" → "Event Partners".

- [ ] **Step 5:** `pnpm -r typecheck` → PASS. Commit: `feat(agent): scope assign-partner to master+own; unit viewers get manage powers`

---

### Task 3: Agent portal — upload/delete enquiry files (item 4)

**Files:**
- Modify: `apps/agent-portal/src/hooks/useEnquiryAttachments.ts`
- Modify: `apps/agent-portal/src/pages/MyEnquiries.tsx`

- [ ] **Step 1:** Add mutations to `useEnquiryAttachments.ts`:

```ts
import { useMutation, useQueryClient } from '@tanstack/react-query';

const ALLOWED_TYPES = ['image/jpeg','image/png','image/webp','image/heic','image/heif','application/pdf'];
const MAX_BYTES = 10 * 1024 * 1024;

export function useUploadAttachment(enquiryId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ vehicleId, file }: { vehicleId: string; file: File }) => {
      if (!ALLOWED_TYPES.includes(file.type)) throw new Error('Only images or PDF files are allowed');
      if (file.size > MAX_BYTES) throw new Error('File must be 10MB or smaller');
      const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
      const path = `${enquiryId}/${crypto.randomUUID()}-${safeName}`;
      const { error: upErr } = await supabase.storage
        .from('enquiry-attachments')
        .upload(path, file, { contentType: file.type, upsert: false });
      if (upErr) throw upErr;
      const { error } = await supabase.from('enquiry_attachments').insert({
        enquiry_id: enquiryId,
        enquiry_vehicle_id: vehicleId,
        storage_path: path,
        file_name: file.name,
        content_type: file.type,
        size_bytes: file.size,
      });
      if (error) throw error;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['enquiry-attachments', enquiryId] }),
  });
}

export function useDeleteAttachment(enquiryId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (att: { id: string; storage_path: string }) => {
      const { error } = await supabase.from('enquiry_attachments').delete().eq('id', att.id);
      if (error) throw error;
      // Best effort: DB row is the source of truth; a stray object is harmless.
      await supabase.storage.from('enquiry-attachments').remove([att.storage_path]);
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['enquiry-attachments', enquiryId] }),
  });
}
```

- [ ] **Step 2:** In `EnquiryCard` (MyEnquiries.tsx): per vehicle, next to the Get Quote cell area's attachment row (the `vehicleAttachments` block at `:234-259`), when `!readOnly`:
  - an **Upload** ghost button (Paperclip/Upload icon) triggering a hidden `<input type="file" accept="image/*,application/pdf">`, calling `useUploadAttachment(enq.id).mutateAsync({ vehicleId: v.id, file })` with success/error toasts. Render this row even when `vehicleAttachments.length === 0` so upload is reachable.
  - a small **×** button on each attachment chip calling `useDeleteAttachment(enq.id)` (with `window.confirm('Remove this file?')` guard — match existing minimal-dialog style if a confirm pattern exists).

- [ ] **Step 3:** `pnpm -r typecheck` → PASS. Commit: `feat(agent): upload/delete enquiry vehicle files (amend documents)`

---

### Task 4: Agent portal — filters + sort dropdown + unit default sort (items 3, 10a)

**Files:**
- Modify: `apps/agent-portal/src/pages/myEnquiriesSort.ts`
- Modify: `apps/agent-portal/src/pages/MyEnquiries.tsx`

- [ ] **Step 1:** Extend `myEnquiriesSort.ts`:

```ts
export type EnquirySortKey = 'default' | 'received' | 'expiry' | 'status' | 'partner' | 'customer';

// Unit view default: Agent -> (then the standard default keys).
export function compareUnitEnquiries(a: EnquiryWithDetails, b: EnquiryWithDetails): number {
  const agent = (a.agent?.name ?? NAME_LAST).localeCompare(b.agent?.name ?? NAME_LAST);
  if (agent !== 0) return agent;
  return compareMyEnquiries(a, b);
}

export function compareByKey(key: EnquirySortKey, isUnitView: boolean) {
  return (a: EnquiryWithDetails, b: EnquiryWithDetails): number => {
    switch (key) {
      case 'received': return (b.created_at ?? '').localeCompare(a.created_at ?? '');
      case 'expiry':   return earliestExpiry(a.vehicles).localeCompare(earliestExpiry(b.vehicles));
      case 'status':   return statusRank(a.status) - statusRank(b.status) || compareMyEnquiries(a, b);
      case 'partner':  return compareMyEnquiries(a, b); // partner is already the leading default key
      case 'customer': return (a.customer_name ?? '').localeCompare(b.customer_name ?? '');
      default:         return isUnitView ? compareUnitEnquiries(a, b) : compareMyEnquiries(a, b);
    }
  };
}
```

(`statusRank` must be exported.)

- [ ] **Step 2:** `MyEnquiries.tsx` — add state `sortKey` (default `'default'`), `partnerFilter` (`'all' | 'unassigned' | merchantId`), `statusFilter` (`'all' | 'open' | 'closed'`). Replace line 326 with `const sortedEnquiries = [...(enquiries ?? [])].sort(compareByKey(sortKey, isUnitViewer));` and extend `visibleEnquiries` filtering: partner matches `e.merchant?.id` or any `v.merchant?.id` (unassigned = none of them set); status compares `e.status`. Render three compact `Select`s in the header row (Sort / Partner / Status) alongside the existing Agent filter — partner options built from the loaded enquiries' merchant names (id→name Map, like `agentOptions`).

- [ ] **Step 3:** `pnpm -r typecheck` → PASS. Commit: `feat(agent): enquiry sort options + partner/status filters; unit default sort agent-first`

---

### Task 5: Agent portal — My Partners page (item 8)

**Files:**
- Create: `apps/agent-portal/src/pages/MyPartners.tsx`
- Modify: `apps/agent-portal/src/components/Layout.tsx` (Partnership group)
- Modify: agent-portal router (find with `grep -r "my-enquiries" apps/agent-portal/src --include='*.tsx' -l` — the routes file registering `/my-enquiries`; add `/my-partners` the same way)

- [ ] **Step 1:** New page:

```tsx
import { useState } from 'react';
import {
  Card, CardContent, CardDescription, CardHeader, CardTitle,
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
  Badge, Button, getStatusVariant, TableSkeleton,
} from '@agent-system/shared-ui';
import { format, parseISO } from 'date-fns';
import { Plus, Store } from 'lucide-react';
import { useAuth } from '../hooks/useAuth';
import { useAgentMerchants } from '../hooks/useAgentMerchants';
import { ProposePartnerDialog } from '../components/ProposePartnerDialog';

// Round 4 item 8: partnership merchants the agent proposed, with status —
// distinct from event-recruitment "Event Partners".
export function MyPartners() {
  const { agent, isUnitViewer } = useAuth();
  const { data: merchants, isLoading } = useAgentMerchants();
  const [proposeOpen, setProposeOpen] = useState(false);

  const myMerchants = (merchants ?? []).filter((m) => m.created_by_agent_id === agent?.id);

  return (
    <div className="flex flex-col gap-4 animate-fade-in">
      <div className="flex flex-row items-start justify-between gap-2">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">My Partners</h1>
          <p className="text-sm text-muted-foreground">
            Partnership merchants you proposed and their approval status
          </p>
        </div>
        {isUnitViewer && (
          <Button variant="outline" size="sm" onClick={() => setProposeOpen(true)}>
            <Plus className="size-4 mr-2" />
            Propose Partnership
          </Button>
        )}
      </div>
      {isUnitViewer && agent?.id && (
        <ProposePartnerDialog agentId={agent.id} open={proposeOpen} onOpenChange={setProposeOpen} />
      )}
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Store className="size-4" /> Proposed Partners
          </CardTitle>
          <CardDescription>{myMerchants.length} partners</CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <TableSkeleton rows={3} columns={5} />
          ) : myMerchants.length === 0 ? (
            <p className="py-6 text-center text-muted-foreground">
              You haven't proposed any partners yet.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Contact</TableHead>
                  <TableHead>Branches</TableHead>
                  <TableHead>Proposed</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {myMerchants.map((m) => (
                  <TableRow key={m.id}>
                    <TableCell className="font-medium">{m.name}</TableCell>
                    <TableCell className="text-muted-foreground">
                      {m.contact_person ?? '—'}{m.contact_phone ? ` · ${m.contact_phone}` : ''}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {m.branches.map((b) => b.name).join(', ') || '—'}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {format(parseISO(m.created_at), 'd MMM yyyy')}
                    </TableCell>
                    <TableCell>
                      <Badge variant={getStatusVariant(m.status)} className="capitalize">{m.status}</Badge>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
```

- [ ] **Step 2:** Layout Partnership group gains `{ name: 'My Partners', href: '/my-partners', icon: Store }` (import `Store` from lucide) between "My Enquiries" and nothing else — visible to all agent roles. Register the route in the router file following the `/my-enquiries` pattern exactly.

- [ ] **Step 3:** `pnpm -r typecheck` → PASS. Commit: `feat(agent): My Partners page; separate from Event Partners`

---

### Task 6: Distinct event link card colors (item 9)

**Files:**
- Modify: `packages/shared-ui/src/components/ui/invitation-card.tsx`
- Modify: `apps/agent-portal/src/pages/MyLinks.tsx`

- [ ] **Step 1:** `invitation-card.tsx` — add props and use them at line 87:

```ts
/** Left-panel gradient override — defaults preserve the classic navy card. */
gradientFrom?: string;
gradientTo?: string;
```
```tsx
style={{ background: `linear-gradient(135deg, ${gradientFrom ?? '#0F172A'}, ${gradientTo ?? '#0369A1'})` }}
```

- [ ] **Step 2:** `MyLinks.tsx` — add a module-level helper above the component:

```ts
// Item 9 (round 4): visually distinguish different events' link cards. If the
// campaign has card template color overrides use those (matches the printed
// card); otherwise pick deterministically from a curated palette by campaign id.
const CARD_GRADIENTS: [string, string][] = [
  ['#0F172A', '#0369A1'], ['#7C2D12', '#EA580C'], ['#14532D', '#16A34A'],
  ['#581C87', '#9333EA'], ['#831843', '#DB2777'], ['#713F12', '#CA8A04'],
  ['#134E4A', '#0D9488'], ['#312E81', '#4F46E5'],
];
function campaignGradient(campaignId: string | undefined): [string, string] {
  if (!campaignId) return CARD_GRADIENTS[0];
  let h = 0;
  for (let i = 0; i < campaignId.length; i++) h = (h * 31 + campaignId.charCodeAt(i)) >>> 0;
  return CARD_GRADIENTS[h % CARD_GRADIENTS.length];
}
```

In the "My Active Links" render (`:387-462`), compute per link: check `link.slot?.campaign?.card_template_overrides` — read the effective template via the already-imported `getEffectiveTemplate(...)` (used at `:142-149`); if the overrides object exists and yields distinct colors, pass those (template's primary/background color fields — inspect `DEFAULT_CARD_TEMPLATE` type for exact names, e.g. `template.colors.primary`), else `campaignGradient(link.slot?.campaign?.id)`. Pass as `gradientFrom`/`gradientTo` to `<InvitationCard>`. Apply the same to any other on-screen `InvitationCard` usages found via `grep -rn "InvitationCard" apps/agent-portal/src` that render campaign links.

- [ ] **Step 3:** `pnpm -r typecheck` → PASS. Commit: `feat(links): per-event card colors (template override or deterministic palette)`

---

### Task 7: Split event vs partnership form logos (item 5)

**Files:**
- Modify: `apps/public-pages/src/hooks/useFormBranding.ts`
- Modify: `apps/public-pages/src/pages/Register.tsx` (logo at `:272-276`)
- Modify: `apps/public-pages/src/pages/CheckOut.tsx` (logos at `:470-474`, `:581-585`)
- Modify: `apps/public-pages/src/pages/Display.tsx` (logo at `:188-190`)
- Modify: `apps/admin-portal/src/pages/Settings.tsx` (FormBrandingCard `:379-443`)
- Modify: `apps/admin-portal/src/hooks/useSystemSettings.ts` (form_branding type if typed)

- [ ] **Step 1:** `useFormBranding.ts` — add `event_logo_url: string` to the interface + default (`''`), return `eventLogoUrl`.

- [ ] **Step 2:** In Register/CheckOut/Display replace `logoUrl` with `eventLogoUrl` in the destructure and img renders. The existing fallback (`<Logo .../>` when blank) already yields the built-in RACC logo — keep it. **Do not touch Enquiry.tsx logo precedence.**

- [ ] **Step 3:** Admin `FormBrandingCard`: add an "Event Forms Logo URL" input bound to `event_logo_url` (blank = built-in RACC logo — say so in the helper text), relabel the existing field "Partnership Form Logo URL". Persist both keys in the save handler alongside `logo_url`/`footer_text`.

- [ ] **Step 4:** `pnpm -r typecheck` → PASS. Commit: `fix(branding): event forms use dedicated logo (RACC), partnership keeps A-Z`

---

### Task 8: Photo header/footer on enquiry form (item 6)

**Files:**
- Modify: `apps/admin-portal/src/pages/Settings.tsx` (EnquiryFormSettingsCard `:264-377`)
- Modify: `apps/admin-portal/src/hooks/useCompanyAssets.ts` (or add a small generic upload hook beside it)
- Modify: `apps/public-pages/src/pages/Enquiry.tsx`
- Modify: `apps/public-pages/src/hooks/useEnquiryFormSettings.ts` (add the two fields to its type/defaults)

- [ ] **Step 1:** Generalize upload: add to `useCompanyAssets.ts` a `useUploadFormImage()` mutation mirroring `useUploadLogo` but taking `{ file, key }` and uploading to `company-assets` at `form-images/${key}-${Date.now()}.${ext}` (PNG/JPEG, ≤2MB), returning the public URL (same `getPublicUrl` pattern as the logo hook).

- [ ] **Step 2:** `EnquiryFormSettingsCard`: two new labeled rows — "Header Image" and "Footer Image" — each with: current image thumbnail (when set), an Upload button (hidden file input) calling `useUploadFormImage` then setting `header_image_url`/`footer_image_url` in the card's draft state, and a Remove button clearing it. Helper text: `Recommended 1600×400 (header) / 1600×200 (footer), PNG or JPEG, max 2MB.` Persist both keys with the existing save handler.

- [ ] **Step 3:** `Enquiry.tsx`: where the header block renders (title/subtitle around the `headerLogoUrl` usage at `:326`), render first:

```tsx
{formSettings?.header_image_url && (
  <img src={formSettings.header_image_url} alt="" className="w-full h-auto rounded-t-xl object-cover" />
)}
```

and above the footer text at the bottom of the form:

```tsx
{formSettings?.footer_image_url && (
  <img src={formSettings.footer_image_url} alt="" className="w-full h-auto object-cover" />
)}
```

Match the form container's existing rounding/spacing.

- [ ] **Step 4:** `pnpm -r typecheck` → PASS. Commit: `feat(enquiry-form): admin-uploadable photo header/footer`

---

### Task 9: Staff ID on branch enquiry form (item 7b)

**Files:**
- Modify: `apps/public-pages/src/pages/Enquiry.tsx`
- Modify: `apps/admin-portal/src/pages/enquiries/EnquiryList.tsx`
- Modify: `apps/admin-portal/src/pages/enquiries/enquirySort.ts` (`toEnquiryExportRows` `:33-65`)
- Modify: `packages/shared-ui` export types **only if** `EnquiryExportRow` lives there (it does — extend with optional `staffId?: string` and append a "Staff ID" column in `buildEnquiriesWorkbook`)

- [ ] **Step 1:** `Enquiry.tsx` — add `staff_id` to form state; render below the customer fields **only when** `context?.kind === 'branch'`:

```tsx
<div>
  <Label htmlFor="staff_id">Staff ID</Label>
  <Input id="staff_id" value={form.staff_id}
    onChange={(e) => setForm((f) => ({ ...f, staff_id: e.target.value }))}
    placeholder="Referring staff ID (optional)" />
</div>
```

(match the page's existing field markup — copy an adjacent field's exact structure). Pass `p_staff_id: form.staff_id.trim() || null` in the `submit_enquiry` RPC call.

- [ ] **Step 2:** Admin `EnquiryList.tsx`: in the expanded/customer cell, append `· Staff ID: {e.staff_id}` when present; `toEnquiryExportRows`: add `staffId: e.staff_id ?? ''` and extend the workbook builder's column list with `Staff ID`. Ensure the agent-portal `toEnquiryExportRows` (MyEnquiries.tsx:275-312) still typechecks — if `staffId` is optional it needs no change.

- [ ] **Step 3:** `pnpm -r typecheck` → PASS. Commit: `feat(enquiry): staff ID field on branch forms; shown in admin + report`

---

### Task 10: Merchant portal — login + Branch Performance (item 7a)

**Files:**
- Create: `supabase/functions/create-merchant-user/index.ts`
- Modify: `apps/admin-portal/src/pages/merchants/MerchantDetail.tsx`
- Create: `apps/admin-portal/src/hooks/useMerchantUser.ts`
- Modify: `apps/agent-portal/src/hooks/useAuth.ts`
- Modify: `apps/agent-portal/src/components/Layout.tsx`
- Create: `apps/agent-portal/src/pages/BranchPerformance.tsx`
- Modify: agent-portal router (+ Dashboard redirect for merchant role)

- [ ] **Step 1:** Edge function — follow `create-partner`'s structure but **admin-only** (check `app_metadata.role === 'admin'` on the caller as in `send-quote-request:158`). Actions:

```ts
// POST { action: 'create', merchant_id, email, password } ->
//   auth.admin.createUser({ email, password, email_confirm: true, app_metadata: { role: 'merchant' } })
//   then UPDATE merchants SET user_id = <new id>, portal_email = email WHERE id = merchant_id (service client);
//   on merchant-update failure delete the orphaned auth user (cleanup like create-partner:103).
// POST { action: 'revoke', merchant_id } ->
//   read merchants.user_id; auth.admin.deleteUser(user_id); UPDATE merchants SET user_id = NULL, portal_email = NULL.
```

Password min 6 chars; 409 on "already registered"; CORS headers identical to create-partner.

- [ ] **Step 2:** `useMerchantUser.ts` (admin portal):

```ts
export function useCreateMerchantUser() { /* supabase.functions.invoke('create-merchant-user', { body: { action:'create', merchant_id, email, password } }) + invalidate ['merchant', id] */ }
export function useRevokeMerchantUser() { /* action:'revoke' variant */ }
```

Match the mutation/invalidation style of the existing merchant hooks in `apps/admin-portal/src/hooks/` (find with `grep -rn "approve_merchant\|useMerchant" apps/admin-portal/src/hooks`).

- [ ] **Step 3:** `MerchantDetail.tsx`: new "Portal Access" card under Partnership Details — if `merchant.portal_email`: show the email + "Revoke access" (confirm) button; else: email + password inputs + "Create login" button. Toast results.

- [ ] **Step 4:** Agent portal `useAuth.ts`: extend `AuthState` with `merchant: Merchant | null` and role union `'merchant'`. In `fetchUserRole`, after the partner lookup fails, try:

```ts
const { data: merchantData } = await supabase
  .from('merchants').select('*').eq('user_id', userId).maybeSingle();
if (merchantData) {
  setState(prev => ({ ...prev, agent: null, partner: null,
    merchant: merchantData as Merchant, role: 'merchant', isUnitViewer: false, isLoading: false }));
  return;
}
```

(also reset `merchant: null` in the sign-out branch and the not-linked fallback).

- [ ] **Step 5:** `Layout.tsx`: `merchantGroups` nav = Branch Performance (`/branch-performance`, `BarChart3` icon) + Account; sidebar title `'RACC Partner'` branch reused; header `displayName = merchant?.name`, subtitle `'Master Partner'`. Route `/branch-performance` → new page; make merchant role landing sane (in the Dashboard route component, `if (role === 'merchant') return <Navigate to="/branch-performance" />` using the router's redirect idiom).

- [ ] **Step 6:** `BranchPerformance.tsx`:

```tsx
import { useQuery } from '@tanstack/react-query';
import {
  Card, CardContent, CardDescription, CardHeader, CardTitle,
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
  Badge, getStatusVariant, TableSkeleton,
} from '@agent-system/shared-ui';
import { format, parseISO } from 'date-fns';
import { supabase } from '../lib/supabase';

interface BranchStat {
  branch_id: string; branch_name: string; branch_status: string;
  total_leads: number; leads_this_month: number; last_lead_at: string | null;
}

// Master-partner view: leads submitted through each branch's own link/QR.
// Agent-assigned partnership leads are intentionally excluded.
export function BranchPerformance() {
  const { data, isLoading } = useQuery({
    queryKey: ['merchant-branch-stats'],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('merchant_branch_stats');
      if (error) throw error;
      return (data ?? []) as BranchStat[];
    },
  });
  return (
    <div className="flex flex-col gap-4 animate-fade-in">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">Branch Performance</h1>
        <p className="text-sm text-muted-foreground">
          Leads submitted through each branch's enquiry link
        </p>
      </div>
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Branches</CardTitle>
          <CardDescription>{data?.length ?? 0} branches</CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <TableSkeleton rows={3} columns={5} />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Branch</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Total Leads</TableHead>
                  <TableHead className="text-right">This Month</TableHead>
                  <TableHead>Last Lead</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(data ?? []).map((b) => (
                  <TableRow key={b.branch_id}>
                    <TableCell className="font-medium">{b.branch_name}</TableCell>
                    <TableCell>
                      <Badge variant={getStatusVariant(b.branch_status)} className="capitalize">{b.branch_status}</Badge>
                    </TableCell>
                    <TableCell className="text-right">{b.total_leads}</TableCell>
                    <TableCell className="text-right">{b.leads_this_month}</TableCell>
                    <TableCell className="text-muted-foreground">
                      {b.last_lead_at ? format(parseISO(b.last_lead_at), 'd MMM yyyy, HH:mm') : '—'}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
```

- [ ] **Step 7:** `pnpm -r typecheck` → PASS. Commit: `feat(merchant): master-partner portal login + branch performance dashboard`

---

### Task 11: Get Quote email — partner + document attachments (item 2)

**Files:**
- Modify: `supabase/functions/send-quote-request/index.ts`

- [ ] **Step 1:** After loading the vehicle (`:227-232`), extend the select with `merchant_id`; when set, fetch `merchants.name` and add a `Partner` row to the Vehicle table in `buildQuoteRequestHtml` (extend `QuoteEmailData` with `partner: string`).

- [ ] **Step 2:** Load the vehicle's documents and attach:

```ts
// Attach the customer's uploaded documents so admin can prepare the quote.
const { data: atts } = await supabase
  .from('enquiry_attachments')
  .select('storage_path, file_name, content_type')
  .eq('enquiry_vehicle_id', vehicleId);

const MAX_TOTAL = 15 * 1024 * 1024;
let total = 0;
const attachments: { filename: string; content: string }[] = [];
for (const a of atts ?? []) {
  const { data: blob, error } = await supabase.storage.from('enquiry-attachments').download(a.storage_path);
  if (error || !blob) { console.error(`attachment download failed: ${a.storage_path}`, error); continue; }
  const buf = new Uint8Array(await blob.arrayBuffer());
  if (total + buf.byteLength > MAX_TOTAL) { console.warn(`skipping ${a.file_name}: attachment budget exceeded`); continue; }
  total += buf.byteLength;
  // Chunked base64 to avoid call-stack limits on large files.
  let binary = '';
  for (let i = 0; i < buf.length; i += 0x8000) {
    binary += String.fromCharCode(...buf.subarray(i, i + 0x8000));
  }
  attachments.push({ filename: a.file_name, content: btoa(binary) });
}
```

Pass `attachments` into `sendResendEmail` (add an optional param; include `attachments` in the Resend POST body only when non-empty).

- [ ] **Step 3:** Also authorize **unit viewers** (item 10b): in the ownership check (`:208-224`), replace the single-agent comparison — load the caller agent's `id, parent_agent_id, is_unit_manager` and the enquiry agent's `id, parent_agent_id`; allow when caller owns it OR (`caller.parent_agent_id === null || caller.is_unit_manager`) AND both share a unit root (`coalesce(parent_agent_id, id)` equality).

- [ ] **Step 4:** `pnpm -r typecheck` (Deno file is excluded from tsc — just verify no app breakage) → PASS. Commit: `feat(quote-email): partner row + document attachments; unit viewers may request`

---

### Task 12: Repo verification

- [ ] `pnpm -r typecheck` → all packages PASS
- [ ] `pnpm build` → all three apps build
- [ ] Fix anything that surfaces; commit fixes.

---

### Task 13: Deployment (staging → prod)

**Staging (Supabase `lyjdlietzmmejrxjvwgp`, Render `racc-*-staging`):**
- [ ] Apply the six migrations in order via MCP `apply_migration`.
- [ ] Deploy edge functions `send-quote-request` and `create-merchant-user` via MCP `deploy_edge_function` (bundle every file in each function directory).
- [ ] Push `feat/partnership-round-4`; point the three staging static sites' branch at it (Render MCP `update_static_site`) if they still track `feat/merchant-partnership`.
- [ ] Smoke checks (SQL): `select form_branding from system_settings;` has `event_logo_url`; `select proname from pg_proc where proname in ('merchant_branch_stats','assign_vehicle_merchant');`; submit a staging branch-link enquiry with staff_id.

**Prod (Supabase `mjtdsevynrtcmafsnxsj`) — after staging verification:**
- [ ] Apply the same migrations via MCP `apply_migration`.
- [ ] Deploy both edge functions.
- [ ] Merge PR to `main` (Render auto-deploys the three prod sites).
- [ ] Verify: event register page shows RACC logo (blank `event_logo_url` → built-in logo is the fix); enquiry form still shows A-Z.
