# Invitation Card UI Redesign Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace bland table-based invitation displays with visually appealing Split Panel invitation cards across all Agent Portal pages and the PDF generator.

**Architecture:** Create a shared `InvitationCard` presentational component in `shared-ui` that renders the Split Panel layout (gradient left date panel + white right content panel). Each Agent Portal page replaces its `<Table>` with a stacked list of `<InvitationCard>` instances, passing pre-formatted props. The PDF generator is rewritten to draw the same Split Panel layout using jsPDF primitives.

**Tech Stack:** React 18, TypeScript, Tailwind CSS, shadcn/ui Badge, date-fns, jsPDF

---

## Chunk 1: Shared Component + Agent Portal Pages

### Task 1: Create InvitationCard Component and Export from shared-ui

**Files:**
- Create: `packages/shared-ui/src/components/ui/invitation-card.tsx`
- Modify: `packages/shared-ui/src/index.ts`

**Reference:** Spec section "Component Design" — props interface, visual layout, left/right panel specs, responsive behavior, accessibility.

- [ ] **Step 1: Create the InvitationCard component**

Create `packages/shared-ui/src/components/ui/invitation-card.tsx`:

```tsx
import * as React from 'react';
import { cn } from '../../lib/utils';
import { Badge, getStatusVariant } from './badge';

export interface InvitationCardProps {
  /** Event/campaign name */
  eventName: string;
  /** Event venue */
  venue: string;
  /** Parsed slot start date — caller uses parseISO(slot.start_at) */
  date: Date;
  /** Pre-formatted start time — caller uses format(parseISO(slot.start_at), 'HH:mm') */
  startTime: string;
  /** Pre-formatted end time — optional, used in PDF context */
  endTime?: string;

  /**
   * Invitee name. Pass `null` to show "Not registered" text.
   * Omit entirely (undefined) to hide the invitee label row.
   */
  inviteeName?: string | null;
  /** Capacity type — displayed as formatted label */
  inviteeType?: 'agent' | 'business_partner';
  /** Invitation status — when omitted, badge is hidden */
  status?: string;

  /** Action buttons rendered in bottom-right of right panel */
  actions?: React.ReactNode;
  className?: string;
}

export function InvitationCard({
  eventName,
  venue,
  date,
  startTime,
  endTime,
  inviteeName,
  inviteeType,
  status,
  actions,
  className,
}: InvitationCardProps) {
  const day = date.getDate();
  const month = date.toLocaleString('en', { month: 'short' }).toUpperCase();
  const year = date.getFullYear();

  // Show bottom row when there's any content to render below the divider
  const hasBottomRow =
    inviteeName !== undefined || inviteeType !== undefined || actions !== undefined;

  return (
    <div
      role="article"
      className={cn(
        'flex rounded-xl overflow-hidden bg-white',
        'shadow-[0_2px_12px_rgba(0,0,0,0.08)]',
        'hover:shadow-[0_4px_20px_rgba(0,0,0,0.12)] hover:-translate-y-px',
        'transition-all duration-200',
        className,
      )}
    >
      {/* Left Panel — gradient date display */}
      <div
        className="w-[100px] md:w-[120px] flex-shrink-0 flex flex-col justify-between p-4"
        style={{ background: 'linear-gradient(135deg, #0F172A, #0369A1)' }}
      >
        <div>
          <div
            className="text-[8px] font-semibold uppercase tracking-[1px]"
            style={{ color: '#DAA520' }}
          >
            RACC Agency
          </div>
          <div className="text-[8px] text-white/60">Event Invitation</div>
        </div>
        <div>
          <div className="text-xl md:text-2xl font-extrabold text-white leading-none">
            {day}
          </div>
          <div className="text-[10px] md:text-[11px] font-semibold text-white/80">
            {month} {year}
          </div>
          <div className="text-[10px] text-white/60 mt-0.5">
            {startTime}
            {endTime ? ` - ${endTime}` : ''}
          </div>
        </div>
      </div>

      {/* Right Panel — event details + invitee + actions */}
      <div className="flex-1 p-3 md:p-4 flex flex-col justify-between min-w-0">
        {/* Header: event name + status badge */}
        <div>
          <div className="flex justify-between items-start gap-2">
            <h3 className="text-sm font-bold text-slate-900 line-clamp-2">
              {eventName}
            </h3>
            {status && (
              <Badge
                variant={getStatusVariant(status)}
                aria-label={`Status: ${status}`}
                className="flex-shrink-0 capitalize"
              >
                {status}
              </Badge>
            )}
          </div>
          <p className="text-[10px] text-slate-500 mt-1 truncate">
            📍 {venue}
          </p>
        </div>

        {/* Bottom row: invitee info + capacity type + actions */}
        {hasBottomRow && (
          <>
            <div className="border-t border-dashed border-slate-200 my-2" />
            <div className="flex justify-between items-end gap-2">
              {/* Left side: invitee name or capacity type */}
              <div className="min-w-0">
                {inviteeName !== undefined ? (
                  <>
                    <div className="text-[9px] text-slate-400 uppercase">
                      Invitee
                    </div>
                    {inviteeName ? (
                      <div className="text-[11px] font-semibold text-slate-900 truncate">
                        {inviteeName}
                      </div>
                    ) : (
                      <div className="text-[11px] text-slate-400 italic">
                        Not registered
                      </div>
                    )}
                  </>
                ) : inviteeType ? (
                  <span className="text-[10px] text-slate-500 capitalize">
                    {inviteeType.replace('_', ' ')}
                  </span>
                ) : null}
              </div>

              {/* Right side: capacity type (when invitee shown) + actions */}
              <div className="flex items-center gap-2 flex-shrink-0">
                {inviteeName !== undefined && inviteeType && (
                  <span className="text-[9px] text-slate-500 capitalize hidden sm:inline">
                    {inviteeType.replace('_', ' ')}
                  </span>
                )}
                {actions}
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Export from shared-ui index.ts**

Add after the `DropdownMenu` exports block (around line 109) in `packages/shared-ui/src/index.ts`:

```typescript
export { InvitationCard } from './components/ui/invitation-card';
export type { InvitationCardProps } from './components/ui/invitation-card';
```

- [ ] **Step 3: Verify typecheck passes**

Run: `pnpm -r typecheck`
Expected: No errors related to invitation-card

- [ ] **Step 4: Commit**

```bash
git add packages/shared-ui/src/components/ui/invitation-card.tsx packages/shared-ui/src/index.ts
git commit -m "feat(shared-ui): add InvitationCard split-panel component"
```

---

### Task 2: Replace Table with InvitationCards in Invitations.tsx (Agent View)

**Files:**
- Modify: `apps/agent-portal/src/pages/Invitations.tsx`

**Depends on:** Task 1

**Reference:** Spec section "My Invitations (Agent View)"

**What changes:**
- Remove Table/TableHeader/TableBody/TableHead/TableRow/TableCell/TableSkeleton imports
- Add InvitationCard import
- Add Skeleton import (for loading state)
- Replace `<Table>` block with stacked `<InvitationCard>` list
- Keep all existing logic: stat cards, handleCopy, status counts, copiedId state

- [ ] **Step 1: Update imports**

In `apps/agent-portal/src/pages/Invitations.tsx`, replace the import block:

```typescript
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Button,
  Badge,
  getStatusVariant,
  StatCard,
  StatCardGrid,
  Skeleton,
  InvitationCard,
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@agent-system/shared-ui';
import { Copy, Check, ExternalLink, Send, UserCheck, CheckCircle } from 'lucide-react';
import { useState } from 'react';
import { format, parseISO } from 'date-fns';
import { useAuth } from '../hooks/useAuth';
import { useMyInvitations } from '../hooks/useInvitations';
import { InvitationStatus } from '@agent-system/shared-types';
```

Note: `Table`, `TableBody`, `TableCell`, `TableHead`, `TableHeader`, `TableRow`, `TableSkeleton` are removed. `Skeleton` and `InvitationCard` are added.

- [ ] **Step 2: Replace the CardContent rendering**

Replace the `<CardContent>` block (the loading/empty/table section inside the Card) with:

```tsx
<CardContent>
  {isLoading ? (
    <div className="space-y-3">
      {Array.from({ length: 3 }).map((_, i) => (
        <Skeleton key={i} className="h-[140px] w-full rounded-xl" />
      ))}
    </div>
  ) : invitations?.length === 0 ? (
    <p className="text-slate-500">No invitations yet. Browse events to create invitation links.</p>
  ) : (
    <TooltipProvider>
      <div className="space-y-3">
        {invitations?.map((invitation) => (
          <InvitationCard
            key={invitation.id}
            eventName={invitation.slot?.campaign?.name ?? 'Unknown Event'}
            venue={invitation.slot?.campaign?.venue ?? '-'}
            date={invitation.slot ? parseISO(invitation.slot.start_at) : new Date()}
            startTime={invitation.slot ? format(parseISO(invitation.slot.start_at), 'HH:mm') : '-'}
            inviteeName={invitation.invitee_name}
            inviteeType={invitation.capacity_type}
            status={invitation.status}
            actions={
              <div className="flex items-center gap-1">
                {invitation.status === InvitationStatus.PENDING && (
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-8 w-8 p-0"
                        onClick={() => handleCopy(invitation.unique_token, invitation.id)}
                        aria-label="Copy invitation link"
                      >
                        {copiedId === invitation.id ? (
                          <Check className="h-4 w-4 text-emerald-600" />
                        ) : (
                          <Copy className="h-4 w-4" />
                        )}
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>
                      {copiedId === invitation.id ? 'Link copied!' : 'Copy invitation link'}
                    </TooltipContent>
                  </Tooltip>
                )}
                {invitation.invitee_name && (
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-8 w-8 p-0"
                        aria-label="View invitee details"
                      >
                        <ExternalLink className="h-4 w-4" />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>View invitee details</TooltipContent>
                  </Tooltip>
                )}
              </div>
            }
          />
        ))}
      </div>
    </TooltipProvider>
  )}
