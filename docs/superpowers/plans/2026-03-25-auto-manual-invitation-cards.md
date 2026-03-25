# Auto/Manual Invitation Card Type Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a per-slot `is_auto_card` toggle that controls card distribution (agent portal download vs admin-only printing) and PDF left-panel color (navy for auto, burgundy for manual).

**Architecture:** Boolean column on `slots` table. PDF generator moves to shared-ui for cross-portal reuse. Admin portal gets a toggle in slot creation and a badge in the slot table. Agent portal conditionally shows a PDF download button based on the flag.

**Tech Stack:** PostgreSQL (Supabase), TypeScript, React, jsPDF, qrcode, TanStack Query, shadcn/ui

**Spec:** `docs/superpowers/specs/2026-03-25-auto-manual-invitation-cards-design.md`

---

### Task 1: Database Migration

**Files:**
- Create: `supabase/migrations/20260325000001_slot_auto_card.sql`

- [ ] **Step 1: Create migration file**

```sql
-- Add is_auto_card flag to slots table
-- true = agents can download cards from portal (auto distribution)
-- false = only admin can print cards (manual distribution)
ALTER TABLE slots ADD COLUMN is_auto_card BOOLEAN NOT NULL DEFAULT true;
```

- [ ] **Step 2: Verify migration applies cleanly**

Run: `npx supabase db reset`
Expected: Database resets and all migrations apply without errors.

- [ ] **Step 3: Verify column exists**

Run: `npx supabase db reset 2>&1 | tail -5` then check in Supabase Studio at http://localhost:54323 that the `slots` table has the `is_auto_card` column with default `true`.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260325000001_slot_auto_card.sql
git commit -m "feat(db): add is_auto_card column to slots table"
```

---

### Task 2: Shared Types Update

**Files:**
- Modify: `packages/shared-types/src/database.ts:24-34` (Slot interface)

- [ ] **Step 1: Add `is_auto_card` to the Slot interface**

In `packages/shared-types/src/database.ts`, add `is_auto_card: boolean;` to the `Slot` interface after the `is_active` field (line 31):

```typescript
export interface Slot {
  id: string;
  campaign_id: string;
  start_at: string;
  end_at: string;
  checkin_window_minutes: number;
  checkout_window_minutes: number;
  is_active: boolean;
  is_auto_card: boolean;
  created_at: string;
  updated_at: string;
}
```

- [ ] **Step 2: Verify types compile**

Run: `pnpm -r typecheck`
Expected: No type errors.

- [ ] **Step 3: Commit**

```bash
git add packages/shared-types/src/database.ts
git commit -m "feat(types): add is_auto_card to Slot interface"
```

---

### Task 3: Move PDF Generator to Shared UI

**Files:**
- Create: `packages/shared-ui/src/utils/pdfGenerator.ts` (moved from admin-portal)
- Modify: `packages/shared-ui/package.json:9-33` (add jspdf, qrcode deps)
- Modify: `packages/shared-ui/src/index.ts:130-132` (add barrel export)
- Modify: `apps/admin-portal/src/pages/PdfExport.tsx:18` (update import)
- Delete: `apps/admin-portal/src/utils/pdfGenerator.ts`

- [ ] **Step 1: Add dependencies to shared-ui**

In `packages/shared-ui/package.json`, add to `dependencies`:
```json
"jspdf": "^4.0.0",
"qrcode": "^1.5.4"
```

Add to `devDependencies`:
```json
"@types/qrcode": "^1.5.6"
```

- [ ] **Step 2: Copy pdfGenerator.ts to shared-ui**

Copy `apps/admin-portal/src/utils/pdfGenerator.ts` to `packages/shared-ui/src/utils/pdfGenerator.ts`. The file is already framework-agnostic (pure jsPDF + qrcode), no changes needed yet.

- [ ] **Step 3: Add `isAutoCard` to InvitationCardData and update drawInvitationCard**

In the newly copied `packages/shared-ui/src/utils/pdfGenerator.ts`:

Add `isAutoCard: boolean;` to the `InvitationCardData` interface and add the `export` keyword (needed for barrel re-export in Step 4):

```typescript
export interface InvitationCardData {
  inviteeName: string;
  campaignName: string;
  venue: string;
  dayOfWeek: string;
  slotDate: string;
  startTime: string;
  endTime: string;
  uniqueToken: string;
  registrationId: string;
  registrationUrl: string;
  isAutoCard: boolean;
}
```

In the `drawInvitationCard` function, replace the hardcoded navy left panel color (originally line 48 — will be ~49 after the interface change above):

```typescript
// Before:
doc.setFillColor(15, 23, 42);

