# Agent-Level Invitation Mode Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move invitation mode from admin-managed per-slot (`is_auto_card`) to agent-managed per-agent (`is_auto_invite`), and remove all legacy auto/manual card gating.

**Architecture:** Add `is_auto_invite` boolean to agents table, add toggle UI on MyAgents page (Agent Admin only), remove `is_auto_card` from slots table, clean up all references across admin portal, agent portal, shared types, and PDF generator.

**Tech Stack:** Supabase (PostgreSQL migration), React, TypeScript, TanStack Query, shadcn/ui

---

## File Map

| Action | File | Responsibility |
|--------|------|---------------|
| Create | `supabase/migrations/20260330000002_agent_auto_invite.sql` | Add column + drop column migration |
| Modify | `packages/shared-types/src/database.ts` | Update Agent/Slot/CardTemplate types |
| Modify | `packages/shared-ui/src/utils/pdfGenerator.ts` | Remove isAutoCard from PDF generation |
| Modify | `apps/admin-portal/src/pages/campaigns/CampaignDetail.tsx` | Remove auto/manual slot UI |
| Modify | `apps/admin-portal/src/pages/PdfExport.tsx` | Remove is_auto_card from query and usage |
| Modify | `apps/admin-portal/src/pages/CardTemplateEditor.tsx` | Remove auto/manual color fields |
| Modify | `apps/agent-portal/src/pages/MyLinks.tsx` | Remove is_auto_card conditional |
| Modify | `apps/agent-portal/src/pages/PartnerLinks.tsx` | Remove isAutoCard reference |
| Modify | `apps/agent-portal/src/hooks/useAgentLinks.ts` | Remove is_auto_card from select |
| Modify | `apps/agent-portal/src/pages/MyAgents.tsx` | Add Auto Invite toggle for Agent Admin |

---

### Task 1: Database Migration

**Files:**
- Create: `supabase/migrations/20260330000002_agent_auto_invite.sql`

- [ ] **Step 1: Create migration file**

```sql
-- Move invitation mode from slot-level (is_auto_card) to agent-level (is_auto_invite)
-- is_auto_invite: when true, future email integration will auto-send invitation cards
ALTER TABLE agents ADD COLUMN is_auto_invite BOOLEAN NOT NULL DEFAULT true;

-- Remove legacy slot-level auto card flag
ALTER TABLE slots DROP COLUMN is_auto_card;
```

- [ ] **Step 2: Commit**

```bash
git add supabase/migrations/20260330000002_agent_auto_invite.sql
git commit -m "feat: add is_auto_invite to agents, drop is_auto_card from slots"
```

---

### Task 2: Update Shared Types

**Files:**
- Modify: `packages/shared-types/src/database.ts:26-40` (CardTemplate interface)
- Modify: `packages/shared-types/src/database.ts:49-63` (DEFAULT_CARD_TEMPLATE)
- Modify: `packages/shared-types/src/database.ts:93-104` (Slot interface)
- Modify: `packages/shared-types/src/database.ts:116-130` (Agent interface)

- [ ] **Step 1: Remove autoCardColor and manualCardColor from CardTemplate interface**

In `packages/shared-types/src/database.ts`, replace the CardTemplate interface (lines 26-40):

```typescript
export interface CardTemplate {
  panelColor: string;
  panelTextColor: string;
  accentColor: string;
  fontFamily: string;
  titleFontSize: number;
  bodyFontSize: number;
  subtitle: string;
  instructionText: string;
  visibleElements: string[];
  elementOrder: string[];
  qrColor: string;
  qrSize: number;
}
```

- [ ] **Step 2: Update DEFAULT_CARD_TEMPLATE**

Replace the default constant (lines 49-63):

