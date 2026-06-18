# All Links (Full History) Page Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a separate `/all-links` page that lists every registration link an agent/partner has generated (active and ended, unfiltered), reachable via a "View all links →" link in the header of both the agent (`MyLinks`) and partner (`PartnerLinks`) pages.

**Architecture:** A new code-based TanStack route `/all-links` served by one role-branching page `AllLinks.tsx` (reuses `InvitationCard` + the count/export/copy/PDF actions, with an "Ended" badge on past links). The data comes from `useMyLinks`/`usePartnerLinks` given a new `includeInactive` flag that drops the `is_active` filter. Approach A: the new page carries its own copies of the handlers; the shipped `MyLinks`/`PartnerLinks` handler code is NOT refactored.

**Tech Stack:** React 18 + TypeScript + Vite, TanStack Router (code-based) + TanStack Query, Supabase JS, `date-fns`, `lucide-react`, shared-ui (`InvitationCard`, `generateRegistrantsWorkbook`, `generateBulkInvitationCards`).

## Global Constraints

- Spec: `docs/superpowers/specs/2026-06-19-all-links-history-page-design.md`.
- Approach A: do NOT modify the export/copy/PDF handlers in `MyLinks.tsx`/`PartnerLinks.tsx`; only add a header link there.
- "Unfiltered" = no `is_active` filter (via `includeInactive: true`) AND no `end_at` filter on the all-links page.
- Reuse the existing `InvitationCard`; ended links (`parseISO(slot.end_at) < now`) get `status="Ended"` (renders a neutral badge via `getStatusVariant` fallback). Active links pass no `status`.
- Ordering on the all-links page: active links first (soonest `start_at` first), then ended links (most-recent `start_at` first).
- One shared page for both roles; role only selects the data hook (`useMyLinks` for agent/agent_admin, `usePartnerLinks` for partner). The handlers are identical to the existing pages and do not branch on role.
- The "View all links →" link sits in the page header (always visible, even with zero active links).
- No automated test runner; verification = `pnpm --filter agent-portal build` (= `tsc && vite build`) + manual. ESLint is not installed in this environment.
- **Before Task 1, establish a baseline:** run `pnpm --filter agent-portal build` once. If it is already red (the repo has a known dual-`zod` fragility — shared-ui may be pinned to a different `zod` than the apps), STOP and resolve/flag that first; do not attribute a pre-existing red build to this feature. If baseline is green, any new failure is this feature's.
- No git operations unless the user explicitly asks (commit boundaries are marked but run them only on the user's go-ahead).

---

### Task 1: `includeInactive` param on the link hooks

**Files:**
- Modify: `apps/agent-portal/src/hooks/useAgentLinks.ts`

**Interfaces:**
- Consumes: nothing new.
- Produces (relied on by Task 2):
  - `useMyLinks(agentId: string | undefined, includeInactive?: boolean)` — when `includeInactive` is true, returns ALL of the agent's own links (active + inactive).
  - `usePartnerLinks(partnerId: string | undefined, includeInactive?: boolean)` — same for a partner's links.
  - Both still attach `registration_count` and keep their existing default (active-only) behavior when the flag is omitted.

- [ ] **Step 1: Parameterize `useMyLinks`**

In `apps/agent-portal/src/hooks/useAgentLinks.ts`, change the signature line:

```ts
export function useMyLinks(agentId: string | undefined) {
```

to:

```ts
export function useMyLinks(agentId: string | undefined, includeInactive = false) {
```

Change the queryKey line:

```ts
    queryKey: ['my-links', agentId],
```

to:

```ts
    queryKey: ['my-links', agentId, includeInactive],
```

Replace the query block (the `const { data, error } = await supabase ... .eq('agent_id', agentId!).is('partner_id', null).eq('is_active', true).order('created_at', { ascending: false });`):

```ts
      const { data, error } = await supabase
        .from('agent_links')
        .select(`
          *,
          slot:slots(
            id,
            start_at,
            end_at,
            campaign:campaigns(id, name, venue)
          )
        `)
        .eq('agent_id', agentId!)
        .is('partner_id', null)
        .eq('is_active', true)
        .order('created_at', { ascending: false });
```

with:

```ts
      let query = supabase
        .from('agent_links')
        .select(`
          *,
          slot:slots(
            id,
            start_at,
            end_at,
            campaign:campaigns(id, name, venue)
          )
        `)
        .eq('agent_id', agentId!)
        .is('partner_id', null);

      if (!includeInactive) {
        query = query.eq('is_active', true);
      }

      const { data, error } = await query.order('created_at', { ascending: false });
```

- [ ] **Step 2: Parameterize `usePartnerLinks`**

In the same file, change the signature line:

```ts
export function usePartnerLinks(partnerId: string | undefined) {
```

to:

```ts
export function usePartnerLinks(partnerId: string | undefined, includeInactive = false) {
```

Change its queryKey:

```ts
    queryKey: ['partner-links', partnerId],
```

to:

```ts
    queryKey: ['partner-links', partnerId, includeInactive],
```

Replace its query block:

```ts
      const { data, error } = await supabase
        .from('agent_links')
        .select(`
          *,
          slot:slots(
            id,
            start_at,
            end_at,
            campaign:campaigns(id, name, venue)
          )
        `)
        .eq('partner_id', partnerId!)
        .eq('is_active', true)
        .order('created_at', { ascending: false });
```

with:

```ts
      let query = supabase
        .from('agent_links')
        .select(`
          *,
          slot:slots(
            id,
            start_at,
            end_at,
            campaign:campaigns(id, name, venue)
          )
        `)
        .eq('partner_id', partnerId!);

      if (!includeInactive) {
        query = query.eq('is_active', true);
      }

      const { data, error } = await query.order('created_at', { ascending: false });
```

- [ ] **Step 3: Build to verify**

Run:

```bash
pnpm --filter agent-portal build
```

Expected: exit 0. (The existing `useMyLinks(agent?.id)` / `usePartnerLinks(partner?.id)` callers still type-check because the new param is optional; `invalidateQueries(['my-links', agentId])` still matches the longer key by prefix.)

- [ ] **Step 4: Commit** (only on user go-ahead)

```bash
git add apps/agent-portal/src/hooks/useAgentLinks.ts
git commit -m "feat(agent-portal): add includeInactive option to link hooks"
```

---

### Task 2: AllLinks page + route

**Files:**
- Create: `apps/agent-portal/src/pages/AllLinks.tsx`
- Modify: `apps/agent-portal/src/router.tsx`

**Interfaces:**
- Consumes: `useMyLinks(agentId, true)` / `usePartnerLinks(partnerId, true)` (Task 1); `generateRegistrantsWorkbook` and `InvitationCard` (already in shared-ui).
- Produces (relied on by Task 3): a registered route at path `/all-links` (so `<Link to="/all-links">` type-checks).

- [ ] **Step 1: Create the page**

Create `apps/agent-portal/src/pages/AllLinks.tsx` with exactly:

```tsx
import { useState } from 'react';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
  Button,
  Skeleton,
  InvitationCard,
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
  useToast,
  generateBulkInvitationCards,
  generateRegistrantsWorkbook,
} from '@agent-system/shared-ui';
import type { InvitationCardData } from '@agent-system/shared-ui';
import { Link } from '@tanstack/react-router';
import { ArrowLeft, Copy, Check, FileDown, FileSpreadsheet, Loader2 } from 'lucide-react';
import { format, parseISO } from 'date-fns';
import { supabase } from '../lib/supabase';
import { useAuth } from '../hooks/useAuth';
import { useMyLinks, usePartnerLinks } from '../hooks/useAgentLinks';
import { useSystemSettings } from '../hooks/useSystemSettings';
import { DEFAULT_CARD_TEMPLATE, DEFAULT_COMPANY_BRANDING } from '@agent-system/shared-types';

export function AllLinks() {
  const { agent, partner, role } = useAuth();
  const isPartner = role === 'partner';
  const { toast } = useToast();
  const { data: systemSettings } = useSystemSettings();

  // Unfiltered: every link this agent/partner generated, active or ended.
  const agentLinksQuery = useMyLinks(isPartner ? undefined : agent?.id, true);
  const partnerLinksQuery = usePartnerLinks(isPartner ? partner?.id : undefined, true);
  const links = isPartner ? partnerLinksQuery.data : agentLinksQuery.data;
  const isLoading = isPartner ? partnerLinksQuery.isLoading : agentLinksQuery.isLoading;

  const [copiedLinkId, setCopiedLinkId] = useState<string | null>(null);
  const [downloadingLinkId, setDownloadingLinkId] = useState<string | null>(null);
  const [exportingLinkId, setExportingLinkId] = useState<string | null>(null);

  const handleCopyLink = async (linkCode: string, linkId: string) => {
    const publicPagesUrl = import.meta.env.VITE_PUBLIC_PAGES_URL || window.location.origin;
    const url = `${publicPagesUrl}/public/register/${linkCode}`;
    await navigator.clipboard.writeText(url);
    setCopiedLinkId(linkId);
    toast({ title: 'Link copied!', description: 'Share this link with your invitees.' });
    setTimeout(() => setCopiedLinkId(null), 2000);
  };

  const handleDownloadCards = async (link: NonNullable<typeof links>[number]) => {
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
      }));

      const branding = systemSettings?.company_branding ?? DEFAULT_COMPANY_BRANDING;
      const template = systemSettings?.card_template ?? DEFAULT_CARD_TEMPLATE;
      const doc = await generateBulkInvitationCards(invitationData, template, branding);
      doc.save(`invitation-cards-${link.slot.campaign.name}.pdf`);
      toast({ title: `${regs.length} card${regs.length > 1 ? 's' : ''} downloaded` });
    } catch (err: any) {
      toast({ title: 'Failed to generate cards', description: err.message, variant: 'error' });
    } finally {
      setDownloadingLinkId(null);
    }
  };

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

  // Active links first (soonest first), then ended links (most recent first).
  const now = new Date();
  const sortedLinks = [...(links ?? [])].sort((a, b) => {
    const aEnded = a.slot ? parseISO(a.slot.end_at) < now : false;
    const bEnded = b.slot ? parseISO(b.slot.end_at) < now : false;
    if (aEnded !== bEnded) return aEnded ? 1 : -1;
    const aStart = a.slot ? parseISO(a.slot.start_at).getTime() : 0;
    const bStart = b.slot ? parseISO(b.slot.start_at).getTime() : 0;
    return aEnded ? bStart - aStart : aStart - bStart;
  });

  return (
    <div className="flex flex-col gap-4 animate-fade-in">
      <div>
        <Link
          to={isPartner ? '/partner-links' : '/my-links'}
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground mb-1"
        >
          <ArrowLeft className="size-4" /> Back to My Links
        </Link>
        <h1 className="text-2xl font-semibold text-foreground">All Links</h1>
        <p className="text-sm text-muted-foreground">
          Every registration link you've generated, including past events
        </p>
      </div>

      {isLoading ? (
        <div className="space-y-3">
          {[1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-24 w-full rounded-xl" />
          ))}
        </div>
      ) : !sortedLinks.length ? (
        <Card>
          <CardContent className="py-8 text-center">
            <p className="text-muted-foreground">You haven't generated any links yet.</p>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardHeader>
            <CardTitle>All Links</CardTitle>
            <CardDescription>
              {sortedLinks.length} link{sortedLinks.length !== 1 ? 's' : ''} total
            </CardDescription>
          </CardHeader>
          <CardContent>
            <TooltipProvider>
              <div className="space-y-3">
                {sortedLinks.map((link) => {
                  const ended = link.slot ? parseISO(link.slot.end_at) < now : false;
                  return (
                    <InvitationCard
                      key={link.id}
                      eventName={link.slot?.campaign?.name ?? 'Unknown Event'}
                      venue={link.slot?.campaign?.venue ?? '-'}
                      date={link.slot ? parseISO(link.slot.start_at) : new Date()}
                      startTime={link.slot ? format(parseISO(link.slot.start_at), 'HH:mm') : '-'}
                      status={ended ? 'Ended' : undefined}
                      registeredCount={link.registration_count}
                      companyName={systemSettings?.company_branding?.companyName}
                      logoUrl={systemSettings?.company_branding?.logoUrl}
                      actions={
                        <div className="flex items-center gap-1">
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
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <Button
                                variant="ghost"
                                size="sm"
                                className="size-8 p-0"
                                onClick={() => handleCopyLink(link.link_code, link.id)}
                                aria-label="Copy registration link"
                              >
                                {copiedLinkId === link.id ? (
                                  <Check className="size-4 text-emerald-600" />
                                ) : (
                                  <Copy className="size-4" />
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
                  );
                })}
              </div>
            </TooltipProvider>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Import the page in the router**

In `apps/agent-portal/src/router.tsx`, after the line `import { MyLinks } from './pages/MyLinks';`, add:

```ts
import { AllLinks } from './pages/AllLinks';
```

- [ ] **Step 3: Define the route**

In `apps/agent-portal/src/router.tsx`, after the `myLinksRoute` definition (the block ending at the line with `component: MyLinks,` and its closing `});`), add:

```ts
const allLinksRoute = createRoute({
  getParentRoute: () => authenticatedRoute,
  path: '/all-links',
  component: AllLinks,
});
```

- [ ] **Step 4: Add the route to the tree**

In the `authenticatedRoute.addChildren([...])` array, add `allLinksRoute,` immediately after `myLinksRoute,`:

```ts
  authenticatedRoute.addChildren([
    indexRoute,
    campaignsRoute,
    myLinksRoute,
    allLinksRoute,
    rewardsRoute,
    partnersRoute,
    partnerLinksRoute,
    myAgentsRoute,
    accountRoute,
  ]),