</CardContent>
```

- [ ] **Step 3: Verify typecheck passes**

Run: `pnpm -r typecheck`
Expected: No errors in Invitations.tsx

- [ ] **Step 4: Commit**

```bash
git add apps/agent-portal/src/pages/Invitations.tsx
git commit -m "feat(agent-portal): replace invitation table with split-panel cards"
```

---

### Task 3: Replace Table with InvitationCards in AvailableInvitations.tsx (Partner View)

**Files:**
- Modify: `apps/agent-portal/src/pages/AvailableInvitations.tsx`

**Depends on:** Task 1

**Reference:** Spec section "Available Invitations (Partner View)" — no status badge, no invitee section, Claim/Copy actions, keep justClaimed state pattern.

**What changes:**
- Remove Table-related imports
- Add InvitationCard, Skeleton imports
- Replace `<Table>` block with stacked cards
- Keep all existing logic: handleClaim, handleCopy, justClaimed state, claimingId state

- [ ] **Step 1: Update imports**

In `apps/agent-portal/src/pages/AvailableInvitations.tsx`, replace the import block:

```typescript
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Button,
  StatCard,
  StatCardGrid,
  Skeleton,
  InvitationCard,
  useToast,
} from '@agent-system/shared-ui';
import { Send, CheckSquare, Copy, Check } from 'lucide-react';
import { useState } from 'react';
import { format, parseISO } from 'date-fns';
import { useAuth } from '../hooks/useAuth';
import { useAvailableInvitations, useMyClaimedInvitations, useClaimInvitation } from '../hooks/usePartnerInvitations';
```

Note: `Table*`, `TableSkeleton` removed. `Skeleton`, `InvitationCard` added. `date-fns` imports kept.

- [ ] **Step 2: Replace the CardContent rendering**

Replace the `<CardContent>` block with:

```tsx
<CardContent>
  {isLoading ? (
    <div className="space-y-3">
      {Array.from({ length: 3 }).map((_, i) => (
        <Skeleton key={i} className="h-[120px] w-full rounded-xl" />
      ))}
    </div>
  ) : available?.length === 0 ? (
    <p className="text-slate-500">No unclaimed invitations available right now.</p>
  ) : (
    <div className="space-y-3">
      {available?.map((inv) => (
        <InvitationCard
          key={inv.id}
          eventName={inv.slot?.campaign?.name ?? 'Unknown Event'}
          venue={inv.slot?.campaign?.venue ?? '-'}
          date={inv.slot ? parseISO(inv.slot.start_at) : new Date()}
          startTime={inv.slot ? format(parseISO(inv.slot.start_at), 'HH:mm') : '-'}
          inviteeType={inv.capacity_type}
          actions={
            justClaimed[inv.id] ? (
              <Button
                variant="outline"
                size="sm"
                onClick={() => handleCopy(justClaimed[inv.id], inv.id)}
              >
                {copiedId === inv.id ? (
                  <><Check className="h-4 w-4 mr-1 text-emerald-600" /> Copied!</>
                ) : (
                  <><Copy className="h-4 w-4 mr-1" /> Copy Link</>
                )}
              </Button>
            ) : (
              <Button
                size="sm"
                onClick={() => handleClaim(inv.id, inv.unique_token)}
                disabled={claimingId === inv.id}
                className="bg-slate-900 hover:bg-slate-800"
              >
                {claimingId === inv.id ? 'Claiming...' : 'Claim'}
              </Button>
            )
          }
        />
      ))}
    </div>
  )}
