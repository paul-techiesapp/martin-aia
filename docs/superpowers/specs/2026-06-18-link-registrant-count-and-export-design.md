# Per-Link Registrant Count + Excel Export — Design Spec

**Date:** 2026-06-18
**Author:** Paul Lee (with Claude)
**Status:** Approved design, pending implementation plan

## Problem

On the agent-portal **"My Active Links"** view, each card shows an event invitation
link but gives no indication of how many invitees have signed up through it. Agents
(and business partners) need two things per link:

1. **See the count** — how many of their invitees have registered via that specific link.
2. **Download the list** — a full registrant export (name, contact, etc.) for follow-up.

## Decisions (from brainstorming)

| Question | Decision |
|----------|----------|
| What does "joined" mean? | **Registered** — anyone who signed up via the link, any status (`registered`/`attended`/`completed`). This is exactly what the existing `registration_count` already tracks. |
| Permanent UI vs. one-off answer? | **Permanent UI** — show the count on the cards. |
| Export format | **Excel (.xlsx)** |
| Export columns | Name, NRIC/MyKad, Phone, Email, Occupation, Status, Registered At |
| Excel library | **`write-excel-file`** (lightweight, maintained, npm, browser-native), dynamic-imported to avoid bloating the main bundle. |
| Apply to Business Partner view too? | **Yes** — mirror to `PartnerLinks.tsx`. |
| Label wording | **"registered"** to match the rest of the portal (stat cards + slot list already use "registered"). |
| Hide past events from "My Active Links"? | **Yes** — a link disappears from the section once its slot **`end_at`** has passed (event is over). An event happening right now still shows. |

## Key facts about the existing code

- The "My Active Links" cards render `<InvitationCard>` (shared-ui) inside
  `apps/agent-portal/src/pages/MyLinks.tsx` and `PartnerLinks.tsx`.
- `useMyLinks()` / `usePartnerLinks()` (`apps/agent-portal/src/hooks/useAgentLinks.ts`)
  **already attach `registration_count` to each link** via a secondary count query.
  No data-fetching change is needed for the count.
- The card's existing download icon is **NOT** a contact list — it is
  `handleDownloadCards`, which generates printable invitation-flyer **PDFs**
  (one per registrant) via `generateBulkInvitationCards`. The new Excel button is
  distinct, separate function.
- `InvitationCard` exposes an `actions` slot (arbitrary `ReactNode` in the bottom-right),
  so the new export button needs **no change to the card's button API** — only the
  numeric count needs a new prop.
- No schema or RLS change required. Agents read their own registrations via the
  existing policy `agent_id = get_agent_id()`; partners via
  `agent_link_id IN (SELECT id FROM agent_links WHERE partner_id = get_partner_id())`.
- `lucide-react` is already a direct dependency of `shared-ui`, so the `Users` icon
  may be used inside `InvitationCard`.

## Feature A — "N registered" count on each card

**`InvitationCard` (`packages/shared-ui/src/components/ui/invitation-card.tsx`)**

- Add optional prop: `registeredCount?: number`.
- Include it in the bottom-row visibility test:
  `hasBottomRow = inviteeName !== undefined || inviteeType !== undefined || actions !== undefined || registeredCount !== undefined`.
- In the bottom-row left area, when `registeredCount !== undefined` **and**
  `inviteeName === undefined` (the My-Links usage, where no single invitee is shown),
  render a compact label: a small `Users` icon + `{registeredCount} registered`.
  Tooltip-free inline text; styled to match the card's small-text scale
  (e.g. `text-[11px] text-slate-600`).
- Existing usages that pass `inviteeName` (e.g. detail/PDF contexts) are unaffected
  because the count branch is gated on `inviteeName === undefined`.

**`MyLinks.tsx` / `PartnerLinks.tsx`**

- Pass `registeredCount={link.registration_count}` to each `<InvitationCard>`.

## Feature B — Excel export of registrants per card

**New shared util: `packages/shared-ui/src/utils/excelGenerator.ts`**

- Export `generateRegistrantsWorkbook(rows, meta)` (or similar) that takes already-fetched
  registrant rows + event metadata and triggers a browser `.xlsx` download.
- Internally **dynamic-imports** `write-excel-file` so it is code-split out of the main bundle.
- Column schema (in this order):
  1. **Name** — `invitee_name`
  2. **NRIC / MyKad** — `invitee_nric`
  3. **Phone** — `invitee_phone`
  4. **Email** — `invitee_email`
  5. **Occupation** — `invitee_occupation`
  6. **Status** — `status`
  7. **Registered At** — `registered_at` formatted `d MMM yyyy, HH:mm` (blank if null)