// After:
const panelColor = data.isAutoCard
  ? { r: 15, g: 23, b: 42 }    // Navy #0f172a (auto)
  : { r: 127, g: 29, b: 29 };  // Burgundy #7f1d1d (manual)
doc.setFillColor(panelColor.r, panelColor.g, panelColor.b);
```

- [ ] **Step 4: Add barrel export in shared-ui index.ts**

In `packages/shared-ui/src/index.ts`, add before the `// Design System` comment (before line 124):

```typescript
// PDF Generation
export { generateInvitationCard, generateBulkInvitationCards, formatSlotDate, formatTime } from './utils/pdfGenerator';
export type { InvitationCardData } from './utils/pdfGenerator';
```

Note: The `export` keyword on `InvitationCardData` was already added in Step 3 above.

- [ ] **Step 5: Update admin portal PdfExport import**

In `apps/admin-portal/src/pages/PdfExport.tsx`, change line 18:

```typescript
// Before:
import { generateBulkInvitationCards } from '../utils/pdfGenerator';

// After:
import { generateBulkInvitationCards } from '@agent-system/shared-ui';
```

- [ ] **Step 6: Delete the old file**

Delete `apps/admin-portal/src/utils/pdfGenerator.ts`.

- [ ] **Step 7: Install dependencies**

Run: `pnpm install`
Expected: Lockfile updates, no errors.

- [ ] **Step 8: Verify types compile**

Run: `pnpm -r typecheck`
Expected: Type errors for `isAutoCard` missing in PdfExport.tsx call sites — this is expected and will be fixed in Task 5. If there are other errors, fix them now.

- [ ] **Step 9: Commit**

```bash
git add packages/shared-ui/src/utils/pdfGenerator.ts packages/shared-ui/package.json packages/shared-ui/src/index.ts apps/admin-portal/src/pages/PdfExport.tsx
git rm apps/admin-portal/src/utils/pdfGenerator.ts
git commit -m "refactor: move pdfGenerator to shared-ui with isAutoCard color support"
```

---

### Task 4: Admin Portal — Slot Creation Toggle

**Files:**
- Modify: `apps/admin-portal/src/pages/campaigns/CampaignDetail.tsx:220-226` (newSlot state)
- Modify: `apps/admin-portal/src/pages/campaigns/CampaignDetail.tsx:239-258` (handleAddSlot)
- Modify: `apps/admin-portal/src/pages/campaigns/CampaignDetail.tsx:270-287` (handleBulkCreate)
- Modify: `apps/admin-portal/src/pages/campaigns/CampaignDetail.tsx:482-535` (single slot dialog fields)
- Modify: `apps/admin-portal/src/pages/campaigns/CampaignDetail.tsx:536-605` (bulk slot dialog fields)

- [ ] **Step 1: Add import for Switch component**

At the top of `CampaignDetail.tsx`, check if `Switch` is available from shared-ui. If not, use a `Checkbox` (already imported). For this plan, use a labeled checkbox approach:

The `Checkbox` component is already imported (line 34). No new import needed.

- [ ] **Step 2: Extend newSlot state with is_auto_card**

