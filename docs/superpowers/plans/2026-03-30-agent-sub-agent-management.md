# Agent Sub-Agent Management & Tier Approval Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enable Agent Admin accounts to create and manage sub-agents, with a tier approval workflow where admins approve/reject tier requests.

**Architecture:** Extend the `agents` table with `parent_agent_id` for hierarchy. Add `tier_requests` table for the approval workflow. New edge functions handle sub-agent creation, tier requests, and deactivation. Agent portal gets a "My Agents" page; admin portal gets inline tier request management on the Units page.

**Tech Stack:** PostgreSQL (Supabase), Deno edge functions, React 18, TanStack Router/Query, TypeScript, shadcn/ui, zod

---

## File Structure

### New files
- `supabase/migrations/20260330000001_agent_hierarchy.sql` — Schema: parent_agent_id, tier_requests table, RLS
- `supabase/functions/create-sub-agent/index.ts` — Edge function: create auth user + agent record
- `supabase/functions/request-tier/index.ts` — Edge function: create tier request
- `supabase/functions/deactivate-sub-agent/index.ts` — Edge function: deactivate sub-agent
- `packages/shared-types/src/tier-request.ts` — TierRequest types and enum
- `apps/agent-portal/src/hooks/useSubAgents.ts` — Hooks for sub-agent CRUD and tier requests
- `apps/agent-portal/src/pages/MyAgents.tsx` — My Agents page component
- `apps/admin-portal/src/hooks/useTierRequests.ts` — Hooks for admin tier request management

### Modified files
- `packages/shared-types/src/database.ts` — Update Agent interface (parent_agent_id, nullable tier_id)
- `packages/shared-types/src/index.ts` — Export new tier-request module
- `apps/agent-portal/src/hooks/useAuth.ts` — Add `agent_admin` role detection
- `apps/agent-portal/src/components/Layout.tsx` — Add My Agents nav, role-based nav
- `apps/agent-portal/src/router.tsx` — Add /my-agents route
- `apps/agent-portal/src/pages/Partners.tsx` — Update role guard for `agent_admin`
- `apps/admin-portal/src/hooks/useAgents.ts` — Filter to Agent Admins only
- `apps/admin-portal/src/pages/agents/AgentList.tsx` — Add tier requests section

---

### Task 1: Database Migration — Agent Hierarchy & Tier Requests

**Files:**
- Create: `supabase/migrations/20260330000001_agent_hierarchy.sql`

- [ ] **Step 1: Create the migration file**

```sql
-- Add parent_agent_id to agents table for hierarchy
ALTER TABLE agents
  ADD COLUMN parent_agent_id UUID REFERENCES agents(id) ON DELETE CASCADE;

-- Make tier_id nullable (sub-agents start without a tier)
ALTER TABLE agents
  ALTER COLUMN tier_id DROP NOT NULL;

CREATE INDEX idx_agents_parent ON agents(parent_agent_id);

-- Helper function: get parent_agent_id for current user's agent record
CREATE OR REPLACE FUNCTION get_agent_parent_id()
RETURNS UUID AS $$
BEGIN
  RETURN (SELECT parent_agent_id FROM agents WHERE user_id = auth.uid());
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- RLS: Agent Admins can read their sub-agents
CREATE POLICY "Agent admins read sub-agents"
  ON agents FOR SELECT TO authenticated
  USING (parent_agent_id = get_agent_id());

-- RLS: Sub-agents can read their parent agent (for useAuth join)
CREATE POLICY "Sub-agents read parent agent"
  ON agents FOR SELECT TO authenticated
  USING (id = get_agent_parent_id());

-- Tier request status enum
CREATE TYPE tier_request_status AS ENUM ('pending', 'approved', 'rejected');

-- Tier requests table
CREATE TABLE tier_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  requested_tier_id UUID NOT NULL REFERENCES tiers(id),
  requested_by UUID NOT NULL REFERENCES agents(id),
  status tier_request_status NOT NULL DEFAULT 'pending',
  admin_notes TEXT,
  reviewed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_tier_requests_agent ON tier_requests(agent_id);
CREATE INDEX idx_tier_requests_status ON tier_requests(status);

-- Enable RLS on tier_requests
ALTER TABLE tier_requests ENABLE ROW LEVEL SECURITY;

-- Admin full access to tier_requests
CREATE POLICY "Admin full access to tier_requests"
  ON tier_requests FOR ALL TO authenticated
  USING (is_admin());

-- Agent Admins can read their own tier requests
CREATE POLICY "Agent admins read own tier requests"
  ON tier_requests FOR SELECT TO authenticated
  USING (requested_by = get_agent_id());

-- Agent Admins can insert tier requests
CREATE POLICY "Agent admins insert tier requests"
  ON tier_requests FOR INSERT TO authenticated
  WITH CHECK (requested_by = get_agent_id());
```

- [ ] **Step 2: Apply the migration locally**

Run: `npx supabase db reset`
Expected: Database resets and all migrations apply successfully including the new one.

- [ ] **Step 3: Verify the migration**

Run: `npx supabase db reset 2>&1 | tail -5`
Expected: No errors. The `agents` table now has `parent_agent_id` column, `tier_id` is nullable, and `tier_requests` table exists.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260330000001_agent_hierarchy.sql
git commit -m "feat(db): add agent hierarchy and tier requests schema"
```

---

### Task 2: Shared Types — Update Agent & Add TierRequest

**Files:**
- Modify: `packages/shared-types/src/database.ts:116-129`
- Modify: `packages/shared-types/src/database.ts:233-235`
- Create: `packages/shared-types/src/tier-request.ts`
- Modify: `packages/shared-types/src/enums.ts`
- Modify: `packages/shared-types/src/index.ts`

- [ ] **Step 1: Add TierRequestStatus enum**

In `packages/shared-types/src/enums.ts`, add after the `RewardStatus` enum:

```typescript
export enum TierRequestStatus {
  PENDING = 'pending',
  APPROVED = 'approved',
  REJECTED = 'rejected',
}
```

- [ ] **Step 2: Update Agent interface**

In `packages/shared-types/src/database.ts`, update the `Agent` interface to add `parent_agent_id` and make `tier_id` nullable:

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
  status: AgentStatus;
  created_at: string;
  updated_at: string;
}
```

