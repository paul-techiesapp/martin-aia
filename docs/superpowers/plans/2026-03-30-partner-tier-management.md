# Partner Tier Management Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extend the tier request workflow to support partners — Agent Admins can request tier assignments for their partners with the same approval flow as sub-agents.

**Architecture:** Add `tier_id` to `partners` table, extend `tier_requests` with `partner_id`, update the `request-tier` edge function to accept either `agent_id` or `partner_id`, add tier UI to Partners page, update admin approval to handle both types.

**Tech Stack:** PostgreSQL (Supabase), Deno edge functions, React 18, TanStack Query, TypeScript, shadcn/ui

---

## File Structure

### New files
- `supabase/migrations/20260330000002_partner_tier.sql` — Schema: partner tier_id, extend tier_requests

### Modified files
- `supabase/functions/request-tier/index.ts` — Support partner_id in addition to agent_id
- `packages/shared-types/src/partner.ts` — Add tier_id to Partner, add PartnerWithTier
- `packages/shared-types/src/tier-request.ts` — Make agent_id nullable, add partner_id
- `apps/agent-portal/src/hooks/usePartners.ts` — Join tiers in useMyPartners query
- `apps/agent-portal/src/pages/Partners.tsx` — Add Tier column, Request Tier dialog
- `apps/agent-portal/src/pages/PartnerLinks.tsx` — Block link generation without tier
- `apps/admin-portal/src/hooks/useTierRequests.ts` — Add partner join, update approve flow
- `apps/admin-portal/src/pages/agents/AgentList.tsx` — Add Type column, handle partner requests

---

### Task 1: Database Migration — Partner Tier Support

**Files:**
- Create: `supabase/migrations/20260330000002_partner_tier.sql`

- [ ] **Step 1: Create the migration file**

```sql
-- Add tier_id to partners table
ALTER TABLE partners
  ADD COLUMN tier_id UUID REFERENCES tiers(id);

-- Extend tier_requests to support partners
ALTER TABLE tier_requests
  ALTER COLUMN agent_id DROP NOT NULL,
  ADD COLUMN partner_id UUID REFERENCES partners(id) ON DELETE CASCADE,
  ADD CONSTRAINT tier_requests_target_check
    CHECK (
      (agent_id IS NOT NULL AND partner_id IS NULL) OR
      (agent_id IS NULL AND partner_id IS NOT NULL)
    );

CREATE INDEX idx_tier_requests_partner ON tier_requests(partner_id);
```

- [ ] **Step 2: Apply migration locally**

Run: `npx supabase db reset`
Expected: All migrations apply successfully.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260330000002_partner_tier.sql
git commit -m "feat(db): add partner tier support and extend tier_requests"
```

---

### Task 2: Shared Types — Update Partner & TierRequest

**Files:**
- Modify: `packages/shared-types/src/partner.ts`
- Modify: `packages/shared-types/src/tier-request.ts`

- [ ] **Step 1: Update Partner interface and add PartnerWithTier**

Replace the entire content of `packages/shared-types/src/partner.ts`:

```typescript
import { AgentStatus } from './enums';
import type { Agent, Tier } from './database';

export interface Partner {
  id: string;
  agent_id: string;
  user_id: string;
  name: string;
  email: string;
  phone: string;
  nric: string | null;
  tier_id: string | null;
  status: AgentStatus;
  created_at: string;
  updated_at: string;
}

export interface PartnerWithAgent extends Partner {
  agent: Agent;
}

export interface PartnerWithTier extends Partner {
  tier: Tier | null;
}
```

- [ ] **Step 2: Update TierRequest types**

Replace the entire content of `packages/shared-types/src/tier-request.ts`:

```typescript
import { TierRequestStatus } from './enums';
import type { Agent, Tier } from './database';
import type { Partner } from './partner';