In `CampaignDetail.tsx`, update the `newSlot` state (line 220-226):

```typescript
const [newSlot, setNewSlot] = useState({
  date: undefined as Date | undefined,
  start_time: '10:00',
  end_time: '13:00',
  checkin_window_minutes: 30,
  checkout_window_minutes: 30,
  is_auto_card: true,
});
```

- [ ] **Step 3: Add bulkIsAutoCard state**

After the existing bulk state variables (around line 234), add:

```typescript
const [bulkIsAutoCard, setBulkIsAutoCard] = useState(true);
```

- [ ] **Step 4: Pass is_auto_card in handleAddSlot**

In the `handleAddSlot` function (line 242), add `is_auto_card` to the mutation payload:

```typescript
await createSlot.mutateAsync({
  campaign_id: campaignId,
  start_at: new Date(`${dateStr}T${newSlot.start_time}:00`).toISOString(),
  end_at: new Date(`${dateStr}T${newSlot.end_time}:00`).toISOString(),
  checkin_window_minutes: newSlot.checkin_window_minutes,
  checkout_window_minutes: newSlot.checkout_window_minutes,
  is_active: true,
  is_auto_card: newSlot.is_auto_card,
});
```

Also reset `is_auto_card` to `true` in the state reset after creation (line 251-257):

```typescript
setNewSlot({
  date: undefined,
  start_time: '10:00',
  end_time: '13:00',
  checkin_window_minutes: 30,
  checkout_window_minutes: 30,
  is_auto_card: true,
});
```

- [ ] **Step 5: Pass is_auto_card in handleBulkCreate**

In the `handleBulkCreate` function (around line 273), add `is_auto_card` to each slot:

```typescript
await createSlot.mutateAsync({
  campaign_id: campaignId,
  start_at: new Date(`${dateStr}T${bulkStartTime}:00`).toISOString(),
  end_at: new Date(`${dateStr}T${bulkEndTime}:00`).toISOString(),
  checkin_window_minutes: bulkCheckinWindow,
  checkout_window_minutes: bulkCheckoutWindow,
  is_active: true,
  is_auto_card: bulkIsAutoCard,
});
```

- [ ] **Step 6: Add Card Distribution toggle to single slot dialog**

In the single slot form section (after the check-in/check-out window grid, around line 533), add:

```tsx
<div className="flex items-center space-x-2">
  <Checkbox
    id="is_auto_card"
    checked={newSlot.is_auto_card}
    onCheckedChange={(checked) =>
      setNewSlot({ ...newSlot, is_auto_card: checked === true })
    }
  />
  <div className="grid gap-0.5 leading-none">
    <Label htmlFor="is_auto_card">Auto Card Distribution</Label>
    <p className="text-xs text-muted-foreground">
      {newSlot.is_auto_card
        ? 'Agents can download invitation cards from their portal'
        : 'Only admin can print invitation cards'}
    </p>
  </div>
</div>
```

- [ ] **Step 7: Add Card Distribution toggle to bulk slot dialog**

In the bulk slot form section (after the check-in/check-out window grid, around line 576), add the same toggle using the bulk state:

```tsx
<div className="flex items-center space-x-2">
  <Checkbox
    id="bulk_is_auto_card"
    checked={bulkIsAutoCard}
    onCheckedChange={(checked) => setBulkIsAutoCard(checked === true)}
  />
  <div className="grid gap-0.5 leading-none">
    <Label htmlFor="bulk_is_auto_card">Auto Card Distribution</Label>
    <p className="text-xs text-muted-foreground">
      {bulkIsAutoCard
        ? 'Agents can download invitation cards from their portal'
        : 'Only admin can print invitation cards'}
    </p>
  </div>
</div>
```

- [ ] **Step 8: Add badge to slot table row**

In the `SlotRow` component, in the Status cell (around line 99), add a badge for card type next to the active/inactive badge:

```tsx
<TableCell>
  <div className="flex items-center gap-1">
    <Badge variant={slot.is_active ? 'active' : 'inactive'}>
      {slot.is_active ? 'Active' : 'Inactive'}
    </Badge>
    <Badge variant={slot.is_auto_card ? 'info' : 'warning'}>
      {slot.is_auto_card ? 'Auto' : 'Manual'}
    </Badge>
  </div>
</TableCell>
```

- [ ] **Step 9: Add toggle action in slot row actions**

Following the existing pattern where `SlotRow` receives all actions as callback props from the parent `CampaignDetail` component:

**9a. Add `onToggleCardType` callback prop to SlotRow.**

Update the `SlotRow` component's props interface (around line 63-70) to add the new callback:

```typescript
function SlotRow({
  slot,
  isExpanded,
  onToggleExpand,
  onOpenReminder,
  onToggleActive,
  onToggleCardType,
  onDelete,
}: {
  slot: Slot;
  isExpanded: boolean;
  onToggleExpand: () => void;
  onOpenReminder: () => void;
  onToggleActive: () => void;
  onToggleCardType: () => void;
  onDelete: () => void;
}) {
```

**9b. Add the toggle button in SlotRow's actions area** (around line 104-143), next to the existing action buttons:

```tsx
<Button
  variant="ghost"
  size="sm"
  className="h-8 w-8 p-0"
  onClick={onToggleCardType}
  title={slot.is_auto_card ? 'Switch to manual cards' : 'Switch to auto cards'}
>
  <FileText className="h-4 w-4 text-amber-500" />
</Button>
```

Import `FileText` from lucide-react (add to existing import on line 37).

**9c. Import `useUpdateSlot` in the parent `CampaignDetail` component** and wire it up.

Add to imports at the top of the file:

```typescript
import { useSlots, useCreateSlot, useDeleteSlot, useToggleSlotActive, useUpdateSlot } from '../../hooks/useSlots';
```

(Add `useUpdateSlot` to the existing import on line 40.)

In the `CampaignDetail` function body, add:

```typescript
const updateSlot = useUpdateSlot();
```

**9d. Pass the callback when rendering `SlotRow`** (around line 658):

```tsx
<SlotRow
  key={slot.id}
  slot={slot}
  isExpanded={expandedSlotId === slot.id}
  onToggleExpand={() => setExpandedSlotId(expandedSlotId === slot.id ? null : slot.id)}
  onOpenReminder={() => handleOpenReminderDialog(slot)}
  onToggleActive={() => toggleSlotActive.mutate({ id: slot.id, is_active: !slot.is_active })}
  onToggleCardType={() => updateSlot.mutate({ id: slot.id, is_auto_card: !slot.is_auto_card })}
  onDelete={() => handleDeleteSlot(slot.id)}
/>
```

- [ ] **Step 10: Verify the admin portal builds**

Run: `pnpm --filter admin-portal build`
Expected: Build succeeds (may have type warning for PdfExport, fixed in next task).

- [ ] **Step 11: Commit**

```bash
git add apps/admin-portal/src/pages/campaigns/CampaignDetail.tsx
git commit -m "feat(admin): add auto/manual card toggle to slot creation and table"
```

---

### Task 5: Admin Portal — PdfExport Color Support

**Files:**
- Modify: `apps/admin-portal/src/pages/PdfExport.tsx:27-32` (local Slot interface)
- Modify: `apps/admin-portal/src/pages/PdfExport.tsx:91-100` (registrations query)
- Modify: `apps/admin-portal/src/pages/PdfExport.tsx:117-130` (invitationData mapping)

- [ ] **Step 1: Update local Registration interface**

The local `Slot` interface (lines 27-32) is used for the slots dropdown and does NOT need `is_auto_card` — leave it unchanged. The `is_auto_card` value is only needed on the `Registration`'s nested slot join.

Update the `Registration` interface (lines 34-48) to include `is_auto_card` in its nested `slot` type:

```typescript
interface Registration {
  id: string;
  invitee_name: string | null;
  agent_link: {
    link_code: string;
  } | null;
  slot: {
    start_at: string;
    end_at: string;
    is_auto_card: boolean;
    campaign: {
      name: string;
      venue: string;
    };
  };
}
```

- [ ] **Step 3: Update registrations query to include is_auto_card**

In the registrations query (lines 91-100), add `is_auto_card` to the slot select:

```typescript
.select(`
  id,
  invitee_name,
  agent_link:agent_links(link_code),
  slot:slots(
    start_at,
    end_at,
    is_auto_card,
    campaign:campaigns(name, venue)
  )
`)
```

- [ ] **Step 4: Pass isAutoCard to invitationData**

In the `handleGenerateInvitationCards` function (lines 117-130), add `isAutoCard` to each invitation:

```typescript
const invitationData = registrations.map((reg) => ({
  inviteeName: reg.invitee_name || 'Guest',
  campaignName: reg.slot.campaign.name,
  venue: reg.slot.campaign.venue,
  dayOfWeek: format(parseISO(reg.slot.start_at), 'EEE'),
  slotDate: reg.slot.start_at,
  startTime: format(parseISO(reg.slot.start_at), 'HH:mm'),
  endTime: format(parseISO(reg.slot.end_at), 'HH:mm'),
  uniqueToken: reg.agent_link?.link_code ?? reg.id,
  registrationId: reg.id,
  registrationUrl: reg.agent_link
    ? `${publicPagesUrl}/public/register/${reg.agent_link.link_code}`
    : '',
  isAutoCard: reg.slot.is_auto_card,
}));
```

- [ ] **Step 5: Verify admin portal builds**

Run: `pnpm --filter admin-portal build`
Expected: Build succeeds with no errors.

- [ ] **Step 6: Commit**

```bash
git add apps/admin-portal/src/pages/PdfExport.tsx
git commit -m "feat(admin): pass is_auto_card to PDF generator for color differentiation"
```

---

### Task 6: Agent Portal — Dependencies & Hook Updates

**Files:**
- Modify: `apps/agent-portal/package.json` (add jspdf, qrcode)
- Modify: `apps/agent-portal/src/hooks/useAgentLinks.ts:5-17` (AgentLinkWithSlotCampaign interface)
- Modify: `apps/agent-portal/src/hooks/useAgentLinks.ts:25-32` (useMyLinks query)
- Modify: `apps/agent-portal/src/hooks/useAgentLinks.ts:139-146` (usePartnerLinks query)

- [ ] **Step 1: Add dependencies to agent portal**

These are needed because Vite resolves imports from workspace source (shared-ui is not pre-built), so the agent portal's bundler needs to find `jspdf` and `qrcode` in its dependency tree.

In `apps/agent-portal/package.json`, add to `dependencies`:

```json
"jspdf": "^4.0.0",
"qrcode": "^1.5.4"
```

Add to `devDependencies`:

```json
"@types/qrcode": "^1.5.6"
```

- [ ] **Step 2: Update AgentLinkWithSlotCampaign interface**

In `apps/agent-portal/src/hooks/useAgentLinks.ts`, update the interface (lines 5-17) to include `is_auto_card`:

```typescript
interface AgentLinkWithSlotCampaign extends AgentLink {
  slot: {
    id: string;
    start_at: string;
    end_at: string;
    is_auto_card: boolean;
    campaign: {
      id: string;
      name: string;
      venue: string;
    };
  };
  registration_count: number;
}
```

- [ ] **Step 3: Update useMyLinks query select**

In the `useMyLinks` function (lines 25-32), add `is_auto_card` to the slot select:

```typescript
.select(`
  *,
  slot:slots(
    id,
    start_at,
    end_at,
    is_auto_card,
    campaign:campaigns(id, name, venue)
  )
`)
```

