# Partner Tier Management

**Date:** 2026-03-30
**Status:** Approved
**Approach:** Extend existing `tier_requests` table with `partner_id` column

## Summary

Extend the tier request workflow to support partners. Agent Admins can request tier assignments for their partners (same approval flow as sub-agents). Partners with an approved tier get invitation limits and earn rewards based on their tier's reward amount. Partners without a tier are blocked from generating links.

## 1. Database Schema Changes

### 1a. Add `tier_id` to `partners` table

```sql
ALTER TABLE partners
  ADD COLUMN tier_id UUID REFERENCES tiers(id);
```

Nullable — partners start without a tier until approved.

### 1b. Extend `tier_requests` table

```sql
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

CHECK constraint ensures exactly one of `agent_id` or `partner_id` is set.

### 1c. RLS

No new RLS policies needed. Existing policies on `tier_requests` use `requested_by = get_agent_id()` which still covers partner tier requests (the Agent Admin is always the requester).

## 2. Edge Function Changes

### 2a. Extend `request-tier` edge function

Current input: `{ agent_id, tier_id }`
New input: `{ agent_id?, partner_id?, tier_id }` — one of `agent_id` or `partner_id` required.

Validation:
- If `partner_id` provided: verify partner exists and `partner.agent_id = caller's agent id`
- If `agent_id` provided: existing logic unchanged (verify sub-agent or self)
- Check no pending request exists for this partner
- Verify tier exists

Insert: `tier_requests` with `partner_id` set and `agent_id` NULL.

## 3. Shared Types Changes

### 3a. Update `TierRequest` interface

```typescript
export interface TierRequest {
  id: string;
  agent_id: string | null;      // was: string (now nullable)
  partner_id: string | null;     // new field
  requested_tier_id: string;
  requested_by: string;
  status: TierRequestStatus;
  admin_notes: string | null;
  reviewed_at: string | null;
  created_at: string;
  updated_at: string;
}
```

### 3b. Update `TierRequestWithDetails`

```typescript
export interface TierRequestWithDetails extends TierRequest {
  agent: Agent | null;           // was: Agent (now nullable)
  partner: Partner | null;       // new field
  requested_tier: Tier;
  requester: Agent;
}
```

### 3c. Update `Partner` interface

Add `tier_id`:
```typescript
export interface Partner {
  id: string;
  agent_id: string;
  user_id: string;
  name: string;
  email: string;
  phone: string;
  nric: string | null;
  tier_id: string | null;        // new field
  status: AgentStatus;
  created_at: string;
  updated_at: string;
}
```

### 3d. Add `PartnerWithTier`

```typescript
export interface PartnerWithTier extends Partner {
  tier: Tier | null;
}
```

## 4. Agent Portal — Partners Page

### 4a. Tier column in partners table

Add a Tier column to the Partners page table. Display logic (same as My Agents):
- `tier_id` set → show tier name
- Pending tier request → "Pending Approval" amber badge
- No tier requested → "Request Tier" button
- Rejected request → "Rejected" red badge with "Retry" button

### 4b. Update `useMyPartners` hook

Change query to join tiers: `select('*, tier:tiers(*)')` and return `PartnerWithTier[]`.

### 4c. Request Tier dialog

Same dialog pattern as My Agents: tier dropdown with all available tiers, calls `request-tier` edge function with `partner_id` instead of `agent_id`.

### 4d. Tier requests data

Reuse `useMyTierRequests` hook from `useSubAgents.ts` (reads all tier requests by the Agent Admin). Filter by `partner_id` to find pending/rejected requests per partner.

## 5. Agent Portal — PartnerLinks Page

### 5a. Block link generation without tier

Partners without an approved tier (`tier_id IS NULL`) see a "tier required" message instead of the links UI. Same pattern as MyLinks/Campaigns pages for sub-agents.

## 6. Admin Portal — Unified Tier Requests

### 6a. Update pending requests table

Add a Type column to distinguish agent vs partner requests:

| Name | Type | Code | Requested By | Requested Tier | Reward | Requested | Actions |

- Type: "Agent" or "Partner" badge with different styling
- Name: from `req.agent?.name` or `req.partner?.name`
- Code: from `req.agent?.agent_code` or "—" for partners

### 6b. Update `usePendingTierRequests` query

Add partner join:
```
select(`
  *,
  agent:agents!tier_requests_agent_id_fkey(*),
  partner:partners!tier_requests_partner_id_fkey(*),
  requested_tier:tiers(*),
  requester:agents!tier_requests_requested_by_fkey(*)
`)
```

### 6c. Update approve flow

`useApproveTierRequest`: if request has `partner_id`, update `partners.tier_id` instead of `agents.tier_id`.

## 7. Migration Safety

- `partners.tier_id` defaults to NULL — existing partners unaffected
- `tier_requests.agent_id` becomes nullable — existing rows all have `agent_id` set, so no impact
- `tier_requests.partner_id` defaults to NULL — existing rows unaffected
- CHECK constraint validates only new/updated rows — existing data already satisfies the constraint
- Existing partner flow (create, deactivate, links) unchanged