</CardContent>
```

Note: `inviteeName` and `status` are intentionally omitted — this hides the invitee row and status badge. `inviteeType` is passed so the capacity type shows in the simplified bottom row.

- [ ] **Step 3: Verify typecheck passes**

Run: `pnpm -r typecheck`
Expected: No errors in AvailableInvitations.tsx

- [ ] **Step 4: Commit**

```bash
git add apps/agent-portal/src/pages/AvailableInvitations.tsx
git commit -m "feat(agent-portal): replace available invitations table with split-panel cards"
```

---

### Task 4: Replace Table with InvitationCards in MyClaimedInvitations.tsx (Partner View)

**Files:**
- Modify: `apps/agent-portal/src/pages/MyClaimedInvitations.tsx`

**Depends on:** Task 1

**Reference:** Spec section "My Claimed Invitations (Partner View)" — shows status badge, shows invitee section, Copy Link for pending only.

**What changes:**
- Remove Table-related imports
- Add InvitationCard, Skeleton imports
- Replace `<Table>` block with stacked cards
- Keep all existing logic: handleCopy, copiedId state, status counts

- [ ] **Step 1: Update imports**

In `apps/agent-portal/src/pages/MyClaimedInvitations.tsx`, replace the import block:

```typescript
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Button,
  Badge,
  getStatusVariant,
  StatCard,
  StatCardGrid,
  Skeleton,
  InvitationCard,
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@agent-system/shared-ui';
import { Copy, Check, Send, UserCheck, CheckCircle } from 'lucide-react';
import { useState } from 'react';
import { format, parseISO } from 'date-fns';
import { useAuth } from '../hooks/useAuth';
import { useMyClaimedInvitations } from '../hooks/usePartnerInvitations';
import { InvitationStatus } from '@agent-system/shared-types';
```

Note: `Table*`, `TableSkeleton` removed. `Skeleton`, `InvitationCard` added. `Badge` and `getStatusVariant` kept (used by InvitationCard internally but imported here as they were before — the component uses them internally so these imports can actually be removed, but keeping them is harmless).

Actually — `Badge` and `getStatusVariant` are NOT needed in this file anymore since InvitationCard handles badge rendering internally. Remove them from the import. Updated import:

```typescript
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Button,
  StatCard,
  StatCardGrid,
  Skeleton,
  InvitationCard,
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@agent-system/shared-ui';
import { Copy, Check, Send, UserCheck, CheckCircle } from 'lucide-react';
import { useState } from 'react';
import { format, parseISO } from 'date-fns';
import { useAuth } from '../hooks/useAuth';
import { useMyClaimedInvitations } from '../hooks/usePartnerInvitations';
import { InvitationStatus } from '@agent-system/shared-types';
```

- [ ] **Step 2: Replace the CardContent rendering**

Replace the `<CardContent>` block with:

```tsx
<CardContent>
  {isLoading ? (
    <div className="space-y-3">
      {Array.from({ length: 3 }).map((_, i) => (
        <Skeleton key={i} className="h-[140px] w-full rounded-xl" />
      ))}
    </div>
  ) : invitations?.length === 0 ? (
    <p className="text-slate-500">No claimed invitations yet. Browse available invitations to claim some.</p>
  ) : (
    <TooltipProvider>
      <div className="space-y-3">
        {invitations?.map((inv) => (
          <InvitationCard
            key={inv.id}
            eventName={inv.slot?.campaign?.name ?? 'Unknown Event'}
            venue={inv.slot?.campaign?.venue ?? '-'}
            date={inv.slot ? parseISO(inv.slot.start_at) : new Date()}
            startTime={inv.slot ? format(parseISO(inv.slot.start_at), 'HH:mm') : '-'}
            inviteeName={inv.invitee_name}
            inviteeType={inv.capacity_type}
            status={inv.status}
            actions={
              inv.status === InvitationStatus.PENDING ? (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-8 w-8 p-0"
                      onClick={() => handleCopy(inv.unique_token, inv.id)}
                      aria-label="Copy invitation link"
                    >
                      {copiedId === inv.id ? (
                        <Check className="h-4 w-4 text-emerald-600" />
                      ) : (
                        <Copy className="h-4 w-4" />
                      )}
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>
                    {copiedId === inv.id ? 'Link copied!' : 'Copy invitation link'}
                  </TooltipContent>
                </Tooltip>
              ) : undefined
            }
          />
        ))}
      </div>
    </TooltipProvider>
  )}