- [ ] **Step 4: Update usePartnerLinks query select**

In the `usePartnerLinks` function (lines 139-146), add `is_auto_card` to the slot select:

```typescript
.select(`
  *,
  slot:slots(
    id,
    start_at,
    end_at,
    is_auto_card,
    campaign:campaigns(id, name, venue)
  )
`)
```

- [ ] **Step 5: Install dependencies**

Run: `pnpm install`
Expected: Lockfile updates, no errors.

- [ ] **Step 6: Commit**

```bash
git add apps/agent-portal/package.json apps/agent-portal/src/hooks/useAgentLinks.ts pnpm-lock.yaml
git commit -m "feat(agent): add is_auto_card to link queries and PDF dependencies"
```

---

### Task 7: Agent Portal — PDF Download in MyLinks

**Files:**
- Modify: `apps/agent-portal/src/pages/MyLinks.tsx:262-306` (InvitationCard actions area)

- [ ] **Step 1: Add imports**

At the top of `MyLinks.tsx`, add:

```typescript
import { FileDown, Loader2 } from 'lucide-react';
```

Add `FileDown` and `Loader2` to the existing lucide import (if not already present). Also add the PDF generator import:

```typescript
import { generateBulkInvitationCards } from '@agent-system/shared-ui';
import type { InvitationCardData } from '@agent-system/shared-ui';
import { supabase } from '../lib/supabase';
```

Check if `supabase` and `format`/`parseISO` are already imported — they should be. Also import `useState` for tracking download state (already imported).

- [ ] **Step 2: Add download state**

Near the existing state variables (around where `copiedLinkId` is declared), add:

```typescript
const [downloadingLinkId, setDownloadingLinkId] = useState<string | null>(null);
```

- [ ] **Step 3: Add handleDownloadCards function**

Add this function after `handleCopyLink`:

```typescript
const handleDownloadCards = async (link: typeof links[number]) => {
  if (!link.slot) return;
  setDownloadingLinkId(link.id);
  try {
    // Fetch registrations for this specific agent link
    const { data: regs, error } = await supabase
      .from('registrations')
      .select('id, invitee_name')
      .eq('agent_link_id', link.id)
      .not('invitee_name', 'is', null);

    if (error) throw error;
    if (!regs || regs.length === 0) {
      toast({ title: 'No registrations', description: 'No registered invitees for this link yet.', variant: 'error' });
      return;
    }

    const publicPagesUrl = import.meta.env.VITE_PUBLIC_PAGES_URL || window.location.origin;
    const invitationData: InvitationCardData[] = regs.map((reg) => ({
      inviteeName: reg.invitee_name || 'Guest',
      campaignName: link.slot.campaign.name,
      venue: link.slot.campaign.venue,
      dayOfWeek: format(parseISO(link.slot.start_at), 'EEE'),
      slotDate: link.slot.start_at,
      startTime: format(parseISO(link.slot.start_at), 'HH:mm'),
      endTime: format(parseISO(link.slot.end_at), 'HH:mm'),
      uniqueToken: link.link_code,
      registrationId: reg.id,
      registrationUrl: `${publicPagesUrl}/public/register/${link.link_code}`,
      isAutoCard: true, // Auto cards only — manual cards don't show download
    }));

    const doc = await generateBulkInvitationCards(invitationData);
    doc.save(`invitation-cards-${link.slot.campaign.name}.pdf`);
    toast({ title: `${regs.length} card${regs.length > 1 ? 's' : ''} downloaded` });
  } catch (err: any) {
    toast({ title: 'Failed to generate cards', description: err.message, variant: 'error' });
  } finally {
    setDownloadingLinkId(null);
  }
};
```

- [ ] **Step 4: Replace the entire InvitationCard actions prop**

In the "My Active Links" section (around lines 275-303), **replace the entire `<InvitationCard>` element** (including its `actions` prop) with the version below. The new `actions` wraps two tooltips in a flex container — the download button (conditional on `is_auto_card`) plus the existing copy button:

```tsx
<InvitationCard
  key={link.id}
  eventName={link.slot?.campaign?.name ?? 'Unknown Event'}
  venue={link.slot?.campaign?.venue ?? '-'}
  date={link.slot ? parseISO(link.slot.start_at) : new Date()}
  startTime={link.slot ? format(parseISO(link.slot.start_at), 'HH:mm') : '-'}
  actions={
    <div className="flex items-center gap-1">
      {link.slot?.is_auto_card && (
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="sm"
              className="h-8 w-8 p-0"
              onClick={() => handleDownloadCards(link)}
              disabled={downloadingLinkId === link.id}
              aria-label="Download invitation cards"
            >
              {downloadingLinkId === link.id ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <FileDown className="h-4 w-4" />
              )}
            </Button>
          </TooltipTrigger>
          <TooltipContent>Download invitation cards</TooltipContent>
        </Tooltip>
      )}
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="ghost"
            size="sm"
            className="h-8 w-8 p-0"
            onClick={() => handleCopyLink(link.link_code, link.id)}
            aria-label="Copy registration link"
          >
            {copiedLinkId === link.id ? (
              <Check className="h-4 w-4 text-emerald-600" />
            ) : (
              <Copy className="h-4 w-4" />
            )}
          </Button>
        </TooltipTrigger>
        <TooltipContent>
          {copiedLinkId === link.id ? 'Link copied!' : 'Copy registration link'}
        </TooltipContent>
      </Tooltip>
    </div>
  }
/>
```

- [ ] **Step 5: Verify agent portal builds**

Run: `pnpm --filter agent-portal build`
Expected: Build succeeds.

- [ ] **Step 6: Commit**

```bash
git add apps/agent-portal/src/pages/MyLinks.tsx
git commit -m "feat(agent): add conditional PDF download button for auto card slots"
```

---

### Task 8: Agent Portal — PDF Download in PartnerLinks

**Files:**
- Modify: `apps/agent-portal/src/pages/PartnerLinks.tsx:253-299` (InvitationCard actions area)

- [ ] **Step 1: Add imports**

At the top of `PartnerLinks.tsx`, add the same imports as MyLinks:

```typescript
import { FileDown, Loader2 } from 'lucide-react';
import { generateBulkInvitationCards } from '@agent-system/shared-ui';
import type { InvitationCardData } from '@agent-system/shared-ui';
```