export interface TierRequest {
  id: string;
  agent_id: string | null;
  partner_id: string | null;
  requested_tier_id: string;
  requested_by: string;
  status: TierRequestStatus;
  admin_notes: string | null;
  reviewed_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface TierRequestWithDetails extends TierRequest {
  agent: Agent | null;
  partner: Partner | null;
  requested_tier: Tier;
  requester: Agent;
}
```

- [ ] **Step 3: Verify types compile**

Run: `pnpm --filter shared-types exec tsc --noEmit 2>&1 | tail -5`
Expected: No errors.

- [ ] **Step 4: Commit**

```bash
git add packages/shared-types/src/partner.ts packages/shared-types/src/tier-request.ts
git commit -m "feat(types): add partner tier_id and extend TierRequest for partners"
```

---

### Task 3: Edge Function — Extend request-tier for Partners

**Files:**
- Modify: `supabase/functions/request-tier/index.ts`

- [ ] **Step 1: Replace the edge function**

Replace the entire content of `supabase/functions/request-tier/index.ts`:

```typescript
import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { agent_id, partner_id, tier_id } = await req.json();

    if ((!agent_id && !partner_id) || !tier_id) {
      return new Response(
        JSON.stringify({ error: "tier_id and one of agent_id or partner_id are required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (agent_id && partner_id) {
      return new Response(
        JSON.stringify({ error: "Provide either agent_id or partner_id, not both" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(
        JSON.stringify({ error: "Unauthorized" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const { data: { user: caller }, error: authError } = await supabase.auth.getUser(
      authHeader.replace("Bearer ", "")
    );

    if (authError || !caller) {
      return new Response(
        JSON.stringify({ error: "Unauthorized" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Verify caller is an Agent Admin
    const { data: callerAgent, error: agentError } = await supabase
      .from("agents")
      .select("id, parent_agent_id")
      .eq("user_id", caller.id)
      .single();

    if (agentError || !callerAgent) {
      return new Response(
        JSON.stringify({ error: "Only agents can request tiers" }),
        { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (callerAgent.parent_agent_id !== null) {
      return new Response(
        JSON.stringify({ error: "Only Agent Admins can request tiers" }),
        { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Validate target based on type
    if (agent_id) {
      // Agent tier request (existing logic)
      if (agent_id !== callerAgent.id) {
        const { data: targetAgent, error: targetError } = await supabase
          .from("agents")
          .select("id, parent_agent_id")
          .eq("id", agent_id)
          .single();

        if (targetError || !targetAgent || targetAgent.parent_agent_id !== callerAgent.id) {
          return new Response(
            JSON.stringify({ error: "You can only request tiers for your own sub-agents" }),
            { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }
      }

      // Check no pending request for this agent
      const { data: existing } = await supabase
        .from("tier_requests")
        .select("id")
        .eq("agent_id", agent_id)
        .eq("status", "pending")
        .maybeSingle();

      if (existing) {
        return new Response(
          JSON.stringify({ error: "A pending tier request already exists for this agent" }),
          { status: 409, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
    } else {
      // Partner tier request (new logic)
      const { data: targetPartner, error: partnerError } = await supabase
        .from("partners")
        .select("id, agent_id")
        .eq("id", partner_id)
        .single();

      if (partnerError || !targetPartner) {
        return new Response(
          JSON.stringify({ error: "Partner not found" }),
          { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      if (targetPartner.agent_id !== callerAgent.id) {
        return new Response(
          JSON.stringify({ error: "You can only request tiers for your own partners" }),
          { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      // Check no pending request for this partner
      const { data: existing } = await supabase
        .from("tier_requests")
        .select("id")
        .eq("partner_id", partner_id)
        .eq("status", "pending")
        .maybeSingle();

      if (existing) {
        return new Response(
          JSON.stringify({ error: "A pending tier request already exists for this partner" }),
          { status: 409, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
    }

    // Verify tier exists
    const { data: tier, error: tierError } = await supabase
      .from("tiers")
      .select("id")
      .eq("id", tier_id)
      .single();

    if (tierError || !tier) {
      return new Response(
        JSON.stringify({ error: "Tier not found" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Insert tier request
    const { data: request, error: insertError } = await supabase
      .from("tier_requests")
      .insert({
        agent_id: agent_id || null,
        partner_id: partner_id || null,
        requested_tier_id: tier_id,
        requested_by: callerAgent.id,
      })
      .select()
      .single();

    if (insertError) {
      return new Response(
        JSON.stringify({ error: insertError.message || "Failed to create tier request" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    return new Response(
      JSON.stringify({ success: true, request }),
      { status: 201, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("request-tier error:", error);
    return new Response(
      JSON.stringify({ error: "Internal server error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
```

- [ ] **Step 2: Commit**

```bash
git add supabase/functions/request-tier/index.ts
git commit -m "feat(edge): extend request-tier to support partner tier requests"
```

---

### Task 4: Agent Portal — Update useMyPartners Hook

**Files:**
- Modify: `apps/agent-portal/src/hooks/usePartners.ts`

- [ ] **Step 1: Update useMyPartners to join tiers**

In `apps/agent-portal/src/hooks/usePartners.ts`, change the import and the query:

Change the import from:
```typescript
import type { Partner } from '@agent-system/shared-types';
```
To:
```typescript
import type { Partner, PartnerWithTier } from '@agent-system/shared-types';
```

In the `useMyPartners` function, change the select and return type:

Find:
```typescript
      const { data, error } = await supabase
        .from('partners')
        .select('*')
        .eq('agent_id', agentId)
        .order('created_at', { ascending: false });

      if (error) throw error;
      return data as Partner[];
```

Replace with:
```typescript
      const { data, error } = await supabase
        .from('partners')
        .select('*, tier:tiers(*)')
        .eq('agent_id', agentId)
        .order('created_at', { ascending: false });

      if (error) throw error;
      return data as PartnerWithTier[];
```

- [ ] **Step 2: Commit**

```bash
git add apps/agent-portal/src/hooks/usePartners.ts
git commit -m "feat(hooks): join tiers in useMyPartners query"
```

---

### Task 5: Agent Portal — Partners Page Tier UI

**Files:**
- Modify: `apps/agent-portal/src/pages/Partners.tsx`

- [ ] **Step 1: Replace Partners.tsx with tier management**

Replace the entire content of `apps/agent-portal/src/pages/Partners.tsx`:

```typescript
import { useState } from 'react';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  Button,
  Badge,
  StatCard,
  StatCardGrid,
  TableSkeleton,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  useToast,
} from '@agent-system/shared-ui';
import { Users, UserCheck, UserPlus, ShieldOff, Tag } from 'lucide-react';
import { useAuth } from '../hooks/useAuth';
import {
  useMyPartners,
  usePartnerClaimCounts,
  useCreatePartner,
  useDeactivatePartner,
} from '../hooks/usePartners';
import { useMyTierRequests, useRequestTier, useAvailableTiers } from '../hooks/useSubAgents';
import { TierRequestStatus } from '@agent-system/shared-types';

export function Partners() {
  const { agent, role } = useAuth();
  const { toast } = useToast();

  // Role guard: only agent_admin can access this page
  if (role && role !== 'agent_admin') {
    return (
      <div className="p-6 text-center text-muted-foreground">
        <p>This page is only available to agents.</p>
      </div>
    );
  }

  const { data: partners, isLoading } = useMyPartners(agent?.id);
  const { data: claimCounts } = usePartnerClaimCounts(agent?.id);
  const { data: tierRequests } = useMyTierRequests(agent?.id);
  const { data: tiers } = useAvailableTiers();
  const createPartner = useCreatePartner();
  const deactivatePartner = useDeactivatePartner();
  const requestTier = useRequestTier();

  const [isAddOpen, setIsAddOpen] = useState(false);
  const [isTierOpen, setIsTierOpen] = useState(false);
  const [tierTargetId, setTierTargetId] = useState<string | null>(null);
  const [selectedTierId, setSelectedTierId] = useState('');
  const [deactivateId, setDeactivateId] = useState<string | null>(null);
  const [form, setForm] = useState({ name: '', email: '', phone: '', nric: '', password: '' });

  const activeCount = partners?.filter(p => p.status === 'active').length ?? 0;
  const totalCount = partners?.length ?? 0;

  const getTierRequestForPartner = (partnerId: string) => {
    return tierRequests?.find(r => r.partner_id === partnerId && r.status === TierRequestStatus.PENDING);
  };

  const getLastRejectedRequestForPartner = (partnerId: string) => {
    return tierRequests?.find(r => r.partner_id === partnerId && r.status === TierRequestStatus.REJECTED);
  };

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await createPartner.mutateAsync({
        name: form.name,
        email: form.email,
        phone: form.phone,
        nric: form.nric || undefined,
        password: form.password,
      });
      toast({ title: 'Partner created', description: `${form.name} can now log in with their email and password.` });
      setIsAddOpen(false);
      setForm({ name: '', email: '', phone: '', nric: '', password: '' });
    } catch (err: any) {
      toast({ title: 'Failed to create partner', description: err.message, variant: 'error' });
    }
  };

  const handleRequestTier = async () => {
    if (!tierTargetId || !selectedTierId) return;
    try {
      await requestTier.mutateAsync({ partner_id: tierTargetId, tier_id: selectedTierId });
      toast({ title: 'Tier requested', description: 'Waiting for admin approval.' });
      setIsTierOpen(false);
      setTierTargetId(null);
      setSelectedTierId('');
    } catch (err: any) {
      toast({ title: 'Failed to request tier', description: err.message, variant: 'error' });
    }
  };

  const handleDeactivate = async () => {
    if (!deactivateId) return;
    try {
      await deactivatePartner.mutateAsync(deactivateId);
      toast({
        title: 'Partner deactivated',
        description: `Partner's active links have been deactivated.`,
      });
      setDeactivateId(null);
    } catch (err: any) {
      toast({ title: 'Failed to deactivate', description: err.message, variant: 'error' });
    }
  };

  const openTierDialog = (partnerId: string) => {
    setTierTargetId(partnerId);
    setSelectedTierId('');
    setIsTierOpen(true);
  };

  const renderTierStatus = (p: { id: string; tier: any | null }) => {
    if (p.tier) {
      return <span className="text-sm">{p.tier.name}</span>;
    }

    const pendingReq = getTierRequestForPartner(p.id);
    if (pendingReq) {
      return <Badge variant="warning">Pending Approval</Badge>;
    }

    const rejectedReq = getLastRejectedRequestForPartner(p.id);
    if (rejectedReq) {
      return (
        <div className="flex items-center gap-2">
          <Badge variant="error">Rejected</Badge>
          <Button variant="ghost" size="sm" onClick={() => openTierDialog(p.id)}>
            Retry
          </Button>
        </div>
      );
    }

    return (
      <Button variant="outline" size="sm" onClick={() => openTierDialog(p.id)}>
        <Tag className="size-3.5 mr-1" />
        Request Tier
      </Button>
    );
  };

  return (
    <div className="flex flex-col gap-4 animate-fade-in">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">Partners</h1>
          <p className="text-sm text-muted-foreground">Manage your recruitment partners and track their activity</p>
        </div>
        <Button onClick={() => setIsAddOpen(true)}>
          <UserPlus className="size-4 mr-1.5" />
          Add Partner
        </Button>
      </div>

      <StatCardGrid columns={2}>
        <StatCard
          title="Total Partners"
          value={totalCount}
          icon={Users}
          iconColor="sky"
          description="All time"
          loading={isLoading}
        />
        <StatCard
          title="Active Partners"
          value={activeCount}
          icon={UserCheck}
          iconColor="emerald"
          description="Currently active"
          loading={isLoading}
        />
      </StatCardGrid>

      <Card>
        <CardHeader>
          <CardTitle>All Partners</CardTitle>
          <CardDescription>{totalCount} partners total</CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <TableSkeleton rows={5} columns={7} />
          ) : partners?.length === 0 ? (
            <p className="text-sm text-muted-foreground">No partners yet. Click "Add Partner" to get started.</p>
          ) : (
            <div className="overflow-auto rounded-md border">
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead>Name</TableHead>
                  <TableHead>Email</TableHead>
                  <TableHead>Phone</TableHead>
                  <TableHead>Tier</TableHead>
                  <TableHead>Claimed</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {partners?.map((p) => (
                  <TableRow key={p.id}>
                    <TableCell className="font-medium">{p.name}</TableCell>
                    <TableCell className="text-muted-foreground">{p.email}</TableCell>
                    <TableCell className="text-muted-foreground">{p.phone}</TableCell>
                    <TableCell>{renderTierStatus({ id: p.id, tier: p.tier })}</TableCell>
                    <TableCell className="text-muted-foreground">{claimCounts?.[p.id] ?? 0}</TableCell>
                    <TableCell>
                      <Badge variant={p.status === 'active' ? 'success' : 'inactive'}>
                        {p.status}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      {p.status === 'active' && (
                        <Button
                          variant="ghost"
                          size="sm"
                          className="text-red-600 hover:text-red-700 hover:bg-red-50"
                          onClick={() => setDeactivateId(p.id)}
                        >
                          <ShieldOff className="size-4 mr-1" />
                          Deactivate
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Add Partner Dialog */}
      <Dialog open={isAddOpen} onOpenChange={setIsAddOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Add Partner</DialogTitle>
            <DialogDescription>
              Create a new partner account. They will use these credentials to log in.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleAdd} className="space-y-4">
            <div>
              <Label htmlFor="partner-name">Name</Label>
              <Input
                id="partner-name"
                value={form.name}
                onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                required
                className="mt-1.5"
              />
            </div>
            <div>
              <Label htmlFor="partner-email">Email</Label>
              <Input
                id="partner-email"
                type="email"
                value={form.email}
                onChange={e => setForm(f => ({ ...f, email: e.target.value }))}
                required
                className="mt-1.5"
              />
            </div>
            <div>
              <Label htmlFor="partner-phone">Phone</Label>
              <Input
                id="partner-phone"
                value={form.phone}
                onChange={e => setForm(f => ({ ...f, phone: e.target.value }))}
                required
                className="mt-1.5"
              />
            </div>
            <div>
              <Label htmlFor="partner-nric">NRIC (optional)</Label>
              <Input
                id="partner-nric"
                value={form.nric}
                onChange={e => setForm(f => ({ ...f, nric: e.target.value }))}
                className="mt-1.5"
              />
            </div>
            <div>
              <Label htmlFor="partner-password">Temporary Password</Label>
              <Input
                id="partner-password"
                type="password"
                value={form.password}
                onChange={e => setForm(f => ({ ...f, password: e.target.value }))}
                required
                minLength={6}
                className="mt-1.5"
              />
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setIsAddOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={createPartner.isPending}>
                {createPartner.isPending ? 'Creating...' : 'Create Partner'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Request Tier Dialog */}
      <Dialog open={isTierOpen} onOpenChange={setIsTierOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Request Tier Assignment</DialogTitle>
            <DialogDescription>
              Select a tier to request for this partner. An admin will review and approve or reject.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label>Tier</Label>
              <Select onValueChange={setSelectedTierId} value={selectedTierId}>
                <SelectTrigger className="mt-1.5">
                  <SelectValue placeholder="Select a tier" />
                </SelectTrigger>
                <SelectContent>
                  {tiers?.map((tier) => (
                    <SelectItem key={tier.id} value={tier.id}>
                      {tier.name} — RM{tier.reward_amount}/attendance
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setIsTierOpen(false)}>
                Cancel
              </Button>
              <Button
                onClick={handleRequestTier}
                disabled={!selectedTierId || requestTier.isPending}
              >
                {requestTier.isPending ? 'Requesting...' : 'Request Tier'}
              </Button>
            </DialogFooter>
          </div>
        </DialogContent>
      </Dialog>

      {/* Deactivate Confirmation */}
      <AlertDialog open={!!deactivateId} onOpenChange={(open) => !open && setDeactivateId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Deactivate Partner?</AlertDialogTitle>
            <AlertDialogDescription>
              This will prevent the partner from logging in. Their active links will be deactivated. Existing registrations will remain attributed.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDeactivate}
              className="bg-red-600 hover:bg-red-700"
            >
              {deactivatePartner.isPending ? 'Deactivating...' : 'Deactivate'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/agent-portal/src/pages/Partners.tsx
git commit -m "feat(agent-portal): add tier management to Partners page"
```

---

### Task 6: Agent Portal — Update useRequestTier for Partner Support

**Files:**
- Modify: `apps/agent-portal/src/hooks/useSubAgents.ts`

- [ ] **Step 1: Update useRequestTier mutation input type**

In `apps/agent-portal/src/hooks/useSubAgents.ts`, find the `useRequestTier` function and update the input type:

Find:
```typescript
    mutationFn: async (input: { agent_id: string; tier_id: string }) => {
```

Replace with:
```typescript
    mutationFn: async (input: { agent_id?: string; partner_id?: string; tier_id: string }) => {
```

Also add partner query invalidation in `onSuccess`:

Find:
```typescript
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['my-tier-requests'] });
      queryClient.invalidateQueries({ queryKey: ['my-sub-agents'] });
    },
```

Replace with:
```typescript
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['my-tier-requests'] });
      queryClient.invalidateQueries({ queryKey: ['my-sub-agents'] });
      queryClient.invalidateQueries({ queryKey: ['my-partners'] });
    },
```

- [ ] **Step 2: Commit**

```bash
git add apps/agent-portal/src/hooks/useSubAgents.ts
git commit -m "feat(hooks): extend useRequestTier to support partner_id"
```

---

### Task 7: Agent Portal — Block PartnerLinks Without Tier

**Files:**
- Modify: `apps/agent-portal/src/pages/PartnerLinks.tsx`

- [ ] **Step 1: Add tier guard**

In `apps/agent-portal/src/pages/PartnerLinks.tsx`, after the existing role guard (around line 42) and before the hooks that use partner data, add a tier guard:

Find (after the role guard closing brace):
```typescript
  const { data: campaigns, isLoading: campaignsLoading } = useActiveCampaigns();
```

Add before it:
```typescript
  if (partner && !partner.tier_id) {
    return (
      <div className="flex flex-col gap-4 animate-fade-in">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">My Links</h1>
          <p className="text-sm text-muted-foreground">Manage your registration links</p>
        </div>
        <Card>
          <CardContent className="py-8 text-center">
            <p className="text-muted-foreground">You need an approved tier assignment before you can generate links.</p>
            <p className="text-sm text-muted-foreground mt-1">Please contact your unit administrator to request a tier.</p>
          </CardContent>
        </Card>
      </div>
    );
  }

```

Note: `partner` comes from `useAuth()` which is already called above. The `PartnerWithAgent` type doesn't have `tier_id` in the auth response, but the `Partner` interface now has `tier_id`. We need to check if useAuth fetches the partner with tier_id. Looking at useAuth, it does `select('*, agent:agents(*)')` on partners — the `*` will include `tier_id` since it's now a column on the partners table. So `partner?.tier_id` will work.

- [ ] **Step 2: Commit**

```bash
git add apps/agent-portal/src/pages/PartnerLinks.tsx
git commit -m "fix: block partner link generation without approved tier"
```

---

### Task 8: Admin Portal — Update Tier Request Hooks for Partners

**Files:**
- Modify: `apps/admin-portal/src/hooks/useTierRequests.ts`

- [ ] **Step 1: Update usePendingTierRequests to join partners**

Replace the entire content of `apps/admin-portal/src/hooks/useTierRequests.ts`:

```typescript
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import type { TierRequestWithDetails } from '@agent-system/shared-types';

export function usePendingTierRequests() {
  return useQuery({
    queryKey: ['tier-requests', 'pending'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('tier_requests')
        .select(`
          *,
          agent:agents!tier_requests_agent_id_fkey(*),
          partner:partners!tier_requests_partner_id_fkey(*),
          requested_tier:tiers(*),
          requester:agents!tier_requests_requested_by_fkey(*)
        `)
        .eq('status', 'pending')
        .order('created_at', { ascending: true });

      if (error) throw error;
      return data as TierRequestWithDetails[];
    },
  });
}

export function usePendingTierRequestCount() {
  return useQuery({
    queryKey: ['tier-requests', 'pending-count'],
    queryFn: async () => {
      const { count, error } = await supabase
        .from('tier_requests')
        .select('*', { count: 'exact', head: true })
        .eq('status', 'pending');

      if (error) throw error;
      return count ?? 0;
    },
  });
}

export function useApproveTierRequest() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (requestId: string) => {
      const { data: request, error: fetchError } = await supabase
        .from('tier_requests')
        .select('agent_id, partner_id, requested_tier_id')
        .eq('id', requestId)
        .single();

      if (fetchError || !request) throw new Error('Tier request not found');

      // Update the request status
      const { error: updateError } = await supabase
        .from('tier_requests')
        .update({
          status: 'approved',
          reviewed_at: new Date().toISOString(),
        })
        .eq('id', requestId);

      if (updateError) throw updateError;

      // Update tier on the target (agent or partner)
      if (request.agent_id) {
        const { error: agentError } = await supabase
          .from('agents')
          .update({ tier_id: request.requested_tier_id })
          .eq('id', request.agent_id);
        if (agentError) throw agentError;
      } else if (request.partner_id) {
        const { error: partnerError } = await supabase
          .from('partners')
          .update({ tier_id: request.requested_tier_id })
          .eq('id', request.partner_id);
        if (partnerError) throw partnerError;
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tier-requests'] });
      queryClient.invalidateQueries({ queryKey: ['agents'] });
    },
  });
}

export function useRejectTierRequest() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ requestId, adminNotes }: { requestId: string; adminNotes?: string }) => {
      const { error } = await supabase
        .from('tier_requests')
        .update({
          status: 'rejected',
          admin_notes: adminNotes || null,
          reviewed_at: new Date().toISOString(),
        })
        .eq('id', requestId);

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tier-requests'] });
    },
  });
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/admin-portal/src/hooks/useTierRequests.ts
git commit -m "feat(admin): update tier request hooks to support partner approvals"
```

---

### Task 9: Admin Portal — Update AgentList Tier Requests Table

**Files:**
- Modify: `apps/admin-portal/src/pages/agents/AgentList.tsx`

- [ ] **Step 1: Update the pending tier requests table headers and rows**

In `apps/admin-portal/src/pages/agents/AgentList.tsx`, find the tier requests table header section (around line 132):

Find:
```typescript
                  <TableRow className="hover:bg-transparent">
                    <TableHead>Agent Name</TableHead>
                    <TableHead>Agent Code</TableHead>
                    <TableHead>Requested By</TableHead>
                    <TableHead>Requested Tier</TableHead>
                    <TableHead>Reward</TableHead>
                    <TableHead>Requested</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
```

Replace with:
```typescript
                  <TableRow className="hover:bg-transparent">
                    <TableHead>Name</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead>Code</TableHead>
                    <TableHead>Requested By</TableHead>
                    <TableHead>Requested Tier</TableHead>
                    <TableHead>Reward</TableHead>
                    <TableHead>Requested</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
```

Then find the table body rows (around line 143):

Find:
```typescript
                  {pendingRequests.map((req) => (
                    <TableRow key={req.id}>
                      <TableCell className="font-medium">{req.agent?.name ?? '—'}</TableCell>
                      <TableCell className="text-muted-foreground">{req.agent?.agent_code ?? '—'}</TableCell>
                      <TableCell className="text-muted-foreground">{req.requester?.name ?? '—'}</TableCell>
```

Replace with:
```typescript
                  {pendingRequests.map((req) => {
                    const isPartner = !!req.partner_id;
                    const name = isPartner ? req.partner?.name : req.agent?.name;
                    const code = isPartner ? '—' : req.agent?.agent_code;
                    return (
                    <TableRow key={req.id}>
                      <TableCell className="font-medium">{name ?? '—'}</TableCell>
                      <TableCell>
                        <Badge variant={isPartner ? 'info' : 'default'}>
                          {isPartner ? 'Partner' : 'Agent'}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-muted-foreground">{code ?? '—'}</TableCell>
                      <TableCell className="text-muted-foreground">{req.requester?.name ?? '—'}</TableCell>
```

And find the closing of the map (the row's closing tags):

Find:
```typescript
                    </TableRow>
                  ))}
```

Replace with:
```typescript
                    </TableRow>
                    );
                  })}
```

- [ ] **Step 2: Commit**

```bash
git add apps/admin-portal/src/pages/agents/AgentList.tsx
git commit -m "feat(admin): add Type column to tier requests table for agent/partner"
```

---

### Task 10: Final Verification

- [ ] **Step 1: Run typecheck**

Run: `pnpm -r typecheck 2>&1; pnpm --filter admin-portal exec tsc --noEmit 2>&1; pnpm --filter agent-portal exec tsc --noEmit 2>&1`
Expected: No type errors.

- [ ] **Step 2: Run build**

Run: `pnpm build 2>&1 | tail -20`
Expected: All three apps build successfully.

- [ ] **Step 3: Deploy migration and edge function**

```bash
npx supabase db push
npx supabase functions deploy request-tier --no-verify-jwt
```

- [ ] **Step 4: Push to trigger auto-deploy**

```bash
git push origin main
```

- [ ] **Step 5: Manual verification checklist**

1. Agent Admin logs in → Partners page shows Tier column with "Request Tier" buttons
2. Click "Request Tier" on a partner → select tier → submit → shows "Pending Approval"
3. Admin portal → Units page shows partner tier request with "Partner" type badge
4. Admin approves → partner's tier is set
5. Partner logs in → can access PartnerLinks and generate links
6. Partner without tier → sees "tier required" message on PartnerLinks