```typescript
export const DEFAULT_CARD_TEMPLATE: CardTemplate = {
  panelColor: '#0f172a',
  panelTextColor: '#ffffff',
  accentColor: '#daa520',
  fontFamily: 'helvetica',
  titleFontSize: 14,
  bodyFontSize: 9,
  subtitle: 'Event Invitation',
  instructionText: 'Present this card at the event for check-in',
  visibleElements: ['logo', 'subtitle', 'date', 'campaign', 'venue', 'qr', 'invitee', 'instruction', 'reference'],
  elementOrder: ['campaign', 'venue', 'qr', 'invitee', 'instruction', 'reference'],
  qrColor: '#0f172a',
  qrSize: 25,
};
```

- [ ] **Step 3: Remove is_auto_card from Slot interface**

Replace the Slot interface (lines 93-104):

```typescript
export interface Slot {
  id: string;
  campaign_id: string;
  start_at: string; // ISO 8601 datetime (TIMESTAMPTZ)
  end_at: string; // ISO 8601 datetime (TIMESTAMPTZ)
  checkin_window_minutes: number;
  checkout_window_minutes: number;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}
```

- [ ] **Step 4: Add is_auto_invite to Agent interface**

Replace the Agent interface (lines 116-130):

```typescript
export interface Agent {
  id: string;
  user_id: string;
  name: string;
  email: string;
  phone: string;
  nric: string;
  agent_code: string;
  unit_name: string;
  tier_id: string | null;
  parent_agent_id: string | null;
  is_auto_invite: boolean;
  status: AgentStatus;
  created_at: string;
  updated_at: string;
}
```

- [ ] **Step 5: Commit**

```bash
git add packages/shared-types/src/database.ts
git commit -m "refactor: update types - add Agent.is_auto_invite, remove Slot.is_auto_card, simplify CardTemplate"
```

---

### Task 3: Update PDF Generator

**Files:**
- Modify: `packages/shared-ui/src/utils/pdfGenerator.ts:30-34` (InvitationCardData interface)
- Modify: `packages/shared-ui/src/utils/pdfGenerator.ts:66` (panel color logic)

- [ ] **Step 1: Remove isAutoCard from InvitationCardData interface**

In `packages/shared-ui/src/utils/pdfGenerator.ts`, remove the `isAutoCard` field from the interface. The field at line 33 (`isAutoCard: boolean;`) should be removed.

- [ ] **Step 2: Replace panel color logic**

At line 66, replace:
```typescript
const panelColor = hexToRgb(data.isAutoCard ? template.autoCardColor : template.manualCardColor);
```

With:
```typescript
const panelColor = hexToRgb(template.panelColor);
```

- [ ] **Step 3: Commit**

```bash
git add packages/shared-ui/src/utils/pdfGenerator.ts
git commit -m "refactor: simplify PDF generator - use single panelColor instead of auto/manual colors"
```

---

### Task 4: Clean Up Admin Portal — CampaignDetail

**Files:**
- Modify: `apps/admin-portal/src/pages/campaigns/CampaignDetail.tsx`

- [ ] **Step 1: Remove is_auto_card from new slot state**

At line 238-245, remove `is_auto_card: true` from the `newSlot` state:

```typescript
const [newSlot, setNewSlot] = useState({
  date: undefined as Date | undefined,
  start_time: '10:00',
  end_time: '13:00',
  checkin_window_minutes: 30,
  checkout_window_minutes: 30,
});
```

- [ ] **Step 2: Remove bulkIsAutoCard state**

Remove line 253: `const [bulkIsAutoCard, setBulkIsAutoCard] = useState(true);`

- [ ] **Step 3: Remove single-slot auto card checkbox**

Remove lines 650-666 (the `<div className="flex items-center space-x-2">` block containing the `is_auto_card` checkbox in single slot mode).

- [ ] **Step 4: Remove bulk auto card checkbox**

Remove lines 709-723 (the `<div className="flex items-center space-x-2">` block containing the `bulk_is_auto_card` checkbox in bulk mode).