```

- [ ] **Step 5: Build to verify**

Run:

```bash
pnpm --filter agent-portal build
```

Expected: exit 0. (Registering the route makes `/all-links` a valid typed path.)

- [ ] **Step 6: Manual check**

With `pnpm dev:agent` running (ask the user to reload), visit `/all-links` directly while logged in as an agent: it lists ALL links (active + ended), ended ones show a gray "Ended" badge, the count + Excel export + PDF + copy buttons work, and an account with no links shows the empty state.

- [ ] **Step 7: Commit** (only on user go-ahead)

```bash
git add apps/agent-portal/src/pages/AllLinks.tsx apps/agent-portal/src/router.tsx
git commit -m "feat(agent-portal): add /all-links full link-history page"
```

---

### Task 3: "View all links →" header link on MyLinks and PartnerLinks

**Files:**
- Modify: `apps/agent-portal/src/pages/MyLinks.tsx`
- Modify: `apps/agent-portal/src/pages/PartnerLinks.tsx`

**Interfaces:**
- Consumes: the `/all-links` route (Task 2).
- Produces: nothing downstream.

- [ ] **Step 1: MyLinks — add imports**

In `apps/agent-portal/src/pages/MyLinks.tsx`:

(a) Add `ArrowRight` to the existing `lucide-react` import. For example, change:

```ts
import { Link2, Copy, Check, MapPin, UserCheck, CheckCircle, Users, FileDown, FileSpreadsheet, Loader2 } from 'lucide-react';
```

to:

```ts
import { Link2, Copy, Check, MapPin, UserCheck, CheckCircle, Users, FileDown, FileSpreadsheet, Loader2, ArrowRight } from 'lucide-react';
```

(b) Add the TanStack `Link` import. After the `lucide-react` import line, add:

```ts
import { Link } from '@tanstack/react-router';
```

- [ ] **Step 2: MyLinks — add the header link**

Replace the page header block:

```tsx
      <div>
        <h1 className="text-2xl font-semibold text-foreground">My Links</h1>
        <p className="text-sm text-muted-foreground">Generate and share registration links for events</p>
      </div>
