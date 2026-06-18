# All Links (Full History) Page — Design Spec

**Date:** 2026-06-19
**Author:** Paul Lee (with Claude)
**Status:** Approved design, pending implementation plan

## Problem

The "My Active Links" section now hides links whose event has ended (the `end_at`
filter shipped in the registrant-count/export feature). Agents and partners need a
way to reach the **complete, unfiltered** list of every registration link they have
generated — including ended events — on a separate page.

## Decisions (from brainstorming)

| Question | Decision |
|----------|----------|
| How to reach it | **In-page link** ("View all links →") on the My Links / Partner Links page → routes to a new page. No sidebar entry. |
| What each card shows on the history page | **Same actions** as the active cards (registered count + Excel export + copy link + PDF invitation cards), plus an **"Ended" badge** on past events. |
| Which portals | **Agent + Partner** (both `MyLinks` and `PartnerLinks` get the link; one shared history page serves both). |
| Implementation approach | **A (isolated):** the new page carries its own copy of the handlers; `MyLinks.tsx`/`PartnerLinks.tsx` are NOT refactored. Lowest risk to just-shipped prod code. |

## Key facts about the existing code

- Routing is **code-based** TanStack Router in `apps/agent-portal/src/router.tsx`.
  Routes are `createRoute({ getParentRoute: () => authenticatedRoute, path, component })`
  and added via `authenticatedRoute.addChildren([...])`. `authenticatedRoute` guards
  auth; there is no per-role route gating (nav arrays in `Layout.tsx` control
  visibility, routes are open to any authenticated user).
- `useMyLinks(agentId)` and `usePartnerLinks(partnerId)` (`hooks/useAgentLinks.ts`)
  both filter `.eq('is_active', true)` and attach `registration_count`.
- The "My Active Links" section in `MyLinks.tsx`/`PartnerLinks.tsx` renders
  `activeLinks` (a component-level filter: `!l.slot || parseISO(l.slot.end_at) >= now`).
  The full hook result is `links`.
- `InvitationCard` (shared-ui) already supports `registeredCount?: number` and a
  `status?: string` prop (renders a `<Badge variant={getStatusVariant(status)}>`),
  plus an `actions` slot. No card changes are required.

## Architecture

### New route + page
- New route **`/all-links`** under `authenticatedRoute`, component **`AllLinks`**
  (`apps/agent-portal/src/pages/AllLinks.tsx`). Registered in `router.tsx` exactly like
  `myLinksRoute`.
- `AllLinks` branches by role from `useAuth()`:
  - `agent` / `agent_admin` → `useMyLinks(agent.id, { includeInactive: true })`
  - `partner` → `usePartnerLinks(partner.id, { includeInactive: true })`
- One page serves both portals (rendering is identical; only the data source differs).

### In-page link (both MyLinks and PartnerLinks)
- Add a "View all links →" link (`@tanstack/react-router` `<Link to="/all-links">`)
  in the **page header area** (next to the "My Links" title/subtitle), so it is
  **always visible** — even when there are zero active links (an agent whose links have
  all ended must still be able to reach history).

### Data — `includeInactive` param
- Add optional second arg `includeInactive = false` to `useMyLinks` and
  `usePartnerLinks`. When `true`, omit the `.eq('is_active', true)` filter so the query
  returns every link the agent/partner generated.
- Append the flag to the queryKey: `['my-links', agentId, includeInactive]` /
  `['partner-links', partnerId, includeInactive]`. Invalidation in `useCreateLink`
  uses the `['my-links', agentId]` / `['partner-links', partnerId]` prefix, which still
  matches (TanStack `invalidateQueries` is prefix-based), so creating a link refreshes
  both the active and the all-links views.

### Rendering on AllLinks
- Render **all** returned links (no `end_at` filter), each as an `InvitationCard` with
  the same `actions` as the active cards: Excel export (`FileSpreadsheet`), PDF cards
  (`FileDown`), copy link (`Copy`), and `registeredCount={link.registration_count}`.
- For links where `parseISO(l.slot.end_at) < now`, pass `status="Ended"` so the card
  shows an "Ended" badge. (Confirm `getStatusVariant('ended')` yields a sensible/neutral
  variant; if not, fall back to a neutral variant — implementation detail.)
- Ordering: active links first (soonest first), then ended links (most-recent first),
  so the useful ones are on top.
- Empty state when the agent/partner has never generated a link
  ("You haven't generated any links yet.").
- The page carries its own copies of `handleExportRegistrants`, `handleDownloadCards`,
  and `handleCopyLink` (Approach A) with their own `exportingLinkId` / `downloadingLinkId`
  / `copiedLinkId` state. These handlers are **identical** to the ones in
  `MyLinks`/`PartnerLinks` and do **not** depend on role — only the data hook
  (`useMyLinks` vs `usePartnerLinks`) and the `systemSettings` branding lookup are the
  same as the existing pages. Role only selects the data source.

## Out of scope (YAGNI)

- No sidebar nav entry (decided: in-page link only).
- No refactor of the MyLinks/PartnerLinks handler duplication (Approach A).
- No URL query params / per-link detail routes.
- No pagination (link counts per agent are small).

## Error handling

- Same as the existing handlers: query/export errors → error toast; empty registrant
  export → "No registrants" toast; spinner state cleared in `finally`.
- Export button disabled when `registration_count === 0` (unchanged behavior).

## Testing / verification

Manual (no UI test runner in this repo):
1. `pnpm --filter agent-portal build` (= `tsc && vite build`) exits 0.
2. As an agent with a mix of active and ended links: the "View all links →" header link
   navigates to `/all-links`; the page lists **all** links; ended ones show an "Ended"
   badge; active ones do not; count + Excel export work on both.
3. An agent whose links have **all ended** (empty "My Active Links") can still see and
   click "View all links →" and reach the full list.
4. Repeat as a business partner (PartnerLinks → /all-links shows the partner's links).
5. Creating a new link still refreshes both the active section and the all-links page.

## Files touched

| File | Change |
|------|--------|
| `apps/agent-portal/src/pages/AllLinks.tsx` | **New** — role-branching full-history page |
| `apps/agent-portal/src/router.tsx` | Register `/all-links` route |
| `apps/agent-portal/src/hooks/useAgentLinks.ts` | `includeInactive` param on `useMyLinks` + `usePartnerLinks` |
| `apps/agent-portal/src/pages/MyLinks.tsx` | "View all links →" header link |
| `apps/agent-portal/src/pages/PartnerLinks.tsx` | "View all links →" header link |
