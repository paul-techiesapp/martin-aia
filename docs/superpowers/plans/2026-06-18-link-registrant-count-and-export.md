# Per-Link Registrant Count + Excel Export Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** On the "My Active Links" cards, show a per-link "N registered" count, add a per-link button that downloads that link's registrants as Excel (.xlsx), and hide links whose event has already ended — in both the agent (`MyLinks`) and business-partner (`PartnerLinks`) views.

**Architecture:** Purely additive frontend change. The count already rides on each link (`registration_count` from `useMyLinks`/`usePartnerLinks`), so it just needs surfacing via a new `InvitationCard` prop. The export is a new shared-ui util (`generateRegistrantsWorkbook`) that dynamic-imports `write-excel-file`, invoked by a new per-card button that lazily queries the link's registrants on click. Past events are removed with a client-side filter on slot `end_at`. No database, RLS, or data-fetching-hook changes.

**Tech Stack:** React 18 + TypeScript + Vite, TanStack Query, Supabase JS client, `date-fns`, `lucide-react`, new dep `write-excel-file`. pnpm workspaces (`@agent-system/shared-ui`, `agent-portal`).

## Global Constraints

- Spec: `docs/superpowers/specs/2026-06-18-link-registrant-count-and-export-design.md`.
- No schema, RLS, or migration changes. No changes to `useAgentLinks.ts` hooks.
- "Registered" count = `link.registration_count` (all statuses), already populated.
- Export columns, in this exact order: **Name, NRIC / MyKad, Phone, Email, Occupation, Status, Registered At**.
- `registered_at` formatted as `d MMM yyyy, HH:mm` (blank when null).
- Filename: `{CAMPAIGN}-{yyyy-MM-dd}-registrants.xlsx`, sanitized (non-alphanumerics → `-`, uppercased campaign part).
- Excel library: `write-excel-file`, **dynamic-imported** inside the util (keep it out of the main bundle).
- Excel button uses lucide `FileSpreadsheet`; the existing PDF button (lucide `FileDown`, "Download invitation cards") is unchanged and must remain distinct.
- Wording is "registered" (matches the portal's existing stat cards and slot list), not "joined".
- "My Active Links" shows a link only while its slot has **not ended**: keep when `!l.slot || parseISO(l.slot.end_at) >= now` (`now = new Date()`). The rest of each page keeps using the full `links` list (so the slot-list `getExistingLink` logic is unaffected).
- No automated test runner exists for this UI; verification = `pnpm -r typecheck`, `pnpm --filter <pkg> build`, `pnpm lint`, and manual checks.
- Respect the repo rule: do not commit without the user's go-ahead; the commit step in each task is the natural commit boundary, run it when the user approves the task.

---

### Task 1: Excel export util + dependency in shared-ui

Adds the `write-excel-file` dependency and a single, reusable workbook generator. This is the foundation both pages consume.

**Files:**
- Modify: `packages/shared-ui/package.json` (add dependency)
- Create: `packages/shared-ui/src/utils/excelGenerator.ts`
- Modify: `packages/shared-ui/src/index.ts` (export the util + types)

**Interfaces:**
- Consumes: nothing (leaf module).
- Produces (relied on by Tasks 3 & 4):
  - `interface RegistrantRow { invitee_name: string | null; invitee_nric: string | null; invitee_phone: string | null; invitee_email: string | null; invitee_occupation: string | null; status: string | null; registered_at: string | null; }`
  - `interface RegistrantsWorkbookMeta { campaignName: string; slotDate: string; }`
  - `function generateRegistrantsWorkbook(rows: RegistrantRow[], meta: RegistrantsWorkbookMeta): Promise<void>`

- [ ] **Step 1: Add the dependency**

Run (from repo root):

```bash
pnpm --filter @agent-system/shared-ui add write-excel-file
```

Expected: `write-excel-file` appears under `dependencies` in `packages/shared-ui/package.json` and the lockfile updates. (If the registry is unreachable, manually add `"write-excel-file": "^2.3.2"` to `packages/shared-ui/package.json` dependencies and run `pnpm install`.)

- [ ] **Step 2: Create the util**

Create `packages/shared-ui/src/utils/excelGenerator.ts` with exactly:

```ts
import { format, parseISO } from 'date-fns';
import type { Schema } from 'write-excel-file';

/** A single registrant row as selected from the `registrations` table. */
export interface RegistrantRow {
  invitee_name: string | null;
  invitee_nric: string | null;
  invitee_phone: string | null;
  invitee_email: string | null;
  invitee_occupation: string | null;
  status: string | null;
  registered_at: string | null;
}

/** Event metadata used to build the download filename. */
export interface RegistrantsWorkbookMeta {
  /** Campaign/event name, e.g. "BOP - JUNE". */
  campaignName: string;
  /** Slot start as an ISO timestamp string. */
  slotDate: string;
}

function sanitizeFilePart(value: string): string {
  return value
    .trim()
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toUpperCase();
}

/**
 * Builds and triggers a browser download of an .xlsx file listing the given
 * registrants. `write-excel-file` is dynamic-imported so it is code-split out
 * of the app's main bundle.
 */
export async function generateRegistrantsWorkbook(
  rows: RegistrantRow[],
  meta: RegistrantsWorkbookMeta,
): Promise<void> {
  const { default: writeXlsxFile } = await import('write-excel-file');

  const schema: Schema<RegistrantRow> = [
    { column: 'Name', type: String, width: 24, value: (r) => r.invitee_name ?? '' },
    { column: 'NRIC / MyKad', type: String, width: 16, value: (r) => r.invitee_nric ?? '' },
    { column: 'Phone', type: String, width: 16, value: (r) => r.invitee_phone ?? '' },
    { column: 'Email', type: String, width: 28, value: (r) => r.invitee_email ?? '' },
    { column: 'Occupation', type: String, width: 20, value: (r) => r.invitee_occupation ?? '' },
    { column: 'Status', type: String, width: 14, value: (r) => r.status ?? '' },
    {
      column: 'Registered At',
      type: String,
      width: 20,
      value: (r) =>
        r.registered_at ? format(parseISO(r.registered_at), 'd MMM yyyy, HH:mm') : '',
    },
  ];

  const datePart = meta.slotDate ? format(parseISO(meta.slotDate), 'yyyy-MM-dd') : '';
  const fileName =
    [sanitizeFilePart(meta.campaignName), datePart, 'registrants']
      .filter(Boolean)
      .join('-') + '.xlsx';

  await writeXlsxFile(rows, {
    schema,
    headerStyle: { fontWeight: 'bold' },
    fileName,
  });
}
```

- [ ] **Step 3: Export from the package index**

In `packages/shared-ui/src/index.ts`, find the PDF generation export block (around the line `export { generateInvitationCard, generateBulkInvitationCards, formatSlotDate, formatTime } from './utils/pdfGenerator';`). Directly below it add:

```ts
// Excel Generation
export { generateRegistrantsWorkbook } from './utils/excelGenerator';
export type { RegistrantRow, RegistrantsWorkbookMeta } from './utils/excelGenerator';
```

- [ ] **Step 4: Typecheck + build shared-ui**

Run:

```bash
pnpm --filter @agent-system/shared-ui typecheck && pnpm --filter @agent-system/shared-ui build
```

Expected: both succeed with no errors. If `write-excel-file` does not expose a `Schema` type under that import, change the type import to `import writeXlsxFile, { type Schema } from 'write-excel-file'` and replace the dynamic `await import(...)` with the top-level `writeXlsxFile` (accepting that it then ships in the main bundle). Prefer keeping the dynamic import and only adjusting the type import if possible.

- [ ] **Step 5: Commit**

```bash
git add packages/shared-ui/package.json packages/shared-ui/src/utils/excelGenerator.ts packages/shared-ui/src/index.ts pnpm-lock.yaml
git commit -m "feat(shared-ui): add generateRegistrantsWorkbook xlsx export util"
```

---

### Task 2: `registeredCount` prop on InvitationCard

Surfaces the count that already exists on each link. Self-contained — a reviewer can accept this independently of the export work.

**Files:**
- Modify: `packages/shared-ui/src/components/ui/invitation-card.tsx`

**Interfaces:**
- Consumes: nothing new.
- Produces (relied on by Tasks 3 & 4): `InvitationCardProps.registeredCount?: number`.

- [ ] **Step 1: Import the icon**

At the top of `packages/shared-ui/src/components/ui/invitation-card.tsx`, below the existing imports (after `import { Badge, getStatusVariant } from './badge';`), add:

```ts
import { Users } from 'lucide-react';
```

- [ ] **Step 2: Add the prop to the interface**

In `InvitationCardProps`, directly after the `status?: string;` block (before the `companyName` comment), add:

```ts
  /**
   * Number of people registered via this link. When provided (and no single
   * inviteeName is shown), renders a "N registered" label in the bottom row.
   */
  registeredCount?: number;
```

- [ ] **Step 3: Destructure the prop**

In the `InvitationCard` function parameter destructuring, add `registeredCount,` after `status,`:

```ts
export function InvitationCard({
  eventName,
  venue,
  date,
  startTime,
  endTime,
  inviteeName,
  inviteeType,
  status,
  registeredCount,
  companyName,
  logoUrl,
  actions,
  className,
}: InvitationCardProps) {
```

- [ ] **Step 4: Include count in the bottom-row visibility test**

Replace the `hasBottomRow` assignment:

```ts
  const hasBottomRow =
    inviteeName !== undefined || inviteeType !== undefined || actions !== undefined;
```

with:

```ts
  const hasBottomRow =
    inviteeName !== undefined ||
    inviteeType !== undefined ||
    actions !== undefined ||
    registeredCount !== undefined;
```

- [ ] **Step 5: Render the count in the bottom-row left area**

In the bottom-row left `<div className="min-w-0">`, the current content is:

```tsx
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
```

Insert a new branch for `registeredCount` between the `inviteeName` branch and the `inviteeType` branch, so it becomes:

```tsx
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
                ) : registeredCount !== undefined ? (
                  <span className="inline-flex items-center gap-1 text-[11px] font-medium text-slate-600">
                    <Users className="size-3" />
                    {registeredCount} registered
                  </span>
                ) : inviteeType ? (
                  <span className="text-[10px] text-slate-500 capitalize">
                    {inviteeType.replace('_', ' ')}
                  </span>
                ) : null}
```

- [ ] **Step 6: Typecheck + build shared-ui**

Run:

```bash
pnpm --filter @agent-system/shared-ui typecheck && pnpm --filter @agent-system/shared-ui build
```

Expected: both succeed with no errors.

- [ ] **Step 7: Commit**

```bash
git add packages/shared-ui/src/components/ui/invitation-card.tsx
git commit -m "feat(shared-ui): add registeredCount prop to InvitationCard"
```

---

### Task 3: Wire count + Excel export + past-event filter into MyLinks (agent view)

**Files:**
- Modify: `apps/agent-portal/src/pages/MyLinks.tsx`

**Interfaces:**
- Consumes: `generateRegistrantsWorkbook` (Task 1), `InvitationCard.registeredCount` (Task 2).
- Produces: nothing downstream.

- [ ] **Step 1: Add imports**

In `apps/agent-portal/src/pages/MyLinks.tsx`:

(a) Add `FileSpreadsheet` to the existing `lucide-react` import (line 28). It becomes:

```ts
import { Link2, Copy, Check, MapPin, UserCheck, CheckCircle, Users, FileDown, FileSpreadsheet, Loader2 } from 'lucide-react';
```

(b) Add `generateRegistrantsWorkbook` to the shared-ui imports. The file already imports `generateBulkInvitationCards` from `@agent-system/shared-ui` on line 29 — extend it:

```ts
import { generateBulkInvitationCards, generateRegistrantsWorkbook } from '@agent-system/shared-ui';
```

- [ ] **Step 2: Add export-in-progress state**

After the existing `const [downloadingLinkId, setDownloadingLinkId] = useState<string | null>(null);` (line 59), add:

```ts
  const [exportingLinkId, setExportingLinkId] = useState<string | null>(null);
```

- [ ] **Step 3: Add the export handler**

Immediately after the `handleDownloadCards` function (after its closing `};` near line 150), add:

```ts
  const handleExportRegistrants = async (link: NonNullable<typeof links>[number]) => {
    if (!link.slot) return;
    setExportingLinkId(link.id);
    try {
      const { data: regs, error } = await supabase
        .from('registrations')
        .select(
          'invitee_name, invitee_nric, invitee_phone, invitee_email, invitee_occupation, status, registered_at',
        )
        .eq('agent_link_id', link.id)
        .order('registered_at', { ascending: true });

      if (error) throw error;
      if (!regs || regs.length === 0) {
        toast({ title: 'No registrants', description: 'No one has registered via this link yet.', variant: 'error' });
        return;
      }

      await generateRegistrantsWorkbook(regs, {
        campaignName: link.slot.campaign.name,
        slotDate: link.slot.start_at,
      });
      toast({ title: `${regs.length} registrant${regs.length > 1 ? 's' : ''} exported` });
    } catch (err: any) {
      toast({ title: 'Failed to export list', description: err.message, variant: 'error' });
    } finally {
      setExportingLinkId(null);
    }
  };
```

- [ ] **Step 4: Derive the active-only links list**

After the `const isLoading = campaignsLoading || linksLoading || statsLoading;` line (line 152), add:

```ts
  // "My Active Links" lists only links whose event slot has not yet ended.
  const now = new Date();
  const activeLinks = links?.filter((l) => !l.slot || parseISO(l.slot.end_at) >= now);
```

- [ ] **Step 5: Use `activeLinks` in the "My Active Links" block**

In the "My Active Links" card (starts at line 326), make three replacements:

(a) Render guard:

```tsx
      {links && links.length > 0 && (
```

becomes

```tsx
      {activeLinks && activeLinks.length > 0 && (
```

(b) Header count:

```tsx
              {links.length} link{links.length !== 1 ? 's' : ''} created
```

becomes

```tsx
              {activeLinks.length} link{activeLinks.length !== 1 ? 's' : ''} created
```

(c) The map:

```tsx
                {links.map((link) => (
```

becomes

```tsx
                {activeLinks.map((link) => (
```

(Leave every other use of `links` — e.g. `getExistingLink` — untouched.)

- [ ] **Step 6: Pass the count to the card**

In the `<InvitationCard>` inside that block, add the `registeredCount` prop after the `startTime={...}` prop (line 343):

```tsx
                    startTime={link.slot ? format(parseISO(link.slot.start_at), 'HH:mm') : '-'}
                    registeredCount={link.registration_count}
```

- [ ] **Step 7: Add the Excel button to the card actions**

In the same card's `actions` block (the `<div className="flex items-center gap-1">`, line 347), insert this Tooltip as the **first** child, before the existing "Download invitation cards" Tooltip:

```tsx
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Button
                              variant="ghost"
                              size="sm"
                              className="size-8 p-0"
                              onClick={() => handleExportRegistrants(link)}
                              disabled={exportingLinkId === link.id || link.registration_count === 0}
                              aria-label="Download registrant list (Excel)"
                            >
                              {exportingLinkId === link.id ? (
                                <Loader2 className="size-4 animate-spin" />
                              ) : (
                                <FileSpreadsheet className="size-4" />
                              )}
                            </Button>
                          </TooltipTrigger>
                          <TooltipContent>
                            {link.registration_count === 0
                              ? 'No registrants yet'
                              : 'Download registrant list (Excel)'}
                          </TooltipContent>
                        </Tooltip>
```

Note: a disabled trigger may suppress the Radix tooltip; that is acceptable here because the visible "0 registered" label on the card already explains the disabled state.

- [ ] **Step 8: Typecheck + build agent-portal**

Run:

```bash
pnpm --filter agent-portal typecheck && pnpm --filter agent-portal build
```

Expected: both succeed with no errors.

- [ ] **Step 9: Manual verification**

Run `pnpm dev:agent` (the user runs the dev server — ask them to reload if already running). As an agent (`agent@test.com`) with at least one active link:
- Each "My Active Links" card shows "👤 N registered" matching the slot-list count.
- The new spreadsheet icon sits left of the existing download/copy icons; hovering shows "Download registrant list (Excel)".
- Clicking it (when count > 0) downloads `{CAMPAIGN}-{date}-registrants.xlsx`; opening it shows the 7 columns in order with correct data and a bold header row.
- A link with 0 registrants shows "0 registered" and the spreadsheet button is disabled.
- A link whose slot end time is in the past no longer appears in the section; the "N links created" count reflects only the active ones.

- [ ] **Step 10: Commit**

```bash
git add apps/agent-portal/src/pages/MyLinks.tsx
git commit -m "feat(agent-portal): registered count, registrant Excel export, hide past events on My Links"
```

---

### Task 4: Wire count + Excel export + past-event filter into PartnerLinks (business-partner view)

Mirror of Task 3 in the partner page. `PartnerLinks.tsx` is structurally identical (same imports, state, `handleDownloadCards`, `isLoading`, and `actions` JSX), so the same edits apply at slightly different line numbers.

**Files:**
- Modify: `apps/agent-portal/src/pages/PartnerLinks.tsx`

**Interfaces:**
- Consumes: `generateRegistrantsWorkbook` (Task 1), `InvitationCard.registeredCount` (Task 2).
- Produces: nothing downstream.

- [ ] **Step 1: Add imports**

In `apps/agent-portal/src/pages/PartnerLinks.tsx`:

(a) Add `FileSpreadsheet` to the `lucide-react` import (line 19):

```ts
import { Link2, Copy, Check, MapPin, UserCheck, CheckCircle, Users, FileDown, FileSpreadsheet, Loader2 } from 'lucide-react';
```

(b) Extend the shared-ui import (line 20) that currently imports `generateBulkInvitationCards`:

```ts
import { generateBulkInvitationCards, generateRegistrantsWorkbook } from '@agent-system/shared-ui';
```

- [ ] **Step 2: Add export-in-progress state**

After `const [downloadingLinkId, setDownloadingLinkId] = useState<string | null>(null);` (line 71), add:

```ts
  const [exportingLinkId, setExportingLinkId] = useState<string | null>(null);
```

- [ ] **Step 3: Add the export handler**

Immediately after the `handleDownloadCards` function (after its closing `};` near line 148), add:

```ts
  const handleExportRegistrants = async (link: NonNullable<typeof links>[number]) => {
    if (!link.slot) return;
    setExportingLinkId(link.id);
    try {
      const { data: regs, error } = await supabase
        .from('registrations')
        .select(
          'invitee_name, invitee_nric, invitee_phone, invitee_email, invitee_occupation, status, registered_at',
        )
        .eq('agent_link_id', link.id)
        .order('registered_at', { ascending: true });

      if (error) throw error;
      if (!regs || regs.length === 0) {
        toast({ title: 'No registrants', description: 'No one has registered via this link yet.', variant: 'error' });
        return;
      }

      await generateRegistrantsWorkbook(regs, {
        campaignName: link.slot.campaign.name,
        slotDate: link.slot.start_at,
      });
      toast({ title: `${regs.length} registrant${regs.length > 1 ? 's' : ''} exported` });
    } catch (err: any) {
      toast({ title: 'Failed to export list', description: err.message, variant: 'error' });
    } finally {
      setExportingLinkId(null);
    }
  };
```

- [ ] **Step 4: Derive the active-only links list**

After the `const isLoading = campaignsLoading || linksLoading || statsLoading;` line (line 150), add:

```ts
  // "My Active Links" lists only links whose event slot has not yet ended.
  const now = new Date();
  const activeLinks = links?.filter((l) => !l.slot || parseISO(l.slot.end_at) >= now);
```

- [ ] **Step 5: Use `activeLinks` in the "My Active Links" block**

In the "Existing Links Summary" / "My Active Links" card (starts at line 314), make three replacements:

(a) Render guard:

```tsx
      {links && links.length > 0 && (
```

becomes

```tsx
      {activeLinks && activeLinks.length > 0 && (
```

(b) Header count:

```tsx
              {links.length} link{links.length !== 1 ? 's' : ''} created
```

becomes

```tsx
              {activeLinks.length} link{activeLinks.length !== 1 ? 's' : ''} created
```

(c) The map:

```tsx
                {links.map((link) => (
```

becomes

```tsx
                {activeLinks.map((link) => (
```

(Leave every other use of `links` — e.g. `getExistingLink` — untouched.)

- [ ] **Step 6: Pass the count to the card**

In the `<InvitationCard>` inside that block, add `registeredCount` after the `startTime={...}` prop (line 331):

```tsx
                    startTime={link.slot ? format(parseISO(link.slot.start_at), 'HH:mm') : '-'}
                    registeredCount={link.registration_count}
```

- [ ] **Step 7: Add the Excel button to the card actions**

In the same card's `actions` block (the `<div className="flex items-center gap-1">`, line 335), insert this Tooltip as the **first** child, before the existing "Download invitation cards" Tooltip:

```tsx
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Button
                              variant="ghost"
                              size="sm"
                              className="size-8 p-0"
                              onClick={() => handleExportRegistrants(link)}
                              disabled={exportingLinkId === link.id || link.registration_count === 0}
                              aria-label="Download registrant list (Excel)"
                            >
                              {exportingLinkId === link.id ? (
                                <Loader2 className="size-4 animate-spin" />
                              ) : (
                                <FileSpreadsheet className="size-4" />
                              )}
                            </Button>
                          </TooltipTrigger>
                          <TooltipContent>
                            {link.registration_count === 0
                              ? 'No registrants yet'
                              : 'Download registrant list (Excel)'}
                          </TooltipContent>
                        </Tooltip>
```

- [ ] **Step 8: Typecheck + build agent-portal**

Run:

```bash
pnpm --filter agent-portal typecheck && pnpm --filter agent-portal build
```

Expected: both succeed with no errors.

- [ ] **Step 9: Manual verification**

With `pnpm dev:agent` running, log in as a business partner. On the partner "My Active Links" cards, confirm the same behavior as Task 3: count shows, spreadsheet button exports the link's registrants to `.xlsx`, disabled at 0 registrants, and links for ended events are hidden. RLS already scopes partner reads to their own claimed links, so the export only contains that partner's registrants.

- [ ] **Step 10: Commit**

```bash
git add apps/agent-portal/src/pages/PartnerLinks.tsx
git commit -m "feat(agent-portal): registered count, registrant Excel export, hide past events on Partner Links"
```

---

### Task 5: Full workspace verification

Final gate that the whole monorepo is consistent.

**Files:** none (verification only).

- [ ] **Step 1: Lint + typecheck the workspace**

Run:

```bash
pnpm lint && pnpm -r typecheck
```

Expected: both pass with no new errors.

- [ ] **Step 2: Build everything**

Run:

```bash
pnpm build
```

Expected: all apps build successfully.

- [ ] **Step 3: Confirm code-splitting (optional sanity check)**

After `pnpm --filter agent-portal build`, confirm `write-excel-file` lands in a lazily-loaded chunk (it should appear in a separate chunk, not the main entry), since the util dynamic-imports it. This is a nice-to-have, not a blocker.

---

## Self-Review

**Spec coverage:**
- Feature A (count on cards): Task 2 (prop) + Tasks 3/4 Step 6 (pass it). ✓
- Feature B (Excel export): Task 1 (util + dep) + Tasks 3/4 Steps 3 & 7 (handler + button). ✓
- Feature C (hide past events): Tasks 3/4 Steps 4 & 5 (`activeLinks` filter on `end_at`, used for guard/count/map only). ✓
- Columns/order, filename, formatting, dynamic import: Task 1. ✓
- Both portals: Task 3 (agent) + Task 4 (partner). ✓
- "registered" wording: Task 2 Step 5. ✓
- Disabled at 0 registrants: Tasks 3/4 Step 7. ✓
- No schema/RLS/hook changes: respected (only the spec's files, plus package.json/lockfile). ✓
- Distinct icon (FileSpreadsheet vs FileDown): Tasks 3/4 Step 7. ✓
- `getExistingLink` keeps full `links`: Tasks 3/4 Step 5 explicitly leave other `links` uses untouched. ✓

**Placeholder scan:** No TBD/TODO; every code step shows complete code; Task 4 repeats the full code rather than referencing Task 3. ✓

**Type consistency:** `generateRegistrantsWorkbook(rows, meta)`, `RegistrantRow`, `RegistrantsWorkbookMeta`, `registeredCount`, and `activeLinks` are named identically everywhere they appear. The select-string fields match `RegistrantRow` keys exactly. The filter uses `parseISO`, already imported in both pages. ✓
