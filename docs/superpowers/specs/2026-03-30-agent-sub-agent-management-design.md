# Agent Sub-Agent Management & Tier Approval Workflow

**Date:** 2026-03-30
**Status:** Approved
**Approach:** Approach 1 — `parent_agent_id` on existing agents table

## Summary

Extend the agent portal so that Agent Admin accounts (created by the admin portal) can create and manage their own sub-agents. Add a tier approval workflow where Agent Admins request tier assignments for sub-agents, and admins approve or reject them in the admin portal.

## Terminology

- **Agent Admin**: An agent created by the admin portal (`parent_agent_id IS NULL`). Has full agent portal access plus management of sub-agents and partners.
- **Sub-agent**: An agent created by an Agent Admin (`parent_agent_id IS NOT NULL`). Has full agent portal access (campaigns, links, rewards) but cannot manage sub-agents or partners.
- **Partner**: Unchanged from current system. Created by Agent Admin, limited portal access.

## 1. Database Schema Changes

### 1a. Modify `agents` table

```sql
ALTER TABLE agents
  ADD COLUMN parent_agent_id UUID REFERENCES agents(id) ON DELETE CASCADE,
  ALTER COLUMN tier_id DROP NOT NULL;

CREATE INDEX idx_agents_parent ON agents(parent_agent_id);
```

- Agent Admins: `parent_agent_id = NULL`, `tier_id` set by admin (as today)
- Sub-agents: `parent_agent_id = <agent admin id>`, `tier_id = NULL` until approved
- All existing agents become Agent Admins automatically (parent_agent_id defaults to NULL)

### 1b. New `tier_requests` table

```sql
CREATE TYPE tier_request_status AS ENUM ('pending', 'approved', 'rejected');

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
```

- `agent_id`: the sub-agent receiving the tier
- `requested_by`: the Agent Admin making the request
- On approve: set `status = 'approved'`, `reviewed_at = now()`, update `agents.tier_id`
- On reject: set `status = 'rejected'`, `admin_notes`, `reviewed_at = now()`, `tier_id` stays NULL

### 1c. RLS Policies

- Agent Admin can `SELECT` agents where `parent_agent_id = own agent id` OR `id = own agent id`
- Agent Admin can `INSERT` agents with `parent_agent_id = own agent id`
- Sub-agents can only `SELECT` their own agent record
- Tier requests: Agent Admin can `INSERT` and `SELECT` own requests; Admin can `SELECT/UPDATE` all

### 1d. Partners table

No changes. Partners belong to Agent Admins via existing `agent_id` FK. Sub-agents cannot create partners (enforced by UI and optionally by RLS).

## 2. Auth & Role Detection

### 2a. Updated role hierarchy

```
useAuth() flow:
1. Check agents table for user_id
2. If found:
   a. parent_agent_id IS NULL → role = 'agent_admin'
   b. parent_agent_id IS NOT NULL → role = 'agent'
3. If not found, check partners table
   a. If found → role = 'partner'
4. If neither → sign out
```

AuthState type changes:
```typescript
role: 'agent_admin' | 'agent' | 'partner' | null
```

### 2b. Navigation mapping

| Role | Nav Items |
|------|-----------|
| `agent_admin` | Dashboard, Events, My Links, Rewards, My Agents, Partners |
| `agent` | Dashboard, Events, My Links, Rewards |
| `partner` | Dashboard, My Links |

### 2c. Feature gating

- My Agents page: `agent_admin` only
- Partners page: `agent_admin` only
- Link generation: Blocked when `tier_id = NULL` (no approved tier)
- Campaigns, My Links, Rewards: Both `agent_admin` and `agent`

## 3. Agent Portal — My Agents Page

### 3a. Page layout

Stats section (top):
- Total Agents count
- Active Agents count
- Pending Tier Requests count

Agent list table columns:
| Name | Agent Code | Email | Phone | Tier | Tier Status | Status | Actions |