</CardContent>
```

- [ ] **Step 3: Verify typecheck passes**

Run: `pnpm -r typecheck`
Expected: No errors in MyClaimedInvitations.tsx

- [ ] **Step 4: Commit**

```bash
git add apps/agent-portal/src/pages/MyClaimedInvitations.tsx
git commit -m "feat(agent-portal): replace claimed invitations table with split-panel cards"
```

---

## Chunk 2: PDF Generator Redesign

### Task 5: Redesign PDF Invitation Card to Split Panel Layout

**Files:**
- Modify: `apps/admin-portal/src/utils/pdfGenerator.ts`
- Modify: `apps/admin-portal/src/pages/PdfExport.tsx` (caller — add `slotDate` field)

**Depends on:** None (independent of Tasks 1-4)

**Reference:** Spec section "PDF Invitation Cards (Admin Print)" — A6 landscape, solid navy left panel (jsPDF can't do gradients), gold RACC Agency text, event details on right, registration URL + ref token.

**What changes:**
- Add `slotDate: string` (ISO datetime) field to `InvitationCardData` interface — used to extract day number and month/year for left panel
- Rewrite `generateInvitationCard()` to draw the Split Panel layout
- Extract shared drawing logic into a `drawInvitationCard()` helper (DRY — used by both single and bulk)
- Rewrite `generateBulkInvitationCards()` to use the helper
- Keep `PinSheetData`, `generatePinSheet()`, `formatSlotDate()`, `formatTime()` unchanged
- Update any callers of `generateInvitationCard` / `generateBulkInvitationCards` to pass `slotDate`

**RGB color reference (from spec):**

| Element | R | G | B |
|---------|---|---|---|
| Left panel (navy) | 15 | 23 | 42 |
| Gold text | 218 | 165 | 32 |
| Dark text | 15 | 23 | 42 |
| Muted text | 100 | 116 | 139 |
| Divider line | 226 | 232 | 240 |
| White | 255 | 255 | 255 |
| Light bg | 248 | 250 | 252 |

- [ ] **Step 1: Update InvitationCardData interface**

In `apps/admin-portal/src/utils/pdfGenerator.ts`, add `slotDate` to the interface:

```typescript
interface InvitationCardData {
  inviteeName: string;
  campaignName: string;
  venue: string;
  dayOfWeek: string;
  slotDate: string;      // ISO datetime string e.g., "2026-03-15T09:00:00+00:00"
  startTime: string;
  endTime: string;
  uniqueToken: string;
  registrationUrl: string;
}
```

- [ ] **Step 2: Add the drawInvitationCard helper function**

Add this function ABOVE `generateInvitationCard` in `apps/admin-portal/src/utils/pdfGenerator.ts`:

```typescript
/**
 * Draw a single Split Panel invitation card on the current jsPDF page.
 * Matches the RACC Agency brand: navy left panel with date, white right panel with details.
 */