```

with:

```tsx
      <div className="flex items-start justify-between gap-2">
        <div>
          <h1 className="text-2xl font-semibold text-foreground">My Links</h1>
          <p className="text-sm text-muted-foreground">Generate and share registration links for events</p>
        </div>
        <Link
          to="/all-links"
          className="inline-flex items-center gap-1 whitespace-nowrap text-sm font-medium text-sky-600 hover:text-sky-700 mt-1"
        >
          View all links <ArrowRight className="size-4" />
        </Link>
      </div>
```

- [ ] **Step 3: PartnerLinks — add imports**

In `apps/agent-portal/src/pages/PartnerLinks.tsx`:

(a) Add `ArrowRight` to the `lucide-react` import (same edit as MyLinks Step 1a — change the import line to end with `..., Loader2, ArrowRight`).

(b) After the `lucide-react` import line, add:

```ts
import { Link } from '@tanstack/react-router';
```

- [ ] **Step 4: PartnerLinks — add the header link**

Replace the page header block:

```tsx
      <div>
        <h1 className="text-2xl font-semibold text-foreground">My Links</h1>
        <p className="text-sm text-muted-foreground">
          Generate and share registration links under {partner?.agent?.name ?? 'your unit'}
        </p>
      </div>
```

with:

```tsx
      <div className="flex items-start justify-between gap-2">
        <div>
          <h1 className="text-2xl font-semibold text-foreground">My Links</h1>
          <p className="text-sm text-muted-foreground">
            Generate and share registration links under {partner?.agent?.name ?? 'your unit'}
          </p>
        </div>
        <Link
          to="/all-links"
          className="inline-flex items-center gap-1 whitespace-nowrap text-sm font-medium text-sky-600 hover:text-sky-700 mt-1"
        >
          View all links <ArrowRight className="size-4" />
        </Link>
      </div>
