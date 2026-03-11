# Partners (Sub-Agents) Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enable Agents (Units) to create and manage Partners who can claim and share invitation links from their Agent's pool.

**Architecture:** New `partners` table with RLS, two Edge Functions for partner lifecycle management (`create-partner`, `deactivate-partner`), role-aware auth hook in the Agent Portal, and 3 new pages (Partners management, Available Invitations, My Claimed Invitations) with role-based routing/navigation.

**Tech Stack:** PostgreSQL (Supabase), Deno Edge Functions, React 18, TanStack Router, TanStack Query, TypeScript, shadcn/ui

**Spec:** `docs/superpowers/specs/2026-03-11-partners-sub-agents-design.md`

---

## File Structure

### Files to Create
| File | Responsibility |
|------|---------------|
| `supabase/migrations/20260311000004_partners.sql` | Partners table, invitations column, RLS policies, helper functions |
| `supabase/functions/create-partner/index.ts` | Edge Function: create auth user + partner record |
| `supabase/functions/deactivate-partner/index.ts` | Edge Function: ban user, deactivate partner, release invitations |
| `packages/shared-types/src/partner.ts` | Partner and PartnerWithAgent TypeScript interfaces |
| `apps/agent-portal/src/hooks/usePartners.ts` | React Query hooks for partner CRUD and invocation of Edge Functions |
| `apps/agent-portal/src/hooks/usePartnerInvitations.ts` | React Query hooks for partner invitation browsing, claiming |
| `apps/agent-portal/src/pages/Partners.tsx` | Agent's partner management page |
| `apps/agent-portal/src/pages/AvailableInvitations.tsx` | Partner's unclaimed invitation browser |
| `apps/agent-portal/src/pages/MyClaimedInvitations.tsx` | Partner's claimed invitations list |

### Files to Modify
| File | Change |
|------|--------|
| `packages/shared-types/src/database.ts` | Add `claimed_by_partner_id` to `Invitation` interface |
| `packages/shared-types/src/index.ts` | Export new partner types |
| `apps/agent-portal/src/hooks/useAuth.ts` | Add partner detection after agent lookup, expose `role` |
| `apps/agent-portal/src/components/Layout.tsx` | Role-based navigation, partner welcome message |
| `apps/agent-portal/src/router.tsx` | Add new routes, role-based route guards |
| `apps/agent-portal/src/pages/Dashboard.tsx` | Conditional agent/partner dashboard |

---

## Chunk 1: Database Migration & Shared Types

### Task 1: Create the partners database migration

**Files:**
- Create: `supabase/migrations/20260311000004_partners.sql`

- [ ] **Step 1: Create the migration file**

```sql
-- Partners table
CREATE TABLE partners (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id    UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  user_id     UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  email       TEXT NOT NULL UNIQUE,
  phone       TEXT NOT NULL,
  nric        TEXT,
  status      agent_status NOT NULL DEFAULT 'active',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_partners_agent ON partners(agent_id);
CREATE INDEX idx_partners_user ON partners(user_id);

CREATE TRIGGER partners_updated_at
  BEFORE UPDATE ON partners
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- Add claimed_by_partner_id to invitations
ALTER TABLE invitations
  ADD COLUMN claimed_by_partner_id UUID REFERENCES partners(id) ON DELETE SET NULL;

CREATE INDEX idx_invitations_partner ON invitations(claimed_by_partner_id);

-- RLS helper functions
CREATE OR REPLACE FUNCTION get_partner_id()
RETURNS UUID STABLE AS $$
  SELECT id FROM partners WHERE user_id = auth.uid() AND status = 'active';
$$ LANGUAGE sql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION get_partner_agent_id()
RETURNS UUID STABLE AS $$
  SELECT agent_id FROM partners WHERE user_id = auth.uid() AND status = 'active';
$$ LANGUAGE sql SECURITY DEFINER;

-- RLS on partners table
ALTER TABLE partners ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admin full access to partners"
  ON partners FOR ALL TO authenticated USING (is_admin());

CREATE POLICY "Agents manage own partners"
  ON partners FOR ALL TO authenticated
  USING (agent_id = get_agent_id())
  WITH CHECK (agent_id = get_agent_id());

CREATE POLICY "Partners read own data"
  ON partners FOR SELECT TO authenticated USING (user_id = auth.uid());

-- Partner RLS on invitations
CREATE POLICY "Partners read agent invitations"
  ON invitations FOR SELECT TO authenticated
  USING (agent_id = get_partner_agent_id());

CREATE POLICY "Partners claim invitations"
  ON invitations FOR UPDATE TO authenticated
  USING (
    agent_id = get_partner_agent_id()
    AND claimed_by_partner_id IS NULL
  )
  WITH CHECK (
    agent_id = get_partner_agent_id()
    AND claimed_by_partner_id = get_partner_id()
  );

-- RPC for atomic partner deactivation (used by deactivate-partner Edge Function)
CREATE OR REPLACE FUNCTION deactivate_partner_and_release(partner_uuid UUID)
RETURNS INTEGER AS $$
DECLARE
  released_count INTEGER;
BEGIN
  -- Update partner status
  UPDATE partners SET status = 'inactive' WHERE id = partner_uuid;

  -- Release unclaimed pending invitations
  WITH released AS (
    UPDATE invitations
    SET claimed_by_partner_id = NULL
    WHERE claimed_by_partner_id = partner_uuid AND status = 'pending'
    RETURNING id
  )
  SELECT count(*) INTO released_count FROM released;

  RETURN released_count;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
```

- [ ] **Step 2: Verify migration syntax**

Run: `cd /Users/paullee/Documents/project/martin/DATA && cat supabase/migrations/20260311000004_partners.sql`
Expected: File contents displayed without syntax errors.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260311000004_partners.sql
git commit -m "feat(db): add partners table, RLS policies, and invitation claiming"
```

### Task 2: Add Partner TypeScript types

**Files:**
- Create: `packages/shared-types/src/partner.ts`
- Modify: `packages/shared-types/src/database.ts` (add `claimed_by_partner_id` to `Invitation`)
- Modify: `packages/shared-types/src/index.ts` (add export)

- [ ] **Step 1: Create the partner types file**

```typescript
// packages/shared-types/src/partner.ts
import { AgentStatus } from './enums';
import type { Agent } from './database';