- [ ] **Step 3: Update AgentWithTier to handle nullable tier**

In `packages/shared-types/src/database.ts`, update:

```typescript
export interface AgentWithTier extends Agent {
  tier: Tier | null;
}
```

- [ ] **Step 4: Create tier-request.ts**

Create `packages/shared-types/src/tier-request.ts`:

```typescript
import { TierRequestStatus } from './enums';
import type { Agent, Tier } from './database';

export interface TierRequest {
  id: string;
  agent_id: string;
  requested_tier_id: string;
  requested_by: string;
  status: TierRequestStatus;
  admin_notes: string | null;
  reviewed_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface TierRequestWithDetails extends TierRequest {
  agent: Agent;
  requested_tier: Tier;
  requester: Agent;
}
```

- [ ] **Step 5: Export from index.ts**

In `packages/shared-types/src/index.ts`, add the export:

```typescript
export * from './enums';
export * from './database';
export * from './partner';
export * from './tier-request';
```

- [ ] **Step 6: Verify types compile**

Run: `pnpm -r typecheck 2>&1 | head -30`
Expected: Type errors in files that use `AgentWithTier` where `tier` is now nullable. Note them — they'll be fixed in subsequent tasks. The shared-types package itself should compile.

- [ ] **Step 7: Commit**

```bash
git add packages/shared-types/src/
git commit -m "feat(types): add agent hierarchy fields and TierRequest types"
```

---

### Task 3: Edge Function — create-sub-agent

**Files:**
- Create: `supabase/functions/create-sub-agent/index.ts`

- [ ] **Step 1: Create the edge function**