function drawInvitationCard(doc: jsPDF, data: InvitationCardData): void {
  const pageW = 148;
  const pageH = 105;
  const leftW = 40; // Left panel width in mm

  // Parse slot date for left panel display
  const slotDate = new Date(data.slotDate);
  const dayNum = slotDate.getDate().toString();
  const monthYear = slotDate.toLocaleString('en', { month: 'short' }).toUpperCase() + ' ' + slotDate.getFullYear();

  // --- Page background ---
  doc.setFillColor(248, 250, 252);
  doc.rect(0, 0, pageW, pageH, 'F');

  // --- Left Panel (solid navy — jsPDF can't render gradients) ---
  doc.setFillColor(15, 23, 42);
  doc.rect(0, 0, leftW, pageH, 'F');

  // RACC Agency label (gold)
  doc.setTextColor(218, 165, 32);
  doc.setFontSize(7);
  doc.setFont('helvetica', 'bold');
  doc.text('RACC AGENCY', leftW / 2, 12, { align: 'center' });

  // "Event Invitation" subtitle
  doc.setTextColor(255, 255, 255);
  doc.setFontSize(6);
  doc.setFont('helvetica', 'normal');
  doc.text('Event Invitation', leftW / 2, 18, { align: 'center' });

  // Date display — large day number (matches React component left panel)
  doc.setTextColor(255, 255, 255);
  doc.setFontSize(22);
  doc.setFont('helvetica', 'bold');
  doc.text(dayNum, leftW / 2, 55, { align: 'center' });

  // Month + Year
  doc.setFontSize(9);
  doc.setFont('helvetica', 'bold');
  doc.text(monthYear, leftW / 2, 63, { align: 'center' });

  // Time
  doc.setFontSize(8);
  doc.setFont('helvetica', 'normal');
  doc.text(`${data.startTime} - ${data.endTime}`, leftW / 2, 70, { align: 'center' });

  // --- Right Panel ---
  const rightX = leftW + 5;
  const rightW = pageW - leftW - 10;

  // Campaign name
  doc.setTextColor(15, 23, 42);
  doc.setFontSize(14);
  doc.setFont('helvetica', 'bold');
  const nameLines = doc.splitTextToSize(data.campaignName, rightW);
  doc.text(nameLines, rightX, 15);
  const nameEndY = 15 + nameLines.length * 6;

  // Venue
  doc.setTextColor(100, 116, 139);
  doc.setFontSize(9);
  doc.setFont('helvetica', 'normal');
  doc.text(data.venue, rightX, nameEndY + 4);

  // Dashed divider
  const dividerY = nameEndY + 10;
  doc.setDrawColor(226, 232, 240);
  doc.setLineDashPattern([1, 1], 0);
  doc.line(rightX, dividerY, rightX + rightW, dividerY);
  doc.setLineDashPattern([], 0); // Reset dash

  // Invitee section
  doc.setTextColor(148, 163, 184);
  doc.setFontSize(7);
  doc.text('INVITEE', rightX, dividerY + 7);

  doc.setTextColor(15, 23, 42);
  doc.setFontSize(11);
  doc.setFont('helvetica', 'bold');
  doc.text(data.inviteeName, rightX, dividerY + 14);

  // Registration instructions
  doc.setTextColor(100, 116, 139);
  doc.setFontSize(8);
  doc.setFont('helvetica', 'normal');
  doc.text('Register using your unique link:', rightX, dividerY + 24);

  // Registration URL
  doc.setTextColor(3, 105, 161); // Sky blue for links
  doc.setFontSize(7);
  const shortUrl =
    data.registrationUrl.length > 55
      ? data.registrationUrl.substring(0, 52) + '...'
      : data.registrationUrl;
  doc.text(shortUrl, rightX, dividerY + 30);

  // Token reference (bottom right)
  doc.setTextColor(148, 163, 184);
  doc.setFontSize(6);
  doc.text(
    `Ref: ${data.uniqueToken.substring(0, 8)}...`,
    pageW - 5,
    pageH - 5,
    { align: 'right' },
  );
}
```

- [ ] **Step 2: Rewrite generateInvitationCard to use the helper**

Replace the existing `generateInvitationCard` function body:

```typescript
export function generateInvitationCard(data: InvitationCardData): jsPDF {
  const doc = new jsPDF({
    orientation: 'landscape',
    unit: 'mm',
    format: [148, 105], // A6 landscape
  });

  drawInvitationCard(doc, data);
  return doc;
}
```

- [ ] **Step 3: Rewrite generateBulkInvitationCards to use the helper**

Replace the existing `generateBulkInvitationCards` function body:

```typescript
export function generateBulkInvitationCards(invitations: InvitationCardData[]): jsPDF {
  const doc = new jsPDF({
    orientation: 'landscape',
    unit: 'mm',
    format: [148, 105],
  });

  invitations.forEach((invitation, index) => {
    if (index > 0) {
      doc.addPage([148, 105], 'landscape');
    }
    drawInvitationCard(doc, invitation);
  });

  return doc;
}
```

- [ ] **Step 4: Update PdfExport.tsx caller to pass slotDate**

In `apps/admin-portal/src/pages/PdfExport.tsx`, find the `invitationData` mapping in `handleGenerateInvitationCards` (around line 143). Add `slotDate: inv.slot.start_at` to the object:

```typescript
const invitationData = invitations.map((inv) => ({
  inviteeName: inv.invitee_name || 'Guest',
  campaignName: inv.slot.campaign.name,
  venue: inv.slot.campaign.venue,
  dayOfWeek: format(parseISO(inv.slot.start_at), 'EEE'),
  slotDate: inv.slot.start_at,
  startTime: format(parseISO(inv.slot.start_at), 'HH:mm'),
  endTime: format(parseISO(inv.slot.end_at), 'HH:mm'),
  uniqueToken: inv.unique_token,
  registrationUrl: `${publicPagesUrl}/public/register/${inv.unique_token}`,
}));
```

- [ ] **Step 5: Verify typecheck passes**

Run: `pnpm -r typecheck`
Expected: No errors in pdfGenerator.ts or PdfExport.tsx

- [ ] **Step 6: Commit**

```bash
git add apps/admin-portal/src/utils/pdfGenerator.ts apps/admin-portal/src/pages/PdfExport.tsx
git commit -m "feat(admin): redesign PDF invitation cards to split-panel layout"
```

---

## Task Dependency Graph

```
Task 1 (InvitationCard component)
  ├── Task 2 (Invitations.tsx)      — can run in parallel
  ├── Task 3 (AvailableInvitations) — can run in parallel
  └── Task 4 (MyClaimedInvitations) — can run in parallel

Task 5 (PDF generator) — fully independent, can run in parallel with Tasks 1-4
```

**Parallelization:** Tasks 2, 3, 4 can all run in parallel after Task 1 completes. Task 5 is independent and can run anytime.

## Final Verification

After all tasks complete:

- [ ] Run `pnpm -r typecheck` — should pass with zero errors
- [ ] Run `pnpm lint` — should pass
- [ ] Visually verify each page in browser:
  - Agent Portal → My Invitations: cards with status badges, copy/view actions
  - Agent Portal → Available Invitations (as partner): cards with Claim button, no status/invitee
  - Agent Portal → My Claimed Invitations (as partner): cards with status, copy link for pending
- [ ] Test PDF generation from Admin Portal → verify Split Panel layout on printed cards