```

- [ ] **Step 5: Build to verify**

Run:

```bash
pnpm --filter agent-portal build
```

Expected: exit 0. (`<Link to="/all-links">` type-checks because Task 2 registered the route. Note: `Link` from `@tanstack/react-router` does not collide with the lucide `Link2` icon.)

- [ ] **Step 6: Manual check**

With `pnpm dev:agent` running: on the agent My Links page and the partner My Links page, a "View all links →" link shows in the header (even when there are no active links) and navigates to `/all-links`.

- [ ] **Step 7: Commit** (only on user go-ahead)

```bash
git add apps/agent-portal/src/pages/MyLinks.tsx apps/agent-portal/src/pages/PartnerLinks.tsx
git commit -m "feat(agent-portal): link to /all-links from My Links and Partner Links headers"
```

---

### Task 4: Full verification

**Files:** none (verification only).

- [ ] **Step 1: Build the agent portal**

```bash
pnpm --filter agent-portal build
```

Expected: exit 0.

- [ ] **Step 2: Build admin + public (consumers of shared-ui)**

```bash
pnpm --filter admin-portal build && pnpm --filter public-pages build
```

Expected: exit 0 (Task 1 only widened hook signatures with optional params; no shared-ui surface changed, so these should be unaffected — this just confirms no regression).

- [ ] **Step 3: End-to-end manual pass**

With `pnpm dev:agent` running:
1. Agent with a mix of active + ended links: header "View all links →" → `/all-links` shows everything; ended links carry a gray "Ended" badge, active ones don't; ordering is active-first then ended.
2. Count, Excel export, PDF cards, and copy all work on the all-links page.
3. Agent whose links have ALL ended (empty "My Active Links"): the header link is still visible and reaches the full list.
4. Partner: header link → `/all-links` shows the partner's links; "Back to My Links" returns to `/partner-links`.
5. Creating a new link refreshes both the active "My Active Links" section and the all-links page.

---

## Self-Review

**Spec coverage:**
- In-page link, header placement, both portals: Task 3 (Steps 2 & 4). ✓
- New `/all-links` page, role-branching: Task 2 (Step 1). ✓
- Unfiltered data via `includeInactive`: Task 1 + Task 2 Step 1 (calls with `true`, no `end_at` filter). ✓
- Same actions reused (count + export + PDF + copy): Task 2 Step 1. ✓
- "Ended" badge on past links: Task 2 Step 1 (`status={ended ? 'Ended' : undefined}`). ✓
- Active-first then ended ordering: Task 2 Step 1 (`sortedLinks`). ✓
- Empty state: Task 2 Step 1. ✓
- Always-reachable link (zero active links): Task 3 header placement + Task 4 Step 3 case 3. ✓
- Approach A (no handler refactor of MyLinks/PartnerLinks): Task 3 only adds imports + header; handlers untouched. ✓

**Placeholder scan:** No TBD/TODO; every code step shows complete code; the AllLinks file is given in full; Task 3 repeats the full header blocks for each file. ✓

**Type consistency:** `useMyLinks(agentId, includeInactive?)` / `usePartnerLinks(partnerId, includeInactive?)` defined in Task 1 match the calls in Task 2. `registeredCount`, `status`, and `InvitationCard`'s `actions` match the shipped component. `Link` (router) vs `Link2` (lucide icon) do not collide. The export select-string fields match `RegistrantRow`. `link.slot`/`link.registration_count` come from `AgentLinkWithSlotCampaign`. ✓