Create `supabase/functions/create-sub-agent/index.ts`:

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
    const { name, email, phone, nric, agent_code, password } = await req.json();

    if (!name || !email || !phone || !agent_code || !password) {
      return new Response(
        JSON.stringify({ error: "name, email, phone, agent_code, and password are required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (password.length < 6) {
      return new Response(
        JSON.stringify({ error: "Password must be at least 6 characters" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Verify caller identity
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

    // Verify caller is an Agent Admin (parent_agent_id IS NULL)
    const { data: agent, error: agentError } = await supabase
      .from("agents")
      .select("id, unit_name, parent_agent_id")
      .eq("user_id", caller.id)
      .single();

    if (agentError || !agent) {
      return new Response(
        JSON.stringify({ error: "Only agents can create sub-agents" }),
        { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (agent.parent_agent_id !== null) {
      return new Response(
        JSON.stringify({ error: "Only Agent Admins can create sub-agents" }),
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

    // Insert sub-agent record (tier_id = NULL, unit_name inherited from parent)
    const { data: subAgent, error: insertError } = await supabase
      .from("agents")
      .insert({
        user_id: newUser.user.id,
        name,
        email,
        phone,
        nric: nric || "",
        agent_code,
        unit_name: agent.unit_name,
        parent_agent_id: agent.id,
        // tier_id intentionally omitted — defaults to NULL
      })
      .select()
      .single();

    if (insertError) {
      // Cleanup orphaned auth user
      await supabase.auth.admin.deleteUser(newUser.user.id);
      return new Response(
        JSON.stringify({ error: insertError.message || "Failed to create sub-agent record" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    return new Response(
      JSON.stringify({ success: true, agent: subAgent }),
      { status: 201, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("create-sub-agent error:", error);
    return new Response(
      JSON.stringify({ error: "Internal server error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
```

- [ ] **Step 2: Commit**

```bash
git add supabase/functions/create-sub-agent/
git commit -m "feat(edge): add create-sub-agent edge function"
```

---

### Task 4: Edge Function — request-tier

**Files:**
- Create: `supabase/functions/request-tier/index.ts`

- [ ] **Step 1: Create the edge function**

Create `supabase/functions/request-tier/index.ts`:

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
    const { agent_id, tier_id } = await req.json();

    if (!agent_id || !tier_id) {
      return new Response(
        JSON.stringify({ error: "agent_id and tier_id are required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Verify caller identity
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

    // Verify target agent is caller's sub-agent OR caller themselves
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

    // Check no pending request already exists for this agent
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

    // Verify the tier exists
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
        agent_id,
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
git add supabase/functions/request-tier/
git commit -m "feat(edge): add request-tier edge function"
```

---

### Task 5: Edge Function — deactivate-sub-agent

**Files:**
- Create: `supabase/functions/deactivate-sub-agent/index.ts`

- [ ] **Step 1: Create the edge function**

Create `supabase/functions/deactivate-sub-agent/index.ts`:

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
    const { agent_id } = await req.json();

    if (!agent_id) {
      return new Response(
        JSON.stringify({ error: "agent_id is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Verify caller identity
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

    if (agentError || !callerAgent || callerAgent.parent_agent_id !== null) {
      return new Response(
        JSON.stringify({ error: "Only Agent Admins can deactivate sub-agents" }),
        { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Verify target agent is a sub-agent of the caller
    const { data: targetAgent, error: targetError } = await supabase
      .from("agents")
      .select("id, user_id, parent_agent_id")
      .eq("id", agent_id)
      .single();

    if (targetError || !targetAgent) {
      return new Response(
        JSON.stringify({ error: "Agent not found" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (targetAgent.parent_agent_id !== callerAgent.id) {
      return new Response(
        JSON.stringify({ error: "You can only deactivate your own sub-agents" }),
        { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Ban the auth user
    await supabase.auth.admin.updateUserById(targetAgent.user_id, {
      ban_duration: "876000h",
    });

    // Set agent status to inactive
    const { error: updateError } = await supabase
      .from("agents")
      .update({ status: "inactive" })
      .eq("id", agent_id);

    if (updateError) {
      return new Response(
        JSON.stringify({ error: "Failed to deactivate sub-agent" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Deactivate their active links
    await supabase
      .from("agent_links")
      .update({ is_active: false })
      .eq("agent_id", agent_id)
      .eq("is_active", true);

    return new Response(
      JSON.stringify({ success: true }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("deactivate-sub-agent error:", error);
    return new Response(
      JSON.stringify({ error: "Internal server error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
```

- [ ] **Step 2: Commit**

```bash
git add supabase/functions/deactivate-sub-agent/
git commit -m "feat(edge): add deactivate-sub-agent edge function"
```

---

### Task 6: Agent Portal — Update useAuth for Role Hierarchy

**Files:**
- Modify: `apps/agent-portal/src/hooks/useAuth.ts`

- [ ] **Step 1: Update AuthState and role detection**

Replace the entire content of `apps/agent-portal/src/hooks/useAuth.ts`:

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
  role: 'agent_admin' | 'agent' | 'partner' | null;
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
      const agentRole = agentData.parent_agent_id === null ? 'agent_admin' : 'agent';
      setState(prev => ({
        ...prev,
        agent: agentData as AgentWithTier,
        partner: null,
        role: agentRole,
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
    window.location.href = '/login';
  };

  return {
    ...state,
    signIn,
    signOut,
  };
}
```

- [ ] **Step 2: Update Partners.tsx role guard**

In `apps/agent-portal/src/pages/Partners.tsx`, change the role guard from `role !== 'agent'` to `role !== 'agent_admin'`:

Find:
```typescript
  if (role && role !== 'agent') {
```
Replace with:
```typescript
  if (role && role !== 'agent_admin') {
```

- [ ] **Step 3: Commit**

```bash
git add apps/agent-portal/src/hooks/useAuth.ts apps/agent-portal/src/pages/Partners.tsx
git commit -m "feat(auth): add agent_admin role detection to useAuth"
```

---

### Task 7: Agent Portal — Layout Navigation Update

**Files:**
- Modify: `apps/agent-portal/src/components/Layout.tsx`

- [ ] **Step 1: Add role-based navigation with My Agents**

Replace the entire content of `apps/agent-portal/src/components/Layout.tsx`:

```typescript
import { useState } from 'react';
import { Link, useLocation } from '@tanstack/react-router';
import { cn, Button, Sheet, SheetContent, SheetTrigger, Logo } from '@agent-system/shared-ui';
import { LayoutDashboard, CalendarDays, Link2, Award, LogOut, Menu, Users, UserCog } from 'lucide-react';
import { useAuth } from '../hooks/useAuth';

const agentAdminNavigation = [
  { name: 'Dashboard', href: '/', icon: LayoutDashboard },
  { name: 'Events', href: '/campaigns', icon: CalendarDays },
  { name: 'My Links', href: '/my-links', icon: Link2 },
  { name: 'Rewards', href: '/rewards', icon: Award },
  { name: 'My Agents', href: '/my-agents', icon: UserCog },
  { name: 'Partners', href: '/partners', icon: Users },
];

const agentNavigation = [
  { name: 'Dashboard', href: '/', icon: LayoutDashboard },
  { name: 'Events', href: '/campaigns', icon: CalendarDays },
  { name: 'My Links', href: '/my-links', icon: Link2 },
  { name: 'Rewards', href: '/rewards', icon: Award },
];

const partnerNavigation = [
  { name: 'Dashboard', href: '/', icon: LayoutDashboard },
  { name: 'My Links', href: '/partner-links', icon: Link2 },
];

export function Layout({ children }: { children: React.ReactNode }) {
  const location = useLocation();
  const { agent, partner, role, signOut } = useAuth();
  const [mobileOpen, setMobileOpen] = useState(false);

  const navigation = role === 'partner'
    ? partnerNavigation
    : role === 'agent_admin'
      ? agentAdminNavigation
      : agentNavigation;

  const displayName = role === 'partner' ? partner?.name : agent?.name;
  const subtitle = role === 'partner'
    ? `Partner · ${partner?.agent?.name ?? 'Unknown Unit'}`
    : agent?.tier?.name ?? 'No Tier';

  const SidebarContent = () => (
    <>
      <div className="flex h-16 items-center gap-3 px-6 border-b border-white/10">
        <Logo size="md" showText={false} />
        <span className="font-semibold text-lg text-white tracking-tight">
          {role === 'partner' ? 'RACC Partner' : 'RACC Unit'}
        </span>
      </div>
      <nav className="px-3 py-4 space-y-0.5">
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
                  ? 'bg-white/12 text-white shadow-sm border-l-2 border-indigo-400 pl-[10px]'
                  : 'text-slate-300 hover:bg-white/8 hover:text-white'
              )}
            >
              <item.icon className={cn("size-5", isActive && "text-indigo-300")} />
              {item.name}
            </Link>
          );
        })}
      </nav>
    </>
  );

  return (
    <div className="min-h-screen bg-background">
      <div className="hidden lg:fixed lg:inset-y-0 lg:left-0 lg:z-50 lg:w-64 lg:flex lg:flex-col bg-gradient-to-b from-indigo-950 via-[#1a1942] to-slate-900">
        <SidebarContent />
      </div>

      <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
        <SheetContent side="left" className="w-64 p-0 bg-gradient-to-b from-indigo-950 via-[#1a1942] to-slate-900 border-r-0">
          <SidebarContent />
        </SheetContent>
      </Sheet>

      <div className="lg:pl-64">
        <header className="sticky top-0 z-40 h-16 bg-background/80 backdrop-blur-md border-b border-border shadow-sm">
          <div className="flex h-16 items-center justify-between px-4 lg:px-6">
            <div className="flex items-center gap-4">
              <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
                <SheetTrigger asChild>
                  <Button variant="ghost" size="sm" className="lg:hidden size-9 p-0">
                    <Menu className="size-5" />
                  </Button>
                </SheetTrigger>
              </Sheet>
              {displayName && (
                <p className="text-sm text-muted-foreground">
                  Welcome, <span className="font-medium text-foreground">{displayName}</span>
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
              className="text-muted-foreground hover:text-foreground hover:bg-muted"
            >
              <LogOut className="size-4 mr-2" />
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
git commit -m "feat(nav): add agent_admin navigation with My Agents menu"
```

---

### Task 8: Agent Portal — useSubAgents Hook

**Files:**
- Create: `apps/agent-portal/src/hooks/useSubAgents.ts`

- [ ] **Step 1: Create the hooks file**

Create `apps/agent-portal/src/hooks/useSubAgents.ts`:

```typescript
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import type { Agent, AgentWithTier, TierRequest } from '@agent-system/shared-types';

export function useMySubAgents(agentId: string | undefined) {
  return useQuery({
    queryKey: ['my-sub-agents', agentId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('agents')
        .select('*, tier:tiers(*)')
        .eq('parent_agent_id', agentId!)
        .order('created_at', { ascending: false });

      if (error) throw error;
      return data as AgentWithTier[];
    },
    enabled: !!agentId,
  });
}

export function useMyTierRequests(agentId: string | undefined) {
  return useQuery({
    queryKey: ['my-tier-requests', agentId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('tier_requests')
        .select('*')
        .eq('requested_by', agentId!)
        .order('created_at', { ascending: false });

      if (error) throw error;
      return data as TierRequest[];
    },
    enabled: !!agentId,
  });
}

export function useCreateSubAgent() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: {
      name: string;
      email: string;
      phone: string;
      nric?: string;
      agent_code: string;
      password: string;
    }) => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error('Not authenticated');

      const response = await supabase.functions.invoke('create-sub-agent', {
        body: input,
      });

      if (response.error) throw new Error(response.error.message || 'Failed to create sub-agent');
      if (response.data?.error) throw new Error(response.data.error);
      return response.data.agent as Agent;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['my-sub-agents'] });
    },
  });
}

export function useRequestTier() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: { agent_id: string; tier_id: string }) => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error('Not authenticated');

      const response = await supabase.functions.invoke('request-tier', {
        body: input,
      });

      if (response.error) throw new Error(response.error.message || 'Failed to request tier');
      if (response.data?.error) throw new Error(response.data.error);
      return response.data.request as TierRequest;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['my-tier-requests'] });
      queryClient.invalidateQueries({ queryKey: ['my-sub-agents'] });
    },
  });
}

export function useDeactivateSubAgent() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (agentId: string) => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error('Not authenticated');

      const response = await supabase.functions.invoke('deactivate-sub-agent', {
        body: { agent_id: agentId },
      });

      if (response.error) throw new Error(response.error.message || 'Failed to deactivate sub-agent');
      if (response.data?.error) throw new Error(response.data.error);
      return response.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['my-sub-agents'] });
    },
  });
}

export function useAvailableTiers() {
  return useQuery({
    queryKey: ['available-tiers'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('tiers')
        .select('*')
        .order('name', { ascending: true });

      if (error) throw error;
      return data;
    },
  });
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/agent-portal/src/hooks/useSubAgents.ts
git commit -m "feat(hooks): add useSubAgents hooks for sub-agent management"
```

---

### Task 9: Agent Portal — My Agents Page

**Files:**
- Create: `apps/agent-portal/src/pages/MyAgents.tsx`
- Modify: `apps/agent-portal/src/router.tsx`

- [ ] **Step 1: Create the MyAgents page**

Create `apps/agent-portal/src/pages/MyAgents.tsx`:

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
import { Users, UserCheck, Clock, UserPlus, ShieldOff, Tag } from 'lucide-react';
import { useAuth } from '../hooks/useAuth';
import {
  useMySubAgents,
  useMyTierRequests,
  useCreateSubAgent,
  useRequestTier,
  useDeactivateSubAgent,
  useAvailableTiers,
} from '../hooks/useSubAgents';
import { TierRequestStatus } from '@agent-system/shared-types';

export function MyAgents() {
  const { agent, role } = useAuth();
  const { toast } = useToast();

  // Role guard: only agent_admin can access
  if (role && role !== 'agent_admin') {
    return (
      <div className="p-6 text-center text-muted-foreground">
        <p>This page is only available to unit administrators.</p>
      </div>
    );
  }

  const { data: subAgents, isLoading } = useMySubAgents(agent?.id);
  const { data: tierRequests } = useMyTierRequests(agent?.id);
  const { data: tiers } = useAvailableTiers();
  const createSubAgent = useCreateSubAgent();
  const requestTier = useRequestTier();
  const deactivateSubAgent = useDeactivateSubAgent();

  const [isAddOpen, setIsAddOpen] = useState(false);
  const [isTierOpen, setIsTierOpen] = useState(false);
  const [tierTargetId, setTierTargetId] = useState<string | null>(null);
  const [selectedTierId, setSelectedTierId] = useState('');
  const [deactivateId, setDeactivateId] = useState<string | null>(null);
  const [form, setForm] = useState({ name: '', email: '', phone: '', nric: '', agent_code: '', password: '' });

  const activeCount = subAgents?.filter(a => a.status === 'active').length ?? 0;
  const totalCount = (subAgents?.length ?? 0) + 1; // +1 for self
  const pendingRequests = tierRequests?.filter(r => r.status === TierRequestStatus.PENDING).length ?? 0;

  // Get the tier request status for a given agent
  const getTierRequestForAgent = (agentId: string) => {
    return tierRequests?.find(r => r.agent_id === agentId && r.status === TierRequestStatus.PENDING);
  };

  const getLastRejectedRequest = (agentId: string) => {
    return tierRequests?.find(r => r.agent_id === agentId && r.status === TierRequestStatus.REJECTED);
  };

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await createSubAgent.mutateAsync({
        name: form.name,
        email: form.email,
        phone: form.phone,
        nric: form.nric || undefined,
        agent_code: form.agent_code,
        password: form.password,
      });
      toast({ title: 'Agent created', description: `${form.name} can now log in with their email and password.` });
      setIsAddOpen(false);
      setForm({ name: '', email: '', phone: '', nric: '', agent_code: '', password: '' });
    } catch (err: any) {
      toast({ title: 'Failed to create agent', description: err.message, variant: 'error' });
    }
  };

  const handleRequestTier = async () => {
    if (!tierTargetId || !selectedTierId) return;
    try {
      await requestTier.mutateAsync({ agent_id: tierTargetId, tier_id: selectedTierId });
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
      await deactivateSubAgent.mutateAsync(deactivateId);
      toast({ title: 'Agent deactivated', description: 'The agent has been deactivated.' });
      setDeactivateId(null);
    } catch (err: any) {
      toast({ title: 'Failed to deactivate', description: err.message, variant: 'error' });
    }
  };

  const openTierDialog = (agentId: string) => {
    setTierTargetId(agentId);
    setSelectedTierId('');
    setIsTierOpen(true);
  };

  const renderTierStatus = (agentRow: { id: string; tier: any | null }) => {
    if (agentRow.tier) {
      return <span className="text-sm">{agentRow.tier.name}</span>;
    }

    const pendingReq = getTierRequestForAgent(agentRow.id);
    if (pendingReq) {
      return <Badge variant="warning">Pending Approval</Badge>;
    }

    const rejectedReq = getLastRejectedRequest(agentRow.id);
    if (rejectedReq) {
      return (
        <div className="flex items-center gap-2">
          <Badge variant="destructive">Rejected</Badge>
          <Button variant="ghost" size="sm" onClick={() => openTierDialog(agentRow.id)}>
            Retry
          </Button>
        </div>
      );
    }

    return (
      <Button variant="outline" size="sm" onClick={() => openTierDialog(agentRow.id)}>
        <Tag className="size-3.5 mr-1" />
        Request Tier
      </Button>
    );
  };

  return (
    <div className="flex flex-col gap-4 animate-fade-in">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">My Agents</h1>
          <p className="text-sm text-muted-foreground">Manage your unit's agents and tier assignments</p>
        </div>
        <Button onClick={() => setIsAddOpen(true)}>
          <UserPlus className="size-4 mr-1.5" />
          Add Agent
        </Button>
      </div>

      <StatCardGrid columns={3}>
        <StatCard
          title="Total Agents"
          value={totalCount}
          icon={Users}
          iconColor="sky"
          description="Including yourself"
          loading={isLoading}
        />
        <StatCard
          title="Active Agents"
          value={activeCount + 1}
          icon={UserCheck}
          iconColor="emerald"
          description="Currently active"
          loading={isLoading}
        />
        <StatCard
          title="Pending Tier Requests"
          value={pendingRequests}
          icon={Clock}
          iconColor="amber"
          description="Awaiting admin approval"
          loading={isLoading}
        />
      </StatCardGrid>

      <Card>
        <CardHeader>
          <CardTitle>All Agents</CardTitle>
          <CardDescription>{totalCount} agents in your unit</CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <TableSkeleton rows={5} columns={8} />
          ) : (
            <div className="overflow-auto rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow className="hover:bg-transparent">
                    <TableHead>Name</TableHead>
                    <TableHead>Agent Code</TableHead>
                    <TableHead>Email</TableHead>
                    <TableHead>Phone</TableHead>
                    <TableHead>Tier</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {/* Agent Admin's own row (first, read-only) */}
                  {agent && (
                    <TableRow className="bg-muted/30">
                      <TableCell className="font-medium">
                        {agent.name}
                        <Badge variant="outline" className="ml-2 text-xs">You</Badge>
                      </TableCell>
                      <TableCell className="text-muted-foreground">{agent.agent_code}</TableCell>
                      <TableCell className="text-muted-foreground">{agent.email}</TableCell>
                      <TableCell className="text-muted-foreground">{agent.phone}</TableCell>
                      <TableCell>{renderTierStatus({ id: agent.id, tier: agent.tier })}</TableCell>
                      <TableCell>
                        <Badge variant="success">{agent.status}</Badge>
                      </TableCell>
                      <TableCell className="text-right text-muted-foreground text-sm">
                        —
                      </TableCell>
                    </TableRow>
                  )}
                  {/* Sub-agent rows */}
                  {subAgents?.map((a) => (
                    <TableRow key={a.id}>
                      <TableCell className="font-medium">{a.name}</TableCell>
                      <TableCell className="text-muted-foreground">{a.agent_code}</TableCell>
                      <TableCell className="text-muted-foreground">{a.email}</TableCell>
                      <TableCell className="text-muted-foreground">{a.phone}</TableCell>
                      <TableCell>{renderTierStatus({ id: a.id, tier: a.tier })}</TableCell>
                      <TableCell>
                        <Badge variant={a.status === 'active' ? 'success' : 'inactive'}>
                          {a.status}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right">
                        {a.status === 'active' && (
                          <Button
                            variant="ghost"
                            size="sm"
                            className="text-red-600 hover:text-red-700 hover:bg-red-50"
                            onClick={() => setDeactivateId(a.id)}
                          >
                            <ShieldOff className="size-4 mr-1" />
                            Deactivate
                          </Button>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                  {subAgents?.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={7} className="text-center text-muted-foreground py-6">
                        No sub-agents yet. Click "Add Agent" to get started.
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Add Agent Dialog */}
      <Dialog open={isAddOpen} onOpenChange={setIsAddOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Add Agent</DialogTitle>
            <DialogDescription>
              Create a new agent account in your unit. They will use these credentials to log in.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleAdd} className="space-y-4">
            <div>
              <Label htmlFor="agent-name">Name</Label>
              <Input
                id="agent-name"
                value={form.name}
                onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                required
                className="mt-1.5"
              />
            </div>
            <div>
              <Label htmlFor="agent-email">Email</Label>
              <Input
                id="agent-email"
                type="email"
                value={form.email}
                onChange={e => setForm(f => ({ ...f, email: e.target.value }))}
                required
                className="mt-1.5"
              />
            </div>
            <div>
              <Label htmlFor="agent-phone">Phone</Label>
              <Input
                id="agent-phone"
                value={form.phone}
                onChange={e => setForm(f => ({ ...f, phone: e.target.value }))}
                required
                className="mt-1.5"
              />
            </div>
            <div>
              <Label htmlFor="agent-nric">NRIC (optional)</Label>
              <Input
                id="agent-nric"
                value={form.nric}
                onChange={e => setForm(f => ({ ...f, nric: e.target.value }))}
                className="mt-1.5"
              />
            </div>
            <div>
              <Label htmlFor="agent-code">Agent Code</Label>
              <Input
                id="agent-code"
                value={form.agent_code}
                onChange={e => setForm(f => ({ ...f, agent_code: e.target.value }))}
                required
                placeholder={agent?.agent_code ? `e.g. ${agent.agent_code}-01` : 'AGT001-01'}
                className="mt-1.5"
              />
            </div>
            <div>
              <Label htmlFor="agent-password">Temporary Password</Label>
              <Input
                id="agent-password"
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
              <Button type="submit" disabled={createSubAgent.isPending}>
                {createSubAgent.isPending ? 'Creating...' : 'Create Agent'}
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
              Select a tier to request. An admin will review and approve or reject.
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
            <AlertDialogTitle>Deactivate Agent?</AlertDialogTitle>
            <AlertDialogDescription>
              This will prevent the agent from logging in and deactivate their active links. Existing registrations will remain attributed.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDeactivate}
              className="bg-red-600 hover:bg-red-700"
            >
              {deactivateSubAgent.isPending ? 'Deactivating...' : 'Deactivate'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
```

- [ ] **Step 2: Add route to router.tsx**

In `apps/agent-portal/src/router.tsx`, add the import and route:

Add import at top:
```typescript
import { MyAgents } from './pages/MyAgents';
```

Add route after `partnersRoute`:
```typescript
const myAgentsRoute = createRoute({
  getParentRoute: () => authenticatedRoute,
  path: '/my-agents',
  component: MyAgents,
});
```

Add `myAgentsRoute` to the route tree children:
```typescript
const routeTree = rootRoute.addChildren([
  loginRoute,
  authenticatedRoute.addChildren([
    indexRoute,
    campaignsRoute,
    myLinksRoute,
    rewardsRoute,
    partnersRoute,
    partnerLinksRoute,
    myAgentsRoute,
  ]),
]);
```

- [ ] **Step 3: Commit**

```bash
git add apps/agent-portal/src/pages/MyAgents.tsx apps/agent-portal/src/router.tsx
git commit -m "feat(agent-portal): add My Agents page with sub-agent management"
```

---

### Task 10: Admin Portal — Tier Request Management

**Files:**
- Create: `apps/admin-portal/src/hooks/useTierRequests.ts`
- Modify: `apps/admin-portal/src/hooks/useAgents.ts`
- Modify: `apps/admin-portal/src/pages/agents/AgentList.tsx`

- [ ] **Step 1: Create useTierRequests hook**

Create `apps/admin-portal/src/hooks/useTierRequests.ts`:

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
      // Get the request details
      const { data: request, error: fetchError } = await supabase
        .from('tier_requests')
        .select('agent_id, requested_tier_id')
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

      // Update the agent's tier_id
      const { error: agentError } = await supabase
        .from('agents')
        .update({ tier_id: request.requested_tier_id })
        .eq('id', request.agent_id);

      if (agentError) throw agentError;
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

- [ ] **Step 2: Update useAgents to filter Agent Admins only**

In `apps/admin-portal/src/hooks/useAgents.ts`, update the `useAgents` query to filter out sub-agents:

Find:
```typescript
      const { data, error } = await supabase
        .from('agents')
        .select(`
          *,
          tier:tiers(*)
        `)
        .order('name', { ascending: true });
```

Replace with:
```typescript
      const { data, error } = await supabase
        .from('agents')
        .select(`
          *,
          tier:tiers(*)
        `)
        .is('parent_agent_id', null)
        .order('name', { ascending: true });
```

- [ ] **Step 3: Update AgentList.tsx with tier requests section**

Replace the entire content of `apps/admin-portal/src/pages/agents/AgentList.tsx`:

```typescript
import { useState } from 'react';
import { Link } from '@tanstack/react-router';
import {
  Button,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Badge,
  getStatusVariant,
  TableSkeleton,
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  Label,
  useToast,
} from '@agent-system/shared-ui';
import { Plus, Pencil, Trash2, MoreHorizontal, Check, X } from 'lucide-react';
import { useAgents, useDeleteAgent } from '../../hooks/useAgents';
import {
  usePendingTierRequests,
  useApproveTierRequest,
  useRejectTierRequest,
} from '../../hooks/useTierRequests';

export function AgentList() {
  const { data: agents, isLoading, error } = useAgents();
  const deleteAgent = useDeleteAgent();
  const { data: pendingRequests, isLoading: isLoadingRequests } = usePendingTierRequests();
  const approveTierRequest = useApproveTierRequest();
  const rejectTierRequest = useRejectTierRequest();
  const { toast } = useToast();

  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [rejectId, setRejectId] = useState<string | null>(null);
  const [rejectNotes, setRejectNotes] = useState('');

  const handleDelete = (id: string) => {
    setDeleteId(id);
  };

  const confirmDelete = () => {
    if (deleteId) {
      deleteAgent.mutate(deleteId);
      setDeleteId(null);
    }
  };

  const handleApprove = async (requestId: string) => {
    try {
      await approveTierRequest.mutateAsync(requestId);
      toast({ title: 'Tier approved', description: 'The tier has been assigned to the agent.' });
    } catch (err: any) {
      toast({ title: 'Failed to approve', description: err.message, variant: 'error' });
    }
  };

  const handleReject = async () => {
    if (!rejectId) return;
    try {
      await rejectTierRequest.mutateAsync({ requestId: rejectId, adminNotes: rejectNotes });
      toast({ title: 'Tier request rejected' });
      setRejectId(null);
      setRejectNotes('');
    } catch (err: any) {
      toast({ title: 'Failed to reject', description: err.message, variant: 'error' });
    }
  };

  if (error) {
    return (
      <Card>
        <CardContent className="py-4">
          <p className="text-red-600">Error loading units: {error.message}</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="flex flex-col gap-4 animate-fade-in">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">Units</h1>
          <p className="text-sm text-muted-foreground">Manage unit accounts and tier assignments</p>
        </div>
        <Link to="/agents/new">
          <Button>
            <Plus className="size-4 mr-1.5" />
            New Unit
          </Button>
        </Link>
      </div>

      {/* Pending Tier Requests Section */}
      {!isLoadingRequests && pendingRequests && pendingRequests.length > 0 && (
        <Card className="border-amber-200 bg-amber-50/50">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              Pending Tier Requests
              <Badge variant="warning">{pendingRequests.length}</Badge>
            </CardTitle>
            <CardDescription>Review and approve or reject tier assignment requests from unit administrators</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="overflow-auto rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow className="hover:bg-transparent">
                    <TableHead>Agent Name</TableHead>
                    <TableHead>Agent Code</TableHead>
                    <TableHead>Requested By</TableHead>
                    <TableHead>Requested Tier</TableHead>
                    <TableHead>Reward</TableHead>
                    <TableHead>Requested</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {pendingRequests.map((req) => (
                    <TableRow key={req.id}>
                      <TableCell className="font-medium">{req.agent?.name ?? '—'}</TableCell>
                      <TableCell className="text-muted-foreground">{req.agent?.agent_code ?? '—'}</TableCell>
                      <TableCell className="text-muted-foreground">{req.requester?.name ?? '—'}</TableCell>
                      <TableCell className="text-muted-foreground">{req.requested_tier?.name ?? '—'}</TableCell>
                      <TableCell className="text-muted-foreground">
                        RM{req.requested_tier?.reward_amount ?? 0}
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {new Date(req.created_at).toLocaleDateString()}
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex items-center justify-end gap-1">
                          <Button
                            variant="ghost"
                            size="sm"
                            className="text-emerald-600 hover:text-emerald-700 hover:bg-emerald-50"
                            onClick={() => handleApprove(req.id)}
                            disabled={approveTierRequest.isPending}
                          >
                            <Check className="size-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="text-red-600 hover:text-red-700 hover:bg-red-50"
                            onClick={() => setRejectId(req.id)}
                            disabled={rejectTierRequest.isPending}
                          >
                            <X className="size-4" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      )}

      {/* All Units Table */}
      <Card>
        <CardHeader>
          <CardTitle>All Units</CardTitle>
          <CardDescription>
            {agents?.length ?? 0} registered units
          </CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <TableSkeleton rows={5} columns={7} />
          ) : agents?.length === 0 ? (
            <p className="text-sm text-muted-foreground">No units registered yet. Add your first unit to get started.</p>
          ) : (
            <div className="overflow-auto rounded-md border">
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead>Name</TableHead>
                  <TableHead>Agent Code</TableHead>
                  <TableHead>Email</TableHead>
                  <TableHead>Phone</TableHead>
                  <TableHead>Unit</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {agents?.map((agent) => (
                  <TableRow key={agent.id}>
                    <TableCell className="font-medium">{agent.name}</TableCell>
                    <TableCell className="text-muted-foreground">{agent.agent_code}</TableCell>
                    <TableCell className="text-muted-foreground">{agent.email}</TableCell>
                    <TableCell className="text-muted-foreground">{agent.phone}</TableCell>
                    <TableCell className="text-muted-foreground">{agent.unit_name}</TableCell>
                    <TableCell>
                      <Badge variant={getStatusVariant(agent.status)}>
                        {agent.status}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" className="size-8 p-0" aria-label="Actions">
                            <MoreHorizontal className="size-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem asChild>
                            <Link to="/agents/$agentId/edit" params={{ agentId: agent.id }}>
                              <Pencil className="mr-2 size-4" />
                              Edit Unit
                            </Link>
                          </DropdownMenuItem>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem
                            className="text-red-600"
                            onClick={() => handleDelete(agent.id)}
                            disabled={deleteAgent.isPending}
                          >
                            <Trash2 className="mr-2 size-4" />
                            Delete Unit
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Delete Confirmation */}
      <AlertDialog open={!!deleteId} onOpenChange={(open) => !open && setDeleteId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Unit</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete this unit? This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={confirmDelete} className="bg-red-600 hover:bg-red-700">
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Reject Tier Request Dialog */}
      <Dialog open={!!rejectId} onOpenChange={(open) => !open && setRejectId(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Reject Tier Request</DialogTitle>
            <DialogDescription>
              Optionally provide a reason for rejecting this tier request.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label htmlFor="reject-notes">Notes (optional)</Label>
              <Input
                id="reject-notes"
                value={rejectNotes}
                onChange={e => setRejectNotes(e.target.value)}
                placeholder="Reason for rejection..."
                className="mt-1.5"
              />
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setRejectId(null)}>
                Cancel
              </Button>
              <Button
                onClick={handleReject}
                disabled={rejectTierRequest.isPending}
                className="bg-red-600 hover:bg-red-700"
              >
                {rejectTierRequest.isPending ? 'Rejecting...' : 'Reject'}
              </Button>
            </DialogFooter>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
```

- [ ] **Step 4: Commit**

```bash
git add apps/admin-portal/src/hooks/useTierRequests.ts apps/admin-portal/src/hooks/useAgents.ts apps/admin-portal/src/pages/agents/AgentList.tsx
git commit -m "feat(admin): add tier request management to Units page"
```

---

### Task 11: Admin Portal — Notification Badge on Units Nav

**Files:**
- Modify: `apps/admin-portal/src/components/Layout.tsx`

- [ ] **Step 1: Add pending count badge to Units nav item**

In `apps/admin-portal/src/components/Layout.tsx`, add the import for the hook and update the navigation rendering.

Add import at top (after existing imports):
```typescript
import { usePendingTierRequestCount } from '../hooks/useTierRequests';
```

Inside the `Layout` component, after `const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);`, add:
```typescript
const { data: pendingTierCount } = usePendingTierRequestCount();
```

Find all three instances (desktop nav, mobile nav render) where nav items are rendered in the `{navigation.map((item) => {` block. In each, after `{item.name}`, add:

```tsx
{item.name}
{item.name === 'Units' && pendingTierCount ? (
  <span className="ml-auto inline-flex items-center justify-center rounded-full bg-amber-500 text-white text-xs font-medium px-1.5 py-0.5 min-w-[1.25rem]">
    {pendingTierCount}
  </span>
) : null}
```

- [ ] **Step 2: Commit**

```bash
git add apps/admin-portal/src/components/Layout.tsx
git commit -m "feat(admin): add tier request notification badge to Units nav"
```

---

### Task 12: Fix Nullable Tier References Across Agent Portal

**Files:**
- Modify: `apps/agent-portal/src/pages/Dashboard.tsx` (where `agent?.tier?.reward_amount` and `agent?.tier?.invitation_limit_per_slot` are used)
- Modify: `apps/agent-portal/src/pages/MyLinks.tsx` (where `agent?.tier?.invitation_limit_per_slot` is used)
- Modify: `apps/agent-portal/src/pages/Campaigns.tsx` (where `agent?.tier?.invitation_limit_per_slot` is used)

Since `tier` is now `Tier | null`, existing optional chaining (`agent?.tier?.name`) already handles this safely. However, you need to check for places that assume a tier always exists and show a "No tier assigned" message or disable link generation.

- [ ] **Step 1: Update MyLinks.tsx to block link generation without a tier**

In `apps/agent-portal/src/pages/MyLinks.tsx`, find where `maxPerSlot` is defined:
```typescript
const maxPerSlot = agent?.tier?.invitation_limit_per_slot;
```

After this line, add a guard at the top of the page render. If `agent?.tier` is null, show a message:

Add after the role check / early return in the component, before the main return:
```typescript
if (agent && !agent.tier) {
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

- [ ] **Step 2: Update Campaigns.tsx similarly**

In `apps/agent-portal/src/pages/Campaigns.tsx`, add the same guard after the component's early auth checks:

```typescript
if (agent && !agent.tier) {
  return (
    <div className="flex flex-col gap-4 animate-fade-in">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">Events</h1>
        <p className="text-sm text-muted-foreground">Browse active events</p>
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

- [ ] **Step 3: Verify typecheck passes**

Run: `pnpm -r typecheck 2>&1 | tail -20`
Expected: No type errors. All nullable tier references are handled.

- [ ] **Step 4: Commit**

```bash
git add apps/agent-portal/src/pages/MyLinks.tsx apps/agent-portal/src/pages/Campaigns.tsx
git commit -m "fix: handle nullable tier in link generation pages"
```

---

### Task 13: Final Verification

- [ ] **Step 1: Run full typecheck**

Run: `pnpm -r typecheck`
Expected: All packages compile without errors.

- [ ] **Step 2: Run lint**

Run: `pnpm lint`
Expected: No lint errors in changed files.

- [ ] **Step 3: Verify build**

Run: `pnpm build 2>&1 | tail -20`
Expected: All three apps build successfully.

- [ ] **Step 4: Manual verification checklist**

Verify these scenarios work:
1. Existing agent logs in → role = `agent_admin` → sees My Agents + Partners in nav
2. My Agents page shows the agent admin as first row with "You" badge
3. "Add Agent" creates a sub-agent (visible in the list, no tier)
4. "Request Tier" on sub-agent → creates pending request
5. Admin portal Units page shows pending tier request with approve/reject
6. Approving sets the sub-agent's tier
7. Sub-agent logs in → role = `agent` → sees Dashboard, Events, My Links, Rewards (no My Agents, no Partners)
8. Sub-agent without tier → blocked from link generation
9. Sub-agent with approved tier → can generate links normally