- [ ] **Step 5: Remove is_auto_card from slot creation submit**

At line 361, remove `is_auto_card: newSlot.is_auto_card` from the create slot mutation data.

At line 370, remove `is_auto_card: true` from the reset state.

At line 395, remove `is_auto_card: bulkIsAutoCard` from the bulk slot creation data.

- [ ] **Step 6: Remove onToggleCardType from SlotRow**

In the `SlotRow` component (lines 58-74):
- Remove `onToggleCardType` from the destructured props (line 64)
- Remove `onToggleCardType: () => void` from the type definition (line 72)

- [ ] **Step 7: Remove Auto/Manual badge from SlotRow**

Remove lines 106-108 (the `<Badge variant={slot.is_auto_card ? 'info' : 'warning'}>` block).

- [ ] **Step 8: Remove the card type toggle button from SlotRow**

Remove lines 131-139 (the `<Button>` with `onClick={onToggleCardType}` and `<FileText>` icon).

- [ ] **Step 9: Remove onToggleCardType prop from SlotRow usage**

At line 812, remove: `onToggleCardType={() => updateSlot.mutate({ id: slot.id, is_auto_card: !slot.is_auto_card })}`

- [ ] **Step 10: Commit**

```bash
git add apps/admin-portal/src/pages/campaigns/CampaignDetail.tsx
git commit -m "refactor: remove is_auto_card slot controls from admin CampaignDetail"
```

---

### Task 5: Clean Up Admin Portal — PdfExport

**Files:**
- Modify: `apps/admin-portal/src/pages/PdfExport.tsx`

- [ ] **Step 1: Remove is_auto_card from type definition**

At line 46, remove `is_auto_card: boolean;` from the local slot type.

- [ ] **Step 2: Remove is_auto_card from Supabase select**

At line 104, remove `is_auto_card,` from the select query.

- [ ] **Step 3: Replace isAutoCard in card data mapping**

At line 137, remove `isAutoCard: reg.slot.is_auto_card,` from the mapped data. The `isAutoCard` field no longer exists on `InvitationCardData`.

- [ ] **Step 4: Commit**

```bash
git add apps/admin-portal/src/pages/PdfExport.tsx
git commit -m "refactor: remove is_auto_card references from admin PdfExport"
```

---

### Task 6: Clean Up Admin Portal — CardTemplateEditor

**Files:**
- Modify: `apps/admin-portal/src/pages/CardTemplateEditor.tsx`

- [ ] **Step 1: Replace auto/manual color fields with single panel color**

At lines 176-177, replace:
```tsx
<ColorField label="Auto Card Color" value={formState.autoCardColor} onChange={(v) => updateField('autoCardColor', v)} />
<ColorField label="Manual Card Color" value={formState.manualCardColor} onChange={(v) => updateField('manualCardColor', v)} />
```

With:
```tsx
<ColorField label="Panel Color" value={formState.panelColor} onChange={(v) => updateField('panelColor', v)} />
```

- [ ] **Step 2: Commit**

```bash
git add apps/admin-portal/src/pages/CardTemplateEditor.tsx
git commit -m "refactor: replace auto/manual card colors with single panelColor in template editor"
```

---

### Task 7: Clean Up Agent Portal — MyLinks

**Files:**
- Modify: `apps/agent-portal/src/pages/MyLinks.tsx:135` (isAutoCard in card data)
- Modify: `apps/agent-portal/src/pages/MyLinks.tsx:346-366` (conditional download button)

- [ ] **Step 1: Remove isAutoCard from card data mapping**

At line 135, remove `isAutoCard: true,` from the invitation data mapping.

- [ ] **Step 2: Make download button always visible**

At lines 346-366, replace the conditional `{link.slot?.is_auto_card && (...)}` wrapper. Remove the conditional — keep only the inner `<Tooltip>` block:

```tsx
<Tooltip>
  <TooltipTrigger asChild>
    <Button
      variant="ghost"
      size="sm"
      className="size-8 p-0"
      onClick={() => handleDownloadCards(link)}
      disabled={downloadingLinkId === link.id}
      aria-label="Download invitation cards"
    >
      {downloadingLinkId === link.id ? (
        <Loader2 className="size-4 animate-spin" />
      ) : (
        <FileDown className="size-4" />
      )}
    </Button>
  </TooltipTrigger>
  <TooltipContent>Download invitation cards</TooltipContent>
</Tooltip>
```

- [ ] **Step 3: Commit**

```bash
git add apps/agent-portal/src/pages/MyLinks.tsx
git commit -m "refactor: remove is_auto_card gating - card download always available"
```

---

### Task 8: Clean Up Agent Portal — PartnerLinks

**Files:**
- Modify: `apps/agent-portal/src/pages/PartnerLinks.tsx:119` (isAutoCard reference)

- [ ] **Step 1: Remove isAutoCard from card data mapping**

At line 119, remove `isAutoCard: true,` from the invitation data mapping.

- [ ] **Step 2: Commit**

```bash
git add apps/agent-portal/src/pages/PartnerLinks.tsx
git commit -m "refactor: remove isAutoCard from PartnerLinks card data"
```

---

### Task 9: Clean Up Agent Portal — useAgentLinks Hook

**Files:**
- Modify: `apps/agent-portal/src/hooks/useAgentLinks.ts:32` (useMyLinks query)
- Modify: `apps/agent-portal/src/hooks/useAgentLinks.ts:147` (usePartnerLinks query)

- [ ] **Step 1: Remove is_auto_card from useMyLinks select**

At line 32, remove `is_auto_card,` from the slot select:

```typescript
slot:slots(
  id,
  start_at,
  end_at,
  campaign:campaigns(id, name, venue)
)
```

- [ ] **Step 2: Remove is_auto_card from usePartnerLinks select**

At line 147, remove `is_auto_card,` from the slot select:

```typescript
slot:slots(
  id,
  start_at,
  end_at,
  campaign:campaigns(id, name, venue)
)
```

- [ ] **Step 3: Commit**

```bash
git add apps/agent-portal/src/hooks/useAgentLinks.ts
git commit -m "refactor: remove is_auto_card from agent link queries"
```

---

### Task 10: Add Auto Invite Toggle to MyAgents Page

**Files:**
- Modify: `apps/agent-portal/src/pages/MyAgents.tsx`

- [ ] **Step 1: Add Switch import**

At line 41 (end of shared-ui imports), add `Switch` to the imports:

```typescript
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  // ... existing imports ...
  useToast,
  Switch,
} from '@agent-system/shared-ui';
```

Also add `Mail` to the lucide-react imports at line 42:

```typescript
import { Users, UserCheck, Clock, UserPlus, ShieldOff, Tag, Mail } from 'lucide-react';
```

- [ ] **Step 2: Add mutation for updating auto invite**

After line 72 (the `deactivateSubAgent` hook), add:

```typescript
const [isUpdatingAutoInvite, setIsUpdatingAutoInvite] = useState(false);

const handleToggleAutoInvite = async () => {
  if (!agent) return;
  setIsUpdatingAutoInvite(true);
  try {
    const { error } = await supabase
      .from('agents')
      .update({ is_auto_invite: !agent.is_auto_invite })
      .eq('id', agent.id);
    if (error) throw error;
    toast({ title: `Auto invite ${agent.is_auto_invite ? 'disabled' : 'enabled'}` });
    // Refresh auth state to get updated agent data
    window.location.reload();
  } catch (err: any) {
    toast({ title: 'Failed to update setting', description: err.message, variant: 'error' });
  } finally {
    setIsUpdatingAutoInvite(false);
  }
};
```

Add the supabase import at the top of the file:

```typescript
import { supabase } from '../lib/supabase';
```