Add `FileDown` and `Loader2` to the existing lucide import. Check `supabase` is imported from `../lib/supabase` (it's not currently in PartnerLinks — add it if missing).

- [ ] **Step 2: Add download state and handler**

Add the same `downloadingLinkId` state and `handleDownloadCards` function as in MyLinks. The function body is identical — it fetches registrations by `agent_link_id` and generates a bulk PDF.

```typescript
const [downloadingLinkId, setDownloadingLinkId] = useState<string | null>(null);

const handleDownloadCards = async (link: typeof links[number]) => {
  if (!link.slot) return;
  setDownloadingLinkId(link.id);
  try {
    const { data: regs, error } = await supabase
      .from('registrations')
      .select('id, invitee_name')
      .eq('agent_link_id', link.id)
      .not('invitee_name', 'is', null);

    if (error) throw error;
    if (!regs || regs.length === 0) {
      toast({ title: 'No registrations', description: 'No registered invitees for this link yet.', variant: 'error' });
      return;
    }

    const publicPagesUrl = import.meta.env.VITE_PUBLIC_PAGES_URL || window.location.origin;
    const invitationData: InvitationCardData[] = regs.map((reg) => ({
      inviteeName: reg.invitee_name || 'Guest',
      campaignName: link.slot.campaign.name,
      venue: link.slot.campaign.venue,
      dayOfWeek: format(parseISO(link.slot.start_at), 'EEE'),
      slotDate: link.slot.start_at,
      startTime: format(parseISO(link.slot.start_at), 'HH:mm'),
      endTime: format(parseISO(link.slot.end_at), 'HH:mm'),
      uniqueToken: link.link_code,
      registrationId: reg.id,
      registrationUrl: `${publicPagesUrl}/public/register/${link.link_code}`,
      isAutoCard: true,
    }));

    const doc = await generateBulkInvitationCards(invitationData);
    doc.save(`invitation-cards-${link.slot.campaign.name}.pdf`);
    toast({ title: `${regs.length} card${regs.length > 1 ? 's' : ''} downloaded` });
  } catch (err: any) {
    toast({ title: 'Failed to generate cards', description: err.message, variant: 'error' });
  } finally {
    setDownloadingLinkId(null);
  }
};
```

- [ ] **Step 3: Add conditional download button to PartnerLinks InvitationCard actions**

Same pattern as MyLinks — wrap actions in a flex div, add download button before copy button, conditionally show based on `link.slot?.is_auto_card`:

```tsx
actions={
  <div className="flex items-center gap-1">
    {link.slot?.is_auto_card && (
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="ghost"
            size="sm"
            className="h-8 w-8 p-0"
            onClick={() => handleDownloadCards(link)}
            disabled={downloadingLinkId === link.id}
            aria-label="Download invitation cards"
          >
            {downloadingLinkId === link.id ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <FileDown className="h-4 w-4" />
            )}
          </Button>
        </TooltipTrigger>
        <TooltipContent>Download invitation cards</TooltipContent>
      </Tooltip>
    )}
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className="h-8 w-8 p-0"
          onClick={() => handleCopyLink(link.link_code, link.id)}
          aria-label="Copy registration link"
        >
          {copiedLinkId === link.id ? (
            <Check className="h-4 w-4 text-emerald-600" />
          ) : (
            <Copy className="h-4 w-4" />
          )}
        </Button>
      </TooltipTrigger>
      <TooltipContent>
        {copiedLinkId === link.id ? 'Link copied!' : 'Copy registration link'}
      </TooltipContent>
    </Tooltip>
  </div>
}
```

- [ ] **Step 4: Verify agent portal builds**

Run: `pnpm --filter agent-portal build`
Expected: Build succeeds.

- [ ] **Step 5: Commit**

```bash
git add apps/agent-portal/src/pages/PartnerLinks.tsx
git commit -m "feat(agent): add PDF download button to partner links for auto card slots"
```

---

### Task 9: Full Build Verification

**Files:** None (verification only)

- [ ] **Step 1: Run full workspace typecheck**

Run: `pnpm -r typecheck`
Expected: No type errors across all packages.

- [ ] **Step 2: Run full workspace build**

Run: `pnpm build`
Expected: All three apps build successfully.

- [ ] **Step 3: Run linter**

Run: `pnpm lint`
Expected: No lint errors (or only pre-existing ones).

- [ ] **Step 4: Manual smoke test checklist**

Start dev servers (`pnpm dev:admin` and `pnpm dev:agent`) and verify:

1. **Admin Portal — Create slot with auto card** (default): New slot should show "Auto" badge
2. **Admin Portal — Create slot with manual card**: Uncheck the toggle, new slot shows "Manual" badge
3. **Admin Portal — Toggle existing slot**: Click the card type action on a slot row, badge should flip
4. **Admin Portal — PDF Export**: Generate cards for an auto slot (navy left panel) and a manual slot (burgundy left panel) — verify different colors
5. **Agent Portal — MyLinks auto slot**: Download button visible next to copy-link, generates PDF
6. **Agent Portal — MyLinks manual slot**: No download button, only copy-link
7. **Agent Portal — PartnerLinks**: Same behavior as MyLinks for auto/manual

- [ ] **Step 5: Final commit if any fixes needed**

```bash
git add -A
git commit -m "fix: address issues found during smoke testing"
```