export interface Partner {
  id: string;
  agent_id: string;
  user_id: string;
  name: string;
  email: string;
  phone: string;
  nric: string | null;
  status: AgentStatus;
  created_at: string;
  updated_at: string;
}

export interface PartnerWithAgent extends Partner {
  agent: Agent;
}
```

- [ ] **Step 2: Add `claimed_by_partner_id` to Invitation interface**

In `packages/shared-types/src/database.ts`, add to the `Invitation` interface after line 75 (`registered_at`):

```typescript
  claimed_by_partner_id: string | null;
```

- [ ] **Step 3: Export partner types from index**

In `packages/shared-types/src/index.ts`, add:

```typescript
export * from './partner';
```

- [ ] **Step 4: Verify types compile**

Run: `cd /Users/paullee/Documents/project/martin/DATA && pnpm -r typecheck`
Expected: No type errors.

- [ ] **Step 5: Commit**

```bash
git add packages/shared-types/src/partner.ts packages/shared-types/src/database.ts packages/shared-types/src/index.ts
git commit -m "feat(types): add Partner types and claimed_by_partner_id to Invitation"
```

---

## Chunk 2: Edge Functions

### Task 3: Create the `create-partner` Edge Function

**Files:**
- Create: `supabase/functions/create-partner/index.ts`

Reference: Follow the pattern in `supabase/functions/send-whatsapp-pin/index.ts` for CORS headers, Deno serve, and supabase client setup.

- [ ] **Step 1: Create the Edge Function**

```typescript
// supabase/functions/create-partner/index.ts
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
    const { name, email, phone, nric, password } = await req.json();

    // Validate required fields
    if (!name || !email || !phone || !password) {
      return new Response(
        JSON.stringify({ error: "name, email, phone, and password are required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Validate password length
    if (password.length < 6) {
      return new Response(
        JSON.stringify({ error: "Password must be at least 6 characters" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Get caller's auth token to identify the agent
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(
        JSON.stringify({ error: "Unauthorized" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Verify caller is an agent
    const { data: { user: caller }, error: authError } = await supabase.auth.getUser(
      authHeader.replace("Bearer ", "")
    );

    if (authError || !caller) {
      return new Response(
        JSON.stringify({ error: "Unauthorized" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Get agent_id from the agents table
    const { data: agent, error: agentError } = await supabase
      .from("agents")
      .select("id")
      .eq("user_id", caller.id)
      .single();

    if (agentError || !agent) {
      return new Response(
        JSON.stringify({ error: "Only agents can create partners" }),
        { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Create auth user
    const { data: newUser, error: createError } = await supabase.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
    });

    if (createError) {
      const status = createError.message?.includes("already") ? 409 : 400;
      return new Response(
        JSON.stringify({ error: createError.message || "Failed to create user" }),
        { status, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Insert partner record
    const { data: partner, error: partnerError } = await supabase
      .from("partners")
      .insert({
        agent_id: agent.id,
        user_id: newUser.user.id,
        name,
        email,
        phone,
        nric: nric || null,
      })
      .select()
      .single();

    if (partnerError) {
      // Cleanup: delete orphaned auth user
      await supabase.auth.admin.deleteUser(newUser.user.id);
      return new Response(
        JSON.stringify({ error: partnerError.message || "Failed to create partner record" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    return new Response(
      JSON.stringify({ success: true, partner }),
      { status: 201, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("create-partner error:", error);
    return new Response(
      JSON.stringify({ error: "Internal server error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
```

- [ ] **Step 2: Commit**

```bash
git add supabase/functions/create-partner/index.ts
git commit -m "feat(edge-fn): add create-partner Edge Function"
```

### Task 4: Create the `deactivate-partner` Edge Function

**Files:**
- Create: `supabase/functions/deactivate-partner/index.ts`

- [ ] **Step 1: Create the Edge Function**

```typescript
// supabase/functions/deactivate-partner/index.ts
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
    const { partner_id } = await req.json();

    if (!partner_id) {
      return new Response(
        JSON.stringify({ error: "partner_id is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Verify caller is the parent agent
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

    // Get agent_id
    const { data: agent, error: agentError } = await supabase
      .from("agents")
      .select("id")
      .eq("user_id", caller.id)
      .single();

    if (agentError || !agent) {
      return new Response(
        JSON.stringify({ error: "Only agents can deactivate partners" }),
        { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Verify partner belongs to this agent
    const { data: partner, error: partnerError } = await supabase
      .from("partners")
      .select("id, user_id, agent_id")
      .eq("id", partner_id)
      .single();

    if (partnerError || !partner) {
      return new Response(
        JSON.stringify({ error: "Partner not found" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (partner.agent_id !== agent.id) {
      return new Response(
        JSON.stringify({ error: "You can only deactivate your own partners" }),
        { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Step 1: Ban the auth user first (prevents new requests)
    await supabase.auth.admin.updateUserById(partner.user_id, {
      ban_duration: "876000h",
    });

    // Step 2: Atomically update status and release pending invitations via RPC
    const { data: releasedCount, error: rpcError } = await supabase
      .rpc("deactivate_partner_and_release", { partner_uuid: partner_id });

    if (rpcError) {
      console.error("deactivate RPC error:", rpcError);
      return new Response(
        JSON.stringify({ error: "Failed to deactivate partner" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    return new Response(
      JSON.stringify({ success: true, released_invitations: releasedCount }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("deactivate-partner error:", error);
    return new Response(
      JSON.stringify({ error: "Internal server error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
```

- [ ] **Step 2: Commit**

```bash
git add supabase/functions/deactivate-partner/index.ts
git commit -m "feat(edge-fn): add deactivate-partner Edge Function"
```

---

## Chunk 3: Auth Hook & Data Hooks

### Task 5: Update `useAuth` hook for role detection

**Files:**
- Modify: `apps/agent-portal/src/hooks/useAuth.ts`

This is the most critical change — the auth hook must detect whether the logged-in user is an agent or a partner.

- [ ] **Step 1: Rewrite useAuth to support both roles**

Replace the entire contents of `apps/agent-portal/src/hooks/useAuth.ts` with:

```typescript
import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import type { User, Session } from '@supabase/supabase-js';
import type { AgentWithTier, PartnerWithAgent } from '@agent-system/shared-types';

interface AuthState {
  user: User | null;
  session: Session | null;
  agent: AgentWithTier | null;
  partner: PartnerWithAgent | null;
  role: 'agent' | 'partner' | null;
  isLoading: boolean;
}

export function useAuth() {
  const [state, setState] = useState<AuthState>({
    user: null,
    session: null,
    agent: null,
    partner: null,
    role: null,
    isLoading: true,
  });

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setState(prev => ({ ...prev, session, user: session?.user ?? null }));
      if (session?.user) {
        fetchUserRole(session.user.id);
      } else {
        setState(prev => ({ ...prev, isLoading: false }));
      }
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setState(prev => ({ ...prev, session, user: session?.user ?? null }));
      if (session?.user) {
        fetchUserRole(session.user.id);
      } else {
        setState(prev => ({ ...prev, agent: null, partner: null, role: null, isLoading: false }));
      }
    });

    return () => subscription.unsubscribe();
  }, []);

  const fetchUserRole = async (userId: string) => {
    // Try agent first
    const { data: agentData, error: agentError } = await supabase
      .from('agents')
      .select('*, tier:tiers(*)')
      .eq('user_id', userId)
      .single();

    if (!agentError && agentData) {
      setState(prev => ({
        ...prev,
        agent: agentData as AgentWithTier,
        partner: null,
        role: 'agent',
        isLoading: false,
      }));
      return;
    }

    // Try partner
    const { data: partnerData, error: partnerError } = await supabase
      .from('partners')
      .select('*, agent:agents(*)')
      .eq('user_id', userId)
      .eq('status', 'active')
      .single();

    if (!partnerError && partnerData) {
      setState(prev => ({
        ...prev,
        agent: null,
        partner: partnerData as PartnerWithAgent,
        role: 'partner',
        isLoading: false,
      }));
      return;
    }

    // Neither agent nor partner — sign out (unauthorized)
    await supabase.auth.signOut();
    setState(prev => ({ ...prev, agent: null, partner: null, role: null, isLoading: false }));
  };

  const signIn = async (email: string, password: string) => {
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    return { error };
  };

  const signOut = async () => {
    await supabase.auth.signOut();
    setState({ user: null, session: null, agent: null, partner: null, role: null, isLoading: false });
  };

  return {
    ...state,
    signIn,
    signOut,
  };
}
```

- [ ] **Step 2: Verify typecheck passes**

Run: `pnpm -r typecheck`
Expected: Possible errors in files that use `useAuth()` — those will be fixed in subsequent tasks. The hook itself should be type-correct.

- [ ] **Step 3: Commit**

```bash
git add apps/agent-portal/src/hooks/useAuth.ts
git commit -m "feat(auth): add partner role detection to useAuth hook"
```

### Task 6: Create `usePartners` hook

**Files:**
- Create: `apps/agent-portal/src/hooks/usePartners.ts`

- [ ] **Step 1: Create the partners hook**

```typescript
// apps/agent-portal/src/hooks/usePartners.ts
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import type { Partner } from '@agent-system/shared-types';

export function useMyPartners(agentId: string | undefined) {
  return useQuery({
    queryKey: ['my-partners', agentId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('partners')
        .select('*')
        .eq('agent_id', agentId)
        .order('created_at', { ascending: false });

      if (error) throw error;
      return data as Partner[];
    },
    enabled: !!agentId,
  });
}

export function usePartnerClaimCounts(agentId: string | undefined) {
  return useQuery({
    queryKey: ['partner-claim-counts', agentId],
    queryFn: async () => {
      // Get all invitations with claimed_by_partner_id for this agent's partners
      const { data, error } = await supabase
        .from('invitations')
        .select('claimed_by_partner_id')
        .eq('agent_id', agentId)
        .not('claimed_by_partner_id', 'is', null);

      if (error) throw error;

      // Count per partner
      const counts: Record<string, number> = {};
      data?.forEach(inv => {
        const pid = inv.claimed_by_partner_id;
        if (pid) counts[pid] = (counts[pid] || 0) + 1;
      });
      return counts;
    },
    enabled: !!agentId,
  });
}

export function useCreatePartner() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: {
      name: string;
      email: string;
      phone: string;
      nric?: string;
      password: string;
    }) => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error('Not authenticated');

      const response = await supabase.functions.invoke('create-partner', {
        body: input,
      });

      if (response.error) throw new Error(response.error.message || 'Failed to create partner');
      if (response.data?.error) throw new Error(response.data.error);
      return response.data.partner as Partner;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['my-partners'] });
    },
  });
}

export function useDeactivatePartner() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (partnerId: string) => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error('Not authenticated');

      const response = await supabase.functions.invoke('deactivate-partner', {
        body: { partner_id: partnerId },
      });

      if (response.error) throw new Error(response.error.message || 'Failed to deactivate partner');
      if (response.data?.error) throw new Error(response.data.error);
      return response.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['my-partners'] });
      queryClient.invalidateQueries({ queryKey: ['partner-claim-counts'] });
    },
  });
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/agent-portal/src/hooks/usePartners.ts
git commit -m "feat(hooks): add usePartners hook for partner CRUD"
```

### Task 7: Create `usePartnerInvitations` hook

**Files:**
- Create: `apps/agent-portal/src/hooks/usePartnerInvitations.ts`

- [ ] **Step 1: Create the partner invitations hook**

```typescript
// apps/agent-portal/src/hooks/usePartnerInvitations.ts
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import type { InvitationWithRelations } from '@agent-system/shared-types';

export function useAvailableInvitations(partnerAgentId: string | undefined) {
  return useQuery({
    queryKey: ['available-invitations', partnerAgentId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('invitations')
        .select(`
          *,
          slot:slots(
            *,
            campaign:campaigns(*)
          )
        `)
        .eq('agent_id', partnerAgentId)
        .is('claimed_by_partner_id', null)
        .eq('status', 'pending')
        .order('created_at', { ascending: false });

      if (error) throw error;
      return data as InvitationWithRelations[];
    },
    enabled: !!partnerAgentId,
  });
}

export function useMyClaimedInvitations(partnerId: string | undefined) {
  return useQuery({
    queryKey: ['my-claimed-invitations', partnerId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('invitations')
        .select(`
          *,
          slot:slots(
            *,
            campaign:campaigns(*)
          )
        `)
        .eq('claimed_by_partner_id', partnerId)
        .order('created_at', { ascending: false });

      if (error) throw error;
      return data as InvitationWithRelations[];
    },
    enabled: !!partnerId,
  });
}

export function useClaimInvitation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      invitationId,
      partnerId,
    }: {
      invitationId: string;
      partnerId: string;
    }) => {
      const { data, error, count } = await supabase
        .from('invitations')
        .update({ claimed_by_partner_id: partnerId })
        .eq('id', invitationId)
        .is('claimed_by_partner_id', null)
        .select();

      if (error) throw error;

      // If no rows were updated, another partner claimed it first
      if (!data || data.length === 0) {
        throw new Error('ALREADY_CLAIMED');
      }

      return data[0];
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['available-invitations'] });
      queryClient.invalidateQueries({ queryKey: ['my-claimed-invitations'] });
    },
  });
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/agent-portal/src/hooks/usePartnerInvitations.ts
git commit -m "feat(hooks): add usePartnerInvitations for claiming and browsing"
```

---

## Chunk 4: Layout & Router

### Task 8: Update Layout for role-based navigation

**Files:**
- Modify: `apps/agent-portal/src/components/Layout.tsx`

- [ ] **Step 1: Replace Layout.tsx with role-aware navigation**

Replace the entire contents of `apps/agent-portal/src/components/Layout.tsx`:

```typescript
import { useState } from 'react';
import { Link, useLocation } from '@tanstack/react-router';
import { cn, Button, Sheet, SheetContent, SheetTrigger } from '@agent-system/shared-ui';
import { Home, Calendar, Send, Award, LogOut, Menu, Users, CheckSquare } from 'lucide-react';
import { useAuth } from '../hooks/useAuth';

const agentNavigation = [
  { name: 'Dashboard', href: '/', icon: Home },
  { name: 'Events', href: '/campaigns', icon: Calendar },
  { name: 'My Invitations', href: '/invitations', icon: Send },
  { name: 'Rewards', href: '/rewards', icon: Award },
  { name: 'Partners', href: '/partners', icon: Users },
];

const partnerNavigation = [
  { name: 'Dashboard', href: '/', icon: Home },
  { name: 'Available Invitations', href: '/available-invitations', icon: Send },
  { name: 'My Claimed Invitations', href: '/my-invitations', icon: CheckSquare },
];

export function Layout({ children }: { children: React.ReactNode }) {
  const location = useLocation();
  const { agent, partner, role, signOut } = useAuth();
  const [mobileOpen, setMobileOpen] = useState(false);

  const navigation = role === 'partner' ? partnerNavigation : agentNavigation;
  const displayName = role === 'partner' ? partner?.name : agent?.name;
  const subtitle = role === 'partner'
    ? `Partner · ${partner?.agent?.name ?? 'Unknown Unit'}`
    : agent?.tier?.name;

  const SidebarContent = () => (
    <>
      <div className="flex h-16 items-center gap-3 px-6 border-b border-white/10">
        <div className="h-9 w-9 rounded-xl bg-sky-600 flex items-center justify-center shadow-lg">
          <Users className="h-5 w-5 text-white" />
        </div>
        <span className="font-semibold text-lg text-white">
          {role === 'partner' ? 'Partner Portal' : 'Unit Portal'}
        </span>
      </div>
      <nav className="p-4 space-y-1">
        {navigation.map((item) => {
          const isActive = location.pathname === item.href ||
            (item.href !== '/' && location.pathname.startsWith(item.href));
          return (
            <Link
              key={item.name}
              to={item.href}
              onClick={() => setMobileOpen(false)}
              className={cn(
                'flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all duration-200',
                isActive
                  ? 'bg-white/15 text-white shadow-sm'
                  : 'text-slate-300 hover:bg-white/10 hover:text-white'
              )}
            >
              <item.icon className="h-5 w-5" />
              {item.name}
            </Link>
          );
        })}
      </nav>
    </>
  );

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="hidden lg:fixed lg:inset-y-0 lg:left-0 lg:z-50 lg:w-64 lg:flex lg:flex-col bg-slate-900">
        <SidebarContent />
      </div>

      <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
        <SheetContent side="left" className="w-64 p-0 bg-slate-900 border-r-0">
          <SidebarContent />
        </SheetContent>
      </Sheet>

      <div className="lg:pl-64">
        <header className="sticky top-0 z-40 h-16 bg-white/80 backdrop-blur-md border-b border-slate-200/60 shadow-sm">
          <div className="flex h-16 items-center justify-between px-4 lg:px-6">
            <div className="flex items-center gap-4">
              <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
                <SheetTrigger asChild>
                  <Button variant="ghost" size="sm" className="lg:hidden h-9 w-9 p-0">
                    <Menu className="h-5 w-5" />
                  </Button>
                </SheetTrigger>
              </Sheet>
              {displayName && (
                <p className="text-sm text-slate-500">
                  Welcome, <span className="font-medium text-slate-900">{displayName}</span>
                  {subtitle && (
                    <>{' '}· <span className="text-sky-600 font-medium">{subtitle}</span></>
                  )}
                </p>
              )}
            </div>
            <Button
              variant="ghost"
              size="sm"
              onClick={signOut}
              className="text-slate-600 hover:text-slate-900 hover:bg-slate-100"
            >
              <LogOut className="h-4 w-4 mr-2" />
              Sign Out
            </Button>
          </div>
        </header>
        <main className="p-4 lg:p-6">{children}</main>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/agent-portal/src/components/Layout.tsx
git commit -m "feat(layout): add role-based navigation for agents and partners"
```

### Task 9: Update router with new routes

**Files:**
- Modify: `apps/agent-portal/src/router.tsx`

- [ ] **Step 1: Replace router.tsx with new routes**

Replace the entire contents of `apps/agent-portal/src/router.tsx`:

```typescript
import {
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  redirect,
} from '@tanstack/react-router';
import { Layout } from './components/Layout';
import { Login } from './pages/Login';
import { Dashboard } from './pages/Dashboard';
import { Campaigns } from './pages/Campaigns';
import { Invitations } from './pages/Invitations';
import { Rewards } from './pages/Rewards';
import { Partners } from './pages/Partners';
import { AvailableInvitations } from './pages/AvailableInvitations';
import { MyClaimedInvitations } from './pages/MyClaimedInvitations';
import { supabase } from './lib/supabase';

const isAuthenticated = async () => {
  const { data: { session } } = await supabase.auth.getSession();
  return !!session;
};

const rootRoute = createRootRoute({
  component: () => <Outlet />,
});

const loginRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/login',
  component: Login,
  beforeLoad: async () => {
    if (await isAuthenticated()) {
      throw redirect({ to: '/' });
    }
  },
});

const authenticatedRoute = createRoute({
  getParentRoute: () => rootRoute,
  id: 'authenticated',
  component: () => (
    <Layout>
      <Outlet />
    </Layout>
  ),
  beforeLoad: async () => {
    if (!(await isAuthenticated())) {
      throw redirect({ to: '/login' });
    }
  },
});

const indexRoute = createRoute({
  getParentRoute: () => authenticatedRoute,
  path: '/',
  component: Dashboard,
});

// Agent routes
const campaignsRoute = createRoute({
  getParentRoute: () => authenticatedRoute,
  path: '/campaigns',
  component: Campaigns,
});

const invitationsRoute = createRoute({
  getParentRoute: () => authenticatedRoute,
  path: '/invitations',
  component: Invitations,
});

const rewardsRoute = createRoute({
  getParentRoute: () => authenticatedRoute,
  path: '/rewards',
  component: Rewards,
});

const partnersRoute = createRoute({
  getParentRoute: () => authenticatedRoute,
  path: '/partners',
  component: Partners,
});

// Partner routes
const availableInvitationsRoute = createRoute({
  getParentRoute: () => authenticatedRoute,
  path: '/available-invitations',
  component: AvailableInvitations,
});

const myClaimedInvitationsRoute = createRoute({
  getParentRoute: () => authenticatedRoute,
  path: '/my-invitations',
  component: MyClaimedInvitations,
});

const routeTree = rootRoute.addChildren([
  loginRoute,
  authenticatedRoute.addChildren([
    indexRoute,
    campaignsRoute,
    invitationsRoute,
    rewardsRoute,
    partnersRoute,
    availableInvitationsRoute,
    myClaimedInvitationsRoute,
  ]),
]);

export const router = createRouter({ routeTree });

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/agent-portal/src/router.tsx
git commit -m "feat(router): add partner and partners management routes"
```

---

## Chunk 5: Agent Pages

### Task 10: Create Partners management page

**Files:**
- Create: `apps/agent-portal/src/pages/Partners.tsx`

- [ ] **Step 1: Create the Partners page**

```typescript
// apps/agent-portal/src/pages/Partners.tsx
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
import { Users, UserCheck, UserPlus, ShieldOff } from 'lucide-react';
import { useAuth } from '../hooks/useAuth';
import {
  useMyPartners,
  usePartnerClaimCounts,
  useCreatePartner,
  useDeactivatePartner,
} from '../hooks/usePartners';

export function Partners() {
  const { agent, role } = useAuth();

  // Role guard: only agents can access this page
  if (role && role !== 'agent') {
    return (
      <div className="p-6 text-center text-slate-500">
        <p>This page is only available to agents.</p>
      </div>
    );
  }
  const { data: partners, isLoading } = useMyPartners(agent?.id);
  const { data: claimCounts } = usePartnerClaimCounts(agent?.id);
  const createPartner = useCreatePartner();
  const deactivatePartner = useDeactivatePartner();
  const { toast } = useToast();

  const [isAddOpen, setIsAddOpen] = useState(false);
  const [deactivateId, setDeactivateId] = useState<string | null>(null);
  const [form, setForm] = useState({ name: '', email: '', phone: '', nric: '', password: '' });

  const activeCount = partners?.filter(p => p.status === 'active').length ?? 0;
  const totalCount = partners?.length ?? 0;

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
      toast({ title: 'Failed to create partner', description: err.message, variant: 'destructive' });
    }
  };

  const handleDeactivate = async () => {
    if (!deactivateId) return;
    try {
      const result = await deactivatePartner.mutateAsync(deactivateId);
      toast({
        title: 'Partner deactivated',
        description: `${result.released_invitations} pending invitation(s) released back to pool.`,
      });
      setDeactivateId(null);
    } catch (err: any) {
      toast({ title: 'Failed to deactivate', description: err.message, variant: 'destructive' });
    }
  };

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-slate-900">Partners</h1>
          <p className="text-slate-500 mt-1">Manage your recruitment partners</p>
        </div>
        <Button onClick={() => setIsAddOpen(true)} className="bg-slate-900 hover:bg-slate-800">
          <UserPlus className="h-4 w-4 mr-2" />
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

      <Card className="glass-card">
        <CardHeader>
          <CardTitle className="text-lg">All Partners</CardTitle>
          <CardDescription>{totalCount} partners total</CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <TableSkeleton rows={5} columns={6} />
          ) : partners?.length === 0 ? (
            <p className="text-slate-500">No partners yet. Click "Add Partner" to get started.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead>Name</TableHead>
                  <TableHead>Email</TableHead>
                  <TableHead>Phone</TableHead>
                  <TableHead>Claimed</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {partners?.map((p) => (
                  <TableRow key={p.id} className="hover:bg-slate-50/50 transition-colors">
                    <TableCell className="font-medium">{p.name}</TableCell>
                    <TableCell className="text-slate-600">{p.email}</TableCell>
                    <TableCell className="text-slate-600">{p.phone}</TableCell>
                    <TableCell className="text-slate-600">{claimCounts?.[p.id] ?? 0}</TableCell>
                    <TableCell>
                      <Badge variant={p.status === 'active' ? 'success' : 'secondary'}>
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
                          <ShieldOff className="h-4 w-4 mr-1" />
                          Deactivate
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
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
              <Button type="submit" disabled={createPartner.isPending} className="bg-slate-900 hover:bg-slate-800">
                {createPartner.isPending ? 'Creating...' : 'Create Partner'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Deactivate Confirmation */}
      <AlertDialog open={!!deactivateId} onOpenChange={(open) => !open && setDeactivateId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Deactivate Partner?</AlertDialogTitle>
            <AlertDialogDescription>
              This will prevent the partner from logging in. Any unclaimed pending invitations will be released back to your pool. Registered invitations will remain attributed.
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
git commit -m "feat(pages): add Partners management page for agents"
```

---

## Chunk 6: Partner Pages & Dashboard

### Task 11: Create Available Invitations page

**Files:**
- Create: `apps/agent-portal/src/pages/AvailableInvitations.tsx`

- [ ] **Step 1: Create the page**

```typescript
// apps/agent-portal/src/pages/AvailableInvitations.tsx
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
  StatCard,
  StatCardGrid,
  TableSkeleton,
  useToast,
} from '@agent-system/shared-ui';
import { Send, CheckSquare, Copy, Check } from 'lucide-react';
import { useState } from 'react';
import { useAuth } from '../hooks/useAuth';
import { useAvailableInvitations, useMyClaimedInvitations, useClaimInvitation } from '../hooks/usePartnerInvitations';

const DAYS_OF_WEEK = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export function AvailableInvitations() {
  const { partner, role } = useAuth();

  // Role guard: only partners can access this page
  if (role && role !== 'partner') {
    return (
      <div className="p-6 text-center text-slate-500">
        <p>This page is only available to partners.</p>
      </div>
    );
  }
  const { data: available, isLoading } = useAvailableInvitations(partner?.agent_id);
  const { data: claimed } = useMyClaimedInvitations(partner?.id);
  const claimMutation = useClaimInvitation();
  const { toast } = useToast();
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [claimingId, setClaimingId] = useState<string | null>(null);

  // Track just-claimed invitations so we can show the copy button before query refetch
  const [justClaimed, setJustClaimed] = useState<Record<string, string>>({}); // id -> token

  const handleClaim = async (invitationId: string, token: string) => {
    if (!partner?.id) return;
    setClaimingId(invitationId);
    try {
      await claimMutation.mutateAsync({ invitationId, partnerId: partner.id });
      setJustClaimed(prev => ({ ...prev, [invitationId]: token }));
      toast({ title: 'Invitation claimed', description: 'Copy the link below to share it.' });
    } catch (err: any) {
      if (err.message === 'ALREADY_CLAIMED') {
        toast({ title: 'Already claimed', description: 'This invitation was just claimed by someone else — please select another.', variant: 'destructive' });
      } else {
        toast({ title: 'Failed to claim', description: err.message, variant: 'destructive' });
      }
    } finally {
      setClaimingId(null);
    }
  };

  const handleCopy = async (token: string, id: string) => {
    const publicPagesUrl = import.meta.env.VITE_PUBLIC_PAGES_URL || window.location.origin;
    const link = `${publicPagesUrl}/public/register/${token}`;
    await navigator.clipboard.writeText(link);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  return (
    <div className="space-y-6 animate-fade-in">
      <div>
        <h1 className="text-3xl font-bold text-slate-900">Available Invitations</h1>
        <p className="text-slate-500 mt-1">Claim invitations to share with your invitees</p>
      </div>

      <StatCardGrid columns={2}>
        <StatCard
          title="Available"
          value={available?.length ?? 0}
          icon={Send}
          iconColor="amber"
          description="Unclaimed invitations"
          loading={isLoading}
        />
        <StatCard
          title="Claimed by Me"
          value={claimed?.length ?? 0}
          icon={CheckSquare}
          iconColor="emerald"
          description="My claimed invitations"
          loading={isLoading}
        />
      </StatCardGrid>

      <Card className="glass-card">
        <CardHeader>
          <CardTitle className="text-lg">Unclaimed Invitations</CardTitle>
          <CardDescription>
            {available?.length ?? 0} invitations available to claim
          </CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <TableSkeleton rows={5} columns={5} />
          ) : available?.length === 0 ? (
            <p className="text-slate-500">No unclaimed invitations available right now.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead>Event</TableHead>
                  <TableHead>Slot</TableHead>
                  <TableHead>Capacity</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {available?.map((inv) => (
                  <TableRow key={inv.id} className="hover:bg-slate-50/50 transition-colors">
                    <TableCell className="font-medium">
                      {inv.slot?.campaign?.name ?? '-'}
                    </TableCell>
                    <TableCell className="text-slate-600">
                      {inv.slot
                        ? `${DAYS_OF_WEEK[inv.slot.day_of_week]} ${inv.slot.start_time.slice(0, 5)}`
                        : '-'}
                    </TableCell>
                    <TableCell className="capitalize text-slate-600">
                      {inv.capacity_type.replace('_', ' ')}
                    </TableCell>
                    <TableCell className="text-right">
                      {justClaimed[inv.id] ? (
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
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/agent-portal/src/pages/AvailableInvitations.tsx
git commit -m "feat(pages): add Available Invitations page for partners"
```

### Task 12: Create My Claimed Invitations page

**Files:**
- Create: `apps/agent-portal/src/pages/MyClaimedInvitations.tsx`

- [ ] **Step 1: Create the page**

```typescript
// apps/agent-portal/src/pages/MyClaimedInvitations.tsx
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
  getStatusVariant,
  StatCard,
  StatCardGrid,
  TableSkeleton,
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@agent-system/shared-ui';
import { Copy, Check, Send, UserCheck, CheckCircle } from 'lucide-react';
import { useState } from 'react';
import { useAuth } from '../hooks/useAuth';
import { useMyClaimedInvitations } from '../hooks/usePartnerInvitations';
import { InvitationStatus } from '@agent-system/shared-types';

const DAYS_OF_WEEK = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export function MyClaimedInvitations() {
  const { partner, role } = useAuth();

  // Role guard: only partners can access this page
  if (role && role !== 'partner') {
    return (
      <div className="p-6 text-center text-slate-500">
        <p>This page is only available to partners.</p>
      </div>
    );
  }
  const { data: invitations, isLoading } = useMyClaimedInvitations(partner?.id);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const handleCopy = async (token: string, id: string) => {
    const publicPagesUrl = import.meta.env.VITE_PUBLIC_PAGES_URL || window.location.origin;
    const link = `${publicPagesUrl}/public/register/${token}`;
    await navigator.clipboard.writeText(link);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  const pendingCount = invitations?.filter(i => i.status === InvitationStatus.PENDING).length ?? 0;
  const registeredCount = invitations?.filter(i => i.status === InvitationStatus.REGISTERED).length ?? 0;
  const completedCount = invitations?.filter(i => i.status === InvitationStatus.COMPLETED).length ?? 0;

  return (
    <div className="space-y-6 animate-fade-in">
      <div>
        <h1 className="text-3xl font-bold text-slate-900">My Claimed Invitations</h1>
        <p className="text-slate-500 mt-1">Track invitations you've claimed and shared</p>
      </div>

      <StatCardGrid columns={3}>
        <StatCard
          title="Pending"
          value={pendingCount}
          icon={Send}
          iconColor="amber"
          description="Awaiting registration"
          loading={isLoading}
        />
        <StatCard
          title="Registered"
          value={registeredCount}
          icon={UserCheck}
          iconColor="sky"
          description="Ready for event"
          loading={isLoading}
        />
        <StatCard
          title="Completed"
          value={completedCount}
          icon={CheckCircle}
          iconColor="emerald"
          description="Full attendance"
          loading={isLoading}
        />
      </StatCardGrid>

      <Card className="glass-card">
        <CardHeader>
          <CardTitle className="text-lg">All Claimed Invitations</CardTitle>
          <CardDescription>
            {invitations?.length ?? 0} total claimed invitations
          </CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <TableSkeleton rows={5} columns={6} />
          ) : invitations?.length === 0 ? (
            <p className="text-slate-500">No claimed invitations yet. Browse available invitations to claim some.</p>
          ) : (
            <TooltipProvider>
              <Table>
                <TableHeader>
                  <TableRow className="hover:bg-transparent">
                    <TableHead>Event</TableHead>
                    <TableHead>Slot</TableHead>
                    <TableHead>Capacity</TableHead>
                    <TableHead>Invitee</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {invitations?.map((inv) => (
                    <TableRow key={inv.id} className="hover:bg-slate-50/50 transition-colors">
                      <TableCell className="font-medium">
                        {inv.slot?.campaign?.name ?? '-'}
                      </TableCell>
                      <TableCell className="text-slate-600">
                        {inv.slot
                          ? `${DAYS_OF_WEEK[inv.slot.day_of_week]} ${inv.slot.start_time.slice(0, 5)}`
                          : '-'}
                      </TableCell>
                      <TableCell className="capitalize text-slate-600">
                        {inv.capacity_type.replace('_', ' ')}
                      </TableCell>
                      <TableCell>
                        {inv.invitee_name || (
                          <span className="text-slate-400">Not registered</span>
                        )}
                      </TableCell>
                      <TableCell>
                        <Badge variant={getStatusVariant(inv.status)}>
                          {inv.status}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right">
                        {inv.status === InvitationStatus.PENDING && (
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <Button
                                variant="ghost"
                                size="sm"
                                className="h-8 w-8 p-0"
                                onClick={() => handleCopy(inv.unique_token, inv.id)}
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
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TooltipProvider>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/agent-portal/src/pages/MyClaimedInvitations.tsx
git commit -m "feat(pages): add My Claimed Invitations page for partners"
```

### Task 13: Update Dashboard for role-based content

**Files:**
- Modify: `apps/agent-portal/src/pages/Dashboard.tsx`

The Dashboard must show different content depending on whether the user is an agent or a partner.

- [ ] **Step 1: Replace Dashboard.tsx with role-aware version**

Replace the entire contents of `apps/agent-portal/src/pages/Dashboard.tsx`:

```typescript
import { Link } from '@tanstack/react-router';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  StatCard,
  StatCardGrid,
  Skeleton,
} from '@agent-system/shared-ui';
import { Calendar, Send, TrendingUp, Award, ArrowRight, Users, CheckSquare, UserCheck } from 'lucide-react';
import { useAuth } from '../hooks/useAuth';
import { useMyInvitations } from '../hooks/useInvitations';
import { useActiveCampaigns } from '../hooks/useCampaigns';
import { useMyPartners } from '../hooks/usePartners';
import { useAvailableInvitations, useMyClaimedInvitations } from '../hooks/usePartnerInvitations';
import { InvitationStatus } from '@agent-system/shared-types';

function AgentDashboard() {
  const { agent } = useAuth();
  const { data: invitations, isLoading: invitationsLoading } = useMyInvitations(agent?.id);
  const { data: campaigns, isLoading: campaignsLoading } = useActiveCampaigns();
  const { data: partners, isLoading: partnersLoading } = useMyPartners(agent?.id);

  const pendingInvitations = invitations?.filter(i => i.status === InvitationStatus.PENDING).length ?? 0;
  const registeredInvitations = invitations?.filter(i => i.status === InvitationStatus.REGISTERED).length ?? 0;
  const completedInvitations = invitations?.filter(i => i.status === InvitationStatus.COMPLETED).length ?? 0;
  const activeCampaigns = campaigns?.length ?? 0;
  const activePartners = partners?.filter(p => p.status === 'active').length ?? 0;

  const isLoading = invitationsLoading || campaignsLoading || partnersLoading;

  return (
    <div className="space-y-6 animate-fade-in">
      <div>
        <h1 className="text-3xl font-bold text-slate-900">Dashboard</h1>
        <p className="text-slate-500 mt-1">
          Welcome back, {agent?.name}! Here's your overview.
        </p>
      </div>

      <StatCardGrid columns={4}>
        <StatCard
          title="Active Events"
          value={activeCampaigns}
          icon={Calendar}
          iconColor="sky"
          description="Available for invitations"
          loading={isLoading}
        />
        <StatCard
          title="Pending Invitations"
          value={pendingInvitations}
          icon={Send}
          iconColor="amber"
          description="Awaiting registration"
          loading={isLoading}
        />
        <StatCard
          title="Active Partners"
          value={activePartners}
          icon={Users}
          iconColor="violet"
          description="Distributing invitations"
          loading={isLoading}
        />
        <StatCard
          title="Rewards Earned"
          value={completedInvitations}
          icon={Award}
          iconColor="emerald"
          description={`$${(completedInvitations * (agent?.tier?.reward_amount ?? 0)).toFixed(2)}`}
          loading={isLoading}
        />
      </StatCardGrid>

      <div className="grid gap-6 md:grid-cols-2">
        <Card className="glass-card">
          <CardHeader>
            <CardTitle className="text-lg">Your Tier</CardTitle>
            <CardDescription>Current reward structure</CardDescription>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <div className="space-y-3">
                <Skeleton className="h-5 w-full" />
                <Skeleton className="h-5 w-full" />
                <Skeleton className="h-5 w-full" />
              </div>
            ) : agent?.tier ? (
              <div className="space-y-3">
                <div className="flex justify-between items-center py-2 border-b border-slate-100">
                  <span className="text-slate-500">Tier Name</span>
                  <span className="font-semibold text-slate-900">{agent.tier.name}</span>
                </div>
                <div className="flex justify-between items-center py-2 border-b border-slate-100">
                  <span className="text-slate-500">Reward per Attendance</span>
                  <span className="font-semibold text-emerald-600">${agent.tier.reward_amount.toFixed(2)}</span>
                </div>
                <div className="flex justify-between items-center py-2">
                  <span className="text-slate-500">Invitation Limit per Slot</span>
                  <span className="font-semibold text-slate-900">{agent.tier.invitation_limit_per_slot}</span>
                </div>
              </div>
            ) : (
              <p className="text-slate-500">No tier assigned</p>
            )}
          </CardContent>
        </Card>

        <Card className="glass-card">
          <CardHeader>
            <CardTitle className="text-lg">Quick Actions</CardTitle>
            <CardDescription>Common tasks</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            <Link
              to="/campaigns"
              className="flex items-center justify-between p-3 rounded-lg hover:bg-slate-50 transition-colors group"
            >
              <span className="text-sm font-medium text-slate-700">Browse Active Events</span>
              <ArrowRight className="h-4 w-4 text-slate-400 group-hover:text-sky-600 group-hover:translate-x-1 transition-all" />
            </Link>
            <Link
              to="/invitations"
              className="flex items-center justify-between p-3 rounded-lg hover:bg-slate-50 transition-colors group"
            >
              <span className="text-sm font-medium text-slate-700">View My Invitations</span>
              <ArrowRight className="h-4 w-4 text-slate-400 group-hover:text-sky-600 group-hover:translate-x-1 transition-all" />
            </Link>
            <Link
              to="/partners"
              className="flex items-center justify-between p-3 rounded-lg hover:bg-slate-50 transition-colors group"
            >
              <span className="text-sm font-medium text-slate-700">Manage Partners</span>
              <ArrowRight className="h-4 w-4 text-slate-400 group-hover:text-sky-600 group-hover:translate-x-1 transition-all" />
            </Link>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function PartnerDashboard() {
  const { partner } = useAuth();
  const { data: available, isLoading: availableLoading } = useAvailableInvitations(partner?.agent_id);
  const { data: claimed, isLoading: claimedLoading } = useMyClaimedInvitations(partner?.id);

  const pendingClaimed = claimed?.filter(i => i.status === InvitationStatus.PENDING).length ?? 0;
  const registeredClaimed = claimed?.filter(i => i.status === InvitationStatus.REGISTERED).length ?? 0;
  const completedClaimed = claimed?.filter(i => i.status === InvitationStatus.COMPLETED).length ?? 0;

  const isLoading = availableLoading || claimedLoading;

  return (
    <div className="space-y-6 animate-fade-in">
      <div>
        <h1 className="text-3xl font-bold text-slate-900">Dashboard</h1>
        <p className="text-slate-500 mt-1">
          Welcome back, {partner?.name}! You're a partner under {partner?.agent?.name ?? 'your unit'}.
        </p>
      </div>

      <StatCardGrid columns={4}>
        <StatCard
          title="Available"
          value={available?.length ?? 0}
          icon={Send}
          iconColor="amber"
          description="Invitations to claim"
          loading={isLoading}
        />
        <StatCard
          title="Pending"
          value={pendingClaimed}
          icon={CheckSquare}
          iconColor="sky"
          description="Awaiting registration"
          loading={isLoading}
        />
        <StatCard
          title="Registered"
          value={registeredClaimed}
          icon={UserCheck}
          iconColor="violet"
          description="Ready for event"
          loading={isLoading}
        />
        <StatCard
          title="Completed"
          value={completedClaimed}
          icon={Award}
          iconColor="emerald"
          description="Full attendance"
          loading={isLoading}
        />
      </StatCardGrid>

      <Card className="glass-card">
        <CardHeader>
          <CardTitle className="text-lg">Quick Actions</CardTitle>
          <CardDescription>Common tasks</CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          <Link
            to="/available-invitations"
            className="flex items-center justify-between p-3 rounded-lg hover:bg-slate-50 transition-colors group"
          >
            <span className="text-sm font-medium text-slate-700">Browse Available Invitations</span>
            <ArrowRight className="h-4 w-4 text-slate-400 group-hover:text-sky-600 group-hover:translate-x-1 transition-all" />
          </Link>
          <Link
            to="/my-invitations"
            className="flex items-center justify-between p-3 rounded-lg hover:bg-slate-50 transition-colors group"
          >
            <span className="text-sm font-medium text-slate-700">View My Claimed Invitations</span>
            <ArrowRight className="h-4 w-4 text-slate-400 group-hover:text-sky-600 group-hover:translate-x-1 transition-all" />
          </Link>
        </CardContent>
      </Card>
    </div>
  );
}

export function Dashboard() {
  const { role } = useAuth();
  return role === 'partner' ? <PartnerDashboard /> : <AgentDashboard />;
}
```

- [ ] **Step 2: Verify app builds**

Run: `cd /Users/paullee/Documents/project/martin/DATA && pnpm --filter agent-portal build`
Expected: Build succeeds with no errors.

- [ ] **Step 3: Commit**

```bash
git add apps/agent-portal/src/pages/Dashboard.tsx
git commit -m "feat(dashboard): add role-based agent/partner dashboard views"
```

### Task 14: Deploy migration and Edge Functions

- [ ] **Step 1: Push migration to production**

Run: `npx supabase db push`
Expected: Migration `20260311000003_partners` applied successfully.

- [ ] **Step 2: Deploy Edge Functions**

Run:
```bash
npx supabase functions deploy create-partner
npx supabase functions deploy deactivate-partner
```
Expected: Both functions deployed successfully.

- [ ] **Step 3: Commit all remaining changes and push**

```bash
git push origin master
```

---

## Verification Checklist

After all tasks are complete, verify end-to-end:

- [ ] Agent can log in and see Partners nav item
- [ ] Agent can create a partner from the Partners page
- [ ] Partner can log in with temp credentials and see partner dashboard
- [ ] Partner sees Available Invitations page with unclaimed invitations
- [ ] Partner can claim an invitation and copy the link
- [ ] Claimed invitation appears in My Claimed Invitations page
- [ ] Agent can deactivate a partner — partner can no longer log in
- [ ] Deactivated partner's pending invitations return to unclaimed pool
