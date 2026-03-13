# Invitation Card UI Redesign — Design Specification

**Date:** 2026-03-13
**Status:** Approved
**Supersedes:** Current table-based invitation displays

## Problem

All invitation displays across the Agent Portal use plain `<Table>` components that look bland and data-heavy. They don't feel like actual invitation cards. The PDF printable cards in the Admin Portal use a basic blue-header layout that doesn't match the RACC Agency brand.

## Goal

Replace all invitation table views with visually appealing Split Panel invitation cards that feel like actual event invitations, and update the PDF card generator to match. Consistent RACC Agency gold branding across digital and print.

## Design Decision

**Card Style:** Split Panel (horizontal card with gradient left panel featuring date prominently)
**Layout:** Full-width stacked list (cards stack vertically, one per row)
**PDF:** Same Split Panel design adapted for A6 landscape print format

## Scope

### Files to Modify

| File | Change |
|------|--------|
| `packages/shared-ui/src/components/ui/invitation-card.tsx` | **Create** — Shared InvitationCard component |
| `packages/shared-ui/src/index.ts` | **Modify** — Add `export { InvitationCard } from './components/ui/invitation-card'` and `export type { InvitationCardProps } from './components/ui/invitation-card'` |
| `apps/agent-portal/src/pages/Invitations.tsx` | **Modify** — Replace Table with InvitationCard list |
| `apps/agent-portal/src/pages/AvailableInvitations.tsx` | **Modify** — Replace Table with InvitationCard list |
| `apps/agent-portal/src/pages/MyClaimedInvitations.tsx` | **Modify** — Replace Table with InvitationCard list |
| `apps/admin-portal/src/utils/pdfGenerator.ts` | **Modify** — Redesign PDF card layout to Split Panel |

### Files NOT Modified

- Stat cards at the top of each page remain unchanged (they work well)
- No database or API changes required
- No routing changes

## Component Design

### InvitationCard Component

**Location:** `packages/shared-ui/src/components/ui/invitation-card.tsx`

**Props Interface:**

```typescript
interface InvitationCardProps {
  // Event info
  eventName: string;
  venue: string;
  date: Date;           // Parsed from slot.start_at via parseISO()
  startTime: string;    // Pre-formatted by caller: format(parseISO(slot.start_at), 'HH:mm')
  endTime?: string;     // Pre-formatted by caller, used in PDF cards

  // Invitee info — when ALL three are omitted, the invitee row is hidden entirely
  // (used by AvailableInvitations which has no invitee data yet)
  inviteeName?: string | null;   // null renders "Not registered" in muted text
  inviteeType?: 'agent' | 'business_partner';
  status?: InvitationStatus;     // When omitted, badge area is hidden (not a blank space)

  // Actions rendered in bottom-right of right panel
  actions?: React.ReactNode;

  // Styling
  className?: string;
}
```

**Caller is responsible for formatting dates/times** using `date-fns` before passing to the component. The component is purely presentational.

**Regarding InvitationStatus deprecation:** The component uses `InvitationStatus` (current). When the migration to `RegistrationStatus` happens, the prop type will be updated — the badge variant mapping is identical for the shared statuses.

### Visual Layout

```
┌──────────────────────────────────────────────────────────────┐
│ ┌─────────────┬────────────────────────────────────────────┐ │
│ │             │                                            │ │
│ │  RACC Agency│  Annual Business Summit 2026        [Badge]│ │
│ │  Event Inv. │  📍 Grand Ballroom                        │ │
│ │             │  ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ │ │
│ │     15      │  Invitee          Type                     │ │
│ │  MAR 2026   │  John Doe         Agent     [Copy Link]   │ │
│ │    09:00    │                                            │ │
│ │             │                                            │ │
│ └─────────────┴────────────────────────────────────────────┘ │
│   gradient      white background                             │
│   #0F172A →                                                  │
│   #0369A1                                                    │
└──────────────────────────────────────────────────────────────┘
```

### Left Panel

- **Background:** `linear-gradient(135deg, #0F172A, #0369A1)`
- **Width:** Fixed ~120px on desktop, ~100px on mobile
- **Content (top to bottom):**
  - "RACC Agency" — gold `#DAA520`, 8px uppercase, letter-spacing 1px
  - "Event Invitation" — white 60% opacity, 8px
  - (spacer)
  - Day number — white, 24px bold
  - Month + Year — white 80% opacity, 11px semibold
  - Time — white 60% opacity, 10px

### Right Panel

- **Background:** white
- **Padding:** 16px
- **Content (top to bottom):**
  - Row 1: Event name (14px, bold, `#0F172A`) + Status badge (top-right)
  - Row 2: Venue with 📍 icon (10px, `#64748B`)
  - Dashed divider (`#E2E8F0`)
  - Row 3: Invitee label + name (or "Not registered" in muted text)
  - Row 3 right: Capacity type label + Action buttons

### Status Badges

Use the existing `<Badge>` component with `getStatusVariant(status)` — no custom colors needed. The existing badge variants already handle all invitation statuses:

| Status | Badge Variant | Existing Style |
|--------|--------------|----------------|
| pending | `pending` | `bg-slate-100 text-slate-700` |
| registered | `registered` | `bg-blue-100 text-blue-700` |
| attended | `attended` | `bg-emerald-100 text-emerald-700` |
| completed | `completed` | `bg-blue-100 text-blue-700` |
| expired | `expired` | `bg-red-100 text-red-700` |

Accessibility: badges include `aria-label` e.g., `aria-label="Status: Registered"`.

### Card Container

- `border-radius: 12px`
- `overflow: hidden` (clips gradient panel corners)
- `box-shadow: 0 2px 12px rgba(0,0,0,0.08)` default
- `box-shadow: 0 4px 20px rgba(0,0,0,0.12)` on hover
- `transition: box-shadow 200ms, transform 200ms`
- `transform: translateY(-1px)` on hover (subtle lift)

## Per-Page Integration

### My Invitations (Agent View)

**File:** `apps/agent-portal/src/pages/Invitations.tsx`

- Replace `<Table>` with `<div className="space-y-3">` containing `<InvitationCard>` for each invitation
- **Status badge:** Shown on all cards
- **Invitee section:** Shows invitee name or "Not registered" (muted) for pending
- **Actions:**
  - Pending: "Copy Link" button (ghost variant, Copy icon)
  - Registered+: "View" button (ghost variant, ExternalLink icon)
- Keep stat cards at top unchanged
- Loading skeleton: render 3 placeholder cards using `<Skeleton>` with the same card dimensions (rounded-xl, h-[140px])
- Keep empty state message

### Available Invitations (Partner View)

**File:** `apps/agent-portal/src/pages/AvailableInvitations.tsx`

- Replace `<Table>` with stacked `<InvitationCard>` list
- **No status badge** — omit `status` prop (all are pending by definition)
- **No invitee section** — omit all invitee props, which hides the invitee row entirely
- **Right panel simplified:** Event name + venue + capacity type + action button
- **Actions:**
  - Default: "Claim" button (primary variant, prominent)
  - Just claimed: "Copy Link" button (outline variant)
- **State management:** Keep existing `justClaimed` local state pattern — when an invitation is claimed, the page updates the button to "Copy Link" optimistically without re-fetching
- Keep stat cards at top unchanged

### My Claimed Invitations (Partner View)

**File:** `apps/agent-portal/src/pages/MyClaimedInvitations.tsx`

- Replace `<Table>` with stacked `<InvitationCard>` list
- **Status badge:** Shown on all cards
- **Invitee section:** Shows invitee name or "Not registered"
- **Actions:**
  - Pending: "Copy Link" button (ghost variant)
  - Registered+: No actions (view only)
- Keep stat cards at top unchanged

### PDF Invitation Cards (Admin Print)

**File:** `apps/admin-portal/src/utils/pdfGenerator.ts`

- Redesign A6 landscape card to match Split Panel layout using jsPDF drawing
- **Left panel:** Gradient rectangle with RACC Agency, date, time (drawn with jsPDF color fills)
- **Right panel:** Event name, venue, invitee greeting, registration URL, ref token
- **No action buttons** (print format)
- **Additional print elements:** Registration URL text + "Ref: {token}" at bottom right
- **PDF RGB color values** (jsPDF uses RGB, not CMYK):

| Element | RGB Value |
|---------|-----------|
| Left panel dark | `(15, 23, 42)` — #0F172A |
| Left panel light | `(3, 105, 161)` — #0369A1 |
| Gold text | `(218, 165, 32)` — #DAA520 |
| Dark text | `(15, 23, 42)` — #0F172A |
| Muted text | `(100, 116, 139)` — #64748B |
| Divider | `(226, 232, 240)` — #E2E8F0 |

- Since jsPDF cannot render CSS gradients, use a solid dark navy `(15, 23, 42)` for the left panel background

## Responsive Behavior

- **Desktop (>768px):** Left panel `w-[120px]`, right panel `flex-1`
- **Mobile (<768px):** Left panel `w-[100px]`, font size reductions:
  - Day number: 24px → 20px (`text-xl` → `text-lg`)
  - Month/year: 11px → 10px (`text-[11px]` → `text-[10px]`)
  - Right panel padding: 16px → 12px (`p-4` → `p-3`)
  - Event name: 14px → 13px (`text-sm` unchanged, natural scaling)
- Cards remain horizontal at all widths — the left panel is narrow enough to work on mobile

### Text Overflow

- Event name: truncate with ellipsis after 2 lines (`line-clamp-2`)
- Venue: truncate with ellipsis after 1 line (`truncate`)

## Accessibility

- Card uses `role="article"` for semantic grouping
- Status badges have `aria-label` with full status text
- Action buttons have clear `aria-label` descriptions
- Sufficient color contrast ratios maintained (gold on dark passes WCAG AA)
- Focus ring on interactive elements within cards

## Implementation Notes

- Use Tailwind CSS classes where possible, inline styles for gradient only
- The InvitationCard is a presentational component — it receives pre-formatted data, no data fetching
- Date formatting uses `date-fns` (already in project dependencies)
- The component lives in shared-ui so it can be used by both agent-portal pages and potentially admin-portal in the future
- PDF generation uses jsPDF drawing primitives (rect, text, setFillColor) to approximate the card design — it won't be pixel-identical to the React component but will have the same visual structure