First row: The Agent Admin themselves (read-only, no actions). Visually distinguished with subtle highlight or "You" badge.

Remaining rows: Sub-agents ordered by creation date (newest first).

### 3b. Tier column behavior

- `tier_id` set and approved: shows tier name
- Tier request pending: "Pending Approval" badge (amber)
- No tier requested: "No Tier" with "Request Tier" button
- Tier request rejected: "Rejected" badge (red) with option to request again

### 3c. Add Agent dialog

Fields: Name, Email, Phone, NRIC (optional), Agent Code, Temporary Password.
Unit name: Auto-inherited from Agent Admin (not shown in form).
No tier selection at creation — separate action.
Creates auth user + agent record via `create-sub-agent` edge function.

### 3d. Request Tier action

Action available on any row including the Agent Admin's own row (to request a tier change for themselves) and sub-agent rows:
- Opens dialog with tier dropdown (all available tiers, showing name + reward amount)
- Creates row in `tier_requests` table
- Button changes to "Tier Requested" (disabled) while pending
- For Agent Admin's own row: only shows "Request Tier" if they want to change their current tier

### 3e. Deactivate Agent action

Confirmation dialog, calls `deactivate-sub-agent` edge function. Sets `status = 'inactive'`.

## 4. Admin Portal — Tier Request Management

### 4a. Units page enhancement

Notification badge on "Units" nav item showing pending request count.

Collapsible "Pending Tier Requests" section at top of Units page, above existing "All Units" card.

### 4b. Request row columns

| Sub-agent Name | Agent Code | Requested By (Agent Admin) | Requested Tier | Reward Amount | Requested Date | Actions |

Actions: Approve (green check) and Reject (red X) buttons.

### 4c. Approve flow

1. Admin clicks Approve
2. `tier_requests.status` = `'approved'`, `reviewed_at` = now
3. `agents.tier_id` = requested tier
4. Toast confirmation

### 4d. Reject flow

1. Admin clicks Reject
2. Optional admin notes in confirmation dialog
3. `tier_requests.status` = `'rejected'`, `admin_notes` saved, `reviewed_at` = now
4. `agents.tier_id` stays NULL
5. Agent Admin can submit new request later

### 4e. All Units table filtering

Only show Agent Admin accounts (`parent_agent_id IS NULL`) by default. Sub-agents are managed by their Agent Admins. The tier request section handles admin oversight.

## 5. Edge Functions

### 5a. `create-sub-agent`

1. Validate caller is Agent Admin (`parent_agent_id IS NULL`)
2. Create auth user (email + temporary password, email_confirm: true)
3. Insert agent record: `parent_agent_id` = caller's ID, `unit_name` = caller's unit_name, `agent_code` = provided, `tier_id` = NULL
4. On failure: cleanup orphaned auth user

### 5b. `request-tier`

1. Validate caller is Agent Admin
2. Validate target agent has `parent_agent_id` = caller's ID, OR target is caller themselves
3. Check no pending request exists for this agent
4. Insert into `tier_requests`

### 5c. `deactivate-sub-agent`

1. Validate caller is Agent Admin
2. Validate target agent has `parent_agent_id` = caller's ID
3. Set `agents.status = 'inactive'`

### 5d. Tier approval (admin portal)

Direct Supabase queries with admin RLS (no edge function needed):
- Update `tier_requests.status` and `reviewed_at`
- On approve: also update `agents.tier_id`

## 6. Shared Types

### New enum
```typescript
export enum TierRequestStatus {
  PENDING = 'pending',
  APPROVED = 'approved',
  REJECTED = 'rejected',
}
```

### New interfaces
```typescript
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

## 7. Migration Safety

- `parent_agent_id` defaults to NULL — all existing agents become Agent Admins with no data change
- `tier_id` becomes nullable — existing agents already have tier_id set, so no impact
- New `tier_requests` table is additive — no existing data affected
- Existing partner flow unchanged
