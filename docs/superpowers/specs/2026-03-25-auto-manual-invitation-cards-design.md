# Auto/Manual Invitation Card Type

**Date:** 2026-03-25
**Status:** Draft

## Problem

All invitation cards currently look identical regardless of how they are distributed. Admins cannot tell at a glance whether a printed card was distributed by an agent (auto) or printed by the admin themselves (manual). There is also no mechanism for agents to download invitation card PDFs from their portal.

## Solution

Add a per-slot `is_auto_card` boolean that controls:
1. Whether agents can download invitation card PDFs from the agent portal
2. The background color of the PDF left panel, so admins can visually distinguish card types

## Key Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Schema approach | Simple boolean (`is_auto_card`) | Binary requirement; YAGNI over enum |
| Default value | `true` (auto) | Most slots will be auto-distributed |
| Toggle location | Add Slot dialog (single & bulk) | Per-slot control at creation time |
| Auto color | Navy `#0f172a` | Current design, unchanged |
| Manual color | Burgundy `#7f1d1d` | Bold contrast from navy, instantly distinguishable |
| PDF generator location | Move to `packages/shared-ui` | Both portals need it; already framework-agnostic |
| QR code color | Navy `#0f172a` for both types | QR is on right panel; consistent brand element |
| Editing existing slots | Supported via slot row action | Admin can toggle card type after creation |
| Download granularity | Per-link (bulk PDF for all registrations) | Matches agent mental model of "my link = my invitees" |

## Behavior Matrix

| Aspect | Auto (`is_auto_card = true`) | Manual (`is_auto_card = false`) |
|--------|------------------------------|----------------------------------|
| Registration flow | Normal (via agent links) | Normal (via agent links) |
| Agent portal | Download button visible | No download button |
| Admin PDF Export | Can generate cards | Can generate cards |
| PDF left panel color | Navy `#0f172a` | Burgundy `#7f1d1d` |
| Card distribution | Agents download and share | Admin prints and distributes |

## Changes by Layer

### 1. Database Migration

```sql
ALTER TABLE slots ADD COLUMN is_auto_card BOOLEAN NOT NULL DEFAULT true;
```

Existing slots default to `true` (auto), preserving current behavior.

### 2. Shared Types (`packages/shared-types/src/database.ts`)

Add to `Slot` interface:

```typescript
export interface Slot {
  // ... existing fields
  is_auto_card: boolean;
}
```

### 3. Shared UI (`packages/shared-ui`)

**Move PDF generator:**
Move `apps/admin-portal/src/utils/pdfGenerator.ts` to `packages/shared-ui/src/utils/pdfGenerator.ts`.

**Add dependencies to `packages/shared-ui/package.json`:**
- `jspdf`
- `qrcode`
- `@types/qrcode` (devDependencies)

**Add barrel export in `packages/shared-ui/src/index.ts`:**
```typescript
export { generateInvitationCard, generateBulkInvitationCards, formatSlotDate, formatTime } from './utils/pdfGenerator';
```

**Update `InvitationCardData` interface:**

```typescript
interface InvitationCardData {
  // ... existing fields
  isAutoCard: boolean;
}
```

**Update `drawInvitationCard`** to use `isAutoCard` for left panel color:

```typescript
const panelColor = data.isAutoCard
  ? { r: 15, g: 23, b: 42 }    // Navy #0f172a
  : { r: 127, g: 29, b: 29 };  // Burgundy #7f1d1d
doc.setFillColor(panelColor.r, panelColor.g, panelColor.b);
```

QR code color stays navy (`#0f172a`) for both types — it's on the right panel and serves as a consistent brand element.

### 4. Admin Portal — CampaignDetail.tsx

**Add Slot dialog (single mode):**
- Extend `newSlot` state object to include `is_auto_card: true` as default
- Add toggle switch below existing fields
- Label: "Card Distribution"
- Description: Auto = "Agents can download cards from their portal" / Manual = "Only admin can print cards"
- Default: Auto (on)
- Pass `is_auto_card` in the `handleAddSlot` payload to `createSlot` mutation

**Add Slot dialog (bulk mode):**
- Add `bulkIsAutoCard` state variable (default `true`)
- Same toggle, applies to all slots in the bulk batch
- Pass `is_auto_card` in each slot created by `handleBulkCreate`

**Slot table row:**
- Add a small badge (e.g., `Auto` / `Manual`) next to the existing active/inactive badge
- Add a toggle action in the slot row actions to flip `is_auto_card` on existing slots (uses existing `useUpdateSlot` hook)

**Update admin portal imports:** Replace local `pdfGenerator` import with `@agent-system/shared-ui` import. Remove `apps/admin-portal/src/utils/pdfGenerator.ts` after moving.

### 5. Admin Portal — PdfExport.tsx

- **Update local `Slot` interface** (lines 27-32) to include `is_auto_card: boolean`, or refactor to use the shared `Slot` type from `@agent-system/shared-types`
- **Update registrations query** slot select (lines 95-98) to include `is_auto_card`:
  ```
  slot:slots(start_at, end_at, is_auto_card, campaign:campaigns(name, venue))
  ```
- Pass `isAutoCard: slot.is_auto_card` to each item in the `invitationData` array
- Update `generateBulkInvitationCards` import to use `@agent-system/shared-ui`

### 6. Admin Portal — useSlots.ts

No changes needed. The hook already selects `*` from slots, so `is_auto_card` is automatically included.

### 7. Agent Portal — MyLinks.tsx

**Update agent links query:**
The `useAgentLinks` hook uses an explicit slot select: `slot:slots(id, start_at, end_at, campaign:campaigns(id, name, venue))`. Update to include `is_auto_card`:
```
slot:slots(id, start_at, end_at, is_auto_card, campaign:campaigns(id, name, venue))
```

Also update the `AgentLinkWithSlotCampaign` TypeScript interface in the hooks file to include `is_auto_card: boolean` in the `slot` type.

**Download button (per-link bulk PDF):**
- For auto slots (`is_auto_card = true`): add a PDF download button next to the copy-link button in `InvitationCard` actions
- For manual slots (`is_auto_card = false`): only show copy-link button (current behavior)
- Clicking download fetches all registrations for that agent link, builds `InvitationCardData[]`, and calls `generateBulkInvitationCards` to produce a multi-page PDF
- Registration data needed: `id`, `invitee_name` from `registrations` table where `agent_link_id` matches

### 8. Agent Portal — PartnerLinks.tsx

Same treatment as MyLinks.tsx:
- Update partner links query to include `is_auto_card` in slot select
- Conditionally show download button based on `is_auto_card`

### 9. Agent Portal — Dependencies

- Add `jspdf` and `qrcode` to `apps/agent-portal/package.json` (peer deps of shared-ui's pdfGenerator)
- Import `generateBulkInvitationCards` from `@agent-system/shared-ui`

## Out of Scope

- Public pages: no changes
- Check-in/checkout flow: no changes
- QR code color adaptation: stays navy for both card types
- Registration flow: identical for both types
- Sending cards via WhatsApp/email: not part of this feature