- Header row bold; sensible column widths.
- Export it from `packages/shared-ui/src/index.ts` (next to the `pdfGenerator` exports).

**Dependency**

- Add `write-excel-file` to `packages/shared-ui/package.json` dependencies; install.

**`MyLinks.tsx` / `PartnerLinks.tsx` — new handler + button**

- New state: `const [exportingLinkId, setExportingLinkId] = useState<string | null>(null)`
  (separate from `downloadingLinkId`, which drives the PDF button's spinner).
- New `handleExportRegistrants(link)`:
  1. Set `exportingLinkId = link.id`.
  2. Query Supabase **lazily on click** (PII fetched only when needed):
     ```ts
     supabase
       .from('registrations')
       .select('invitee_name, invitee_nric, invitee_phone, invitee_email, invitee_occupation, status, registered_at')
       .eq('agent_link_id', link.id)
       .order('registered_at', { ascending: true })
     ```
  3. On error → error toast (same pattern as `handleDownloadCards`).
  4. Call `generateRegistrantsWorkbook(rows, { campaignName, slotDate })`.
  5. Filename: `{campaign}-{date}-registrants.xlsx`, sanitized
     (e.g. `BOP-JUNE-2026-06-24-registrants.xlsx`).
  6. Success toast `N registrant(s) exported`; clear `exportingLinkId` in `finally`.
- New button in the card's `actions` block, **before** the existing PDF/Copy buttons:
  - Icon: `FileSpreadsheet` (lucide), spinner `Loader2` while `exportingLinkId === link.id`.
  - Tooltip + `aria-label`: "Download registrant list (Excel)".
  - **Disabled when `link.registration_count === 0`** with tooltip "No registrants yet".

## Feature C — hide past events from "My Active Links"

Currently the section lists every active link regardless of whether its event has
already happened (see screenshot: on 18 Jun, two 17 Jun cards still show). Links for
finished events should drop off.

**`MyLinks.tsx` / `PartnerLinks.tsx`**

- Derive an `activeLinks` list from `links`, keeping only links whose slot has **not
  ended**: `!l.slot || parseISO(l.slot.end_at) >= now` (with `now = new Date()`).
- Use `activeLinks` (not `links`) for the "My Active Links" card: the render guard
  (`activeLinks.length > 0`), the "N link(s)" count in the header, and the `.map`.
- Leave the rest of the page on `links` — in particular `getExistingLink()` for the
  slot list must keep seeing all links so the slot-level "Copy Link" vs "Get My Link"
  logic is unaffected.
- This is a pure client-side filter; the hooks/queries are unchanged. (The list of
  links per agent is small, so client-side filtering is simplest and avoids fiddly
  PostgREST embedded-resource filters.)

## Out of scope (YAGNI)

- No status filtering / column selection UI — fixed column set as decided.
- No server-side export, scheduled export, or admin-portal export (can reuse the shared
  util later if wanted).
- No refactor of the MyLinks/PartnerLinks duplication beyond these additive changes.

## Error handling

- Supabase query failure → `toast({ variant: 'error' })`, button returns to idle.
- Zero registrants → button disabled (cannot be triggered); count shows `0 registered`.
- Generation failure → error toast; `finally` always clears the spinner state.

## Testing / verification

Manual (matches project norm — no automated UI tests in this area):
1. Run `pnpm dev:agent`.
2. As an agent with ≥1 active link and ≥2 registrants: confirm each card shows
   "N registered" matching the slot list count.
3. Click the Excel button → `.xlsx` downloads, opens with the 7 columns in order,
   correct data, bold header.
4. A link with 0 registrants → Excel button disabled, tooltip "No registrants yet",
   count shows `0 registered`.
5. A link whose slot `end_at` is in the past no longer appears in "My Active Links";
   the header count reflects only the still-active links.
6. Repeat as a business partner (PartnerLinks) to confirm parity.
7. `pnpm --filter @agent-system/shared-ui build` and `pnpm --filter agent-portal build`
   succeed; `pnpm -r typecheck` passes.

## Files touched

| File | Change |
|------|--------|
| `packages/shared-ui/src/components/ui/invitation-card.tsx` | Add `registeredCount` prop + render |
| `packages/shared-ui/src/utils/excelGenerator.ts` | **New** — `generateRegistrantsWorkbook()` |
| `packages/shared-ui/src/index.ts` | Export the new util |
| `packages/shared-ui/package.json` | Add `write-excel-file` |
| `apps/agent-portal/src/pages/MyLinks.tsx` | Pass count, add export button + handler |
| `apps/agent-portal/src/pages/PartnerLinks.tsx` | Pass count, add export button + handler |