- [ ] **Step 3: Add Auto Invite toggle card to the page**

Add this card right after the role guard block (after line 65) and before the stats section. Place it as the first visible element in the main return:

```tsx
{/* Auto Invite Setting */}
<Card className="mb-6">
  <CardContent className="flex items-center justify-between py-4">
    <div className="flex items-center gap-3">
      <Mail className="size-5 text-muted-foreground" />
      <div>
        <p className="text-sm font-medium">Auto Invite</p>
        <p className="text-xs text-muted-foreground">
          Automatically send invitation cards via email when invitations are created
        </p>
      </div>
    </div>
    <Switch
      checked={agent?.is_auto_invite ?? true}
      onCheckedChange={handleToggleAutoInvite}
      disabled={isUpdatingAutoInvite}
    />
  </CardContent>
</Card>
```

- [ ] **Step 4: Verify the page renders correctly**

Run: `pnpm -r typecheck`
Expected: No type errors

- [ ] **Step 5: Commit**

```bash
git add apps/agent-portal/src/pages/MyAgents.tsx
git commit -m "feat: add Auto Invite toggle for Agent Admin on My Agents page"
```

---

### Task 11: Update System Settings Migration Data

**Files:**
- Create: `supabase/migrations/20260330000003_update_card_template_colors.sql`

- [ ] **Step 1: Create migration to update stored card_template JSON**

The system_settings table has a stored `card_template` JSON with `autoCardColor` and `manualCardColor`. Update it to use the new `panelColor` field:

```sql
-- Update card_template JSON: replace autoCardColor/manualCardColor with panelColor
UPDATE system_settings
SET card_template = card_template
  - 'autoCardColor'
  - 'manualCardColor'
  || '{"panelColor": "#0f172a"}'::jsonb;
```

- [ ] **Step 2: Commit**

```bash
git add supabase/migrations/20260330000003_update_card_template_colors.sql
git commit -m "fix: migrate card_template JSON from auto/manual colors to single panelColor"
```

---

### Task 12: Typecheck and Final Verification

- [ ] **Step 1: Run typecheck across all packages**

Run: `pnpm -r typecheck`
Expected: No type errors across all packages

- [ ] **Step 2: Run lint**

Run: `pnpm lint`
Expected: No lint errors

- [ ] **Step 3: Fix any remaining issues**

If typecheck or lint reveals errors, fix them. Common issues may include:
- Other files referencing `autoCardColor`/`manualCardColor` on the CardTemplate type
- Other files referencing `is_auto_card` on the Slot type
- Files referencing `isAutoCard` on InvitationCardData

Search for stragglers:
```bash
grep -r "is_auto_card\|autoCardColor\|manualCardColor\|isAutoCard" --include="*.ts" --include="*.tsx" apps/ packages/
```

- [ ] **Step 4: Commit any fixes**

```bash
git add -A
git commit -m "fix: resolve remaining type errors from invitation mode migration"
```

---

### Task 13: Deploy to Production

- [ ] **Step 1: Push database migration**

```bash
npx supabase db push
```

Expected: Both migrations applied successfully (agent_auto_invite + card_template_colors)

- [ ] **Step 2: Push code and verify deployment**

```bash
git push origin main
```

Expected: Render auto-deploys all three portals. Verify at:
- https://martin-admin-portal.onrender.com
- https://martin-agent-portal.onrender.com

- [ ] **Step 3: Verify Agent Portal**

1. Log in as agent@test.com
2. Navigate to My Agents page
3. Verify Auto Invite toggle is visible and defaults to ON
4. Toggle it off and on — verify toast messages

- [ ] **Step 4: Verify Admin Portal**

1. Log in as admin@test.com
2. Navigate to a campaign detail
3. Verify no Auto/Manual badge on slots
4. Verify no Auto Card checkbox in slot creation
5. Verify card template editor shows single "Panel Color" instead of auto/manual colors
