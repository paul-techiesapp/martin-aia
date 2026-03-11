# Partners (Sub-Agents) Feature Design

**Date:** 2026-03-11
**Status:** Approved
**Approach:** Dedicated `partners` table (Approach A)

## Overview

Agents (Units) can recruit and manage Partners (sub-agents) who log into the Agent Portal to browse and claim available invitation links. Partners act as distribution arms — they don't create invitations, but pick from the Agent's pool and share them with their own invitees. Full attribution tracks which Partner shared which invitation.

## Requirements

1. Agents create Partner accounts from the Agent Portal (name, email, phone, optional NRIC, temp password)
2. Partners log into the same Agent Portal with email + password
3. Partners see all invitations created by their parent Agent (across all campaigns/slots)
4. Partners "claim" unclaimed invitations and receive the shareable link
5. System tracks which Partner claimed/shared each invitation (attribution)
6. Agents can deactivate Partners — `pending` invitations release back to the pool, `registered`+ stay attributed
7. Partners have a simplified view: available invitations to claim, and their claimed invitations with status

## Database Schema

### New `partners` table

```sql
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

-- Indexes
CREATE INDEX idx_partners_agent ON partners(agent_id);
CREATE INDEX idx_partners_user ON partners(user_id);

-- Updated_at trigger
CREATE TRIGGER partners_updated_at
  BEFORE UPDATE ON partners
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
```

### Modification to `invitations` table

```sql
ALTER TABLE invitations
  ADD COLUMN claimed_by_partner_id UUID REFERENCES partners(id) ON DELETE SET NULL;

CREATE INDEX idx_invitations_partner ON invitations(claimed_by_partner_id);
```

- `NULL` means unclaimed (or Agent shared it directly)
- `ON DELETE SET NULL` preserves the invitation if a partner record is removed

### RLS helper functions

```sql
CREATE OR REPLACE FUNCTION get_partner_id()
RETURNS UUID STABLE AS $$
  SELECT id FROM partners WHERE user_id = auth.uid() AND status = 'active';
$$ LANGUAGE sql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION get_partner_agent_id()
RETURNS UUID STABLE AS $$
  SELECT agent_id FROM partners WHERE user_id = auth.uid() AND status = 'active';
$$ LANGUAGE sql SECURITY DEFINER;
```

**Design assumption:** `get_agent_id()` returns `NULL` for partner users (they have no row in `agents`). This means existing agent-scoped RLS policies (e.g., `agent_id = get_agent_id()`) naturally exclude partners. This is intentional — partners get access only through the partner-specific policies below.

### RLS policies for `partners` table

```sql
ALTER TABLE partners ENABLE ROW LEVEL SECURITY;

-- Admin: full access
CREATE POLICY "Admin full access to partners"
  ON partners FOR ALL TO authenticated USING (is_admin());

-- Agents: manage own partners
CREATE POLICY "Agents manage own partners"
  ON partners FOR ALL TO authenticated
  USING (agent_id = get_agent_id())
  WITH CHECK (agent_id = get_agent_id());

-- Partners: read own record
CREATE POLICY "Partners read own data"
  ON partners FOR SELECT TO authenticated USING (user_id = auth.uid());
```

### Updated `invitations` RLS (new policies for partners)

```sql
-- Partners can read invitations belonging to their parent agent
CREATE POLICY "Partners read agent invitations"
  ON invitations FOR SELECT TO authenticated
  USING (agent_id = get_partner_agent_id());

-- Partners can claim unclaimed invitations (update claimed_by_partner_id only)
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
```

**Note on PII exposure:** Partners can read all columns of their parent agent's invitations, including invitee PII (`invitee_nric`, `invitee_phone`, etc.). This is intentional — Partners are trusted members of the Agent's unit and need invitee details to coordinate distribution. If stricter PII controls are needed in the future, column-level views can be introduced.

## Auth & Role Detection

### Login flow

1. User enters email + password → Supabase Auth signs in
2. Fetch from `agents` table where `user_id = auth.uid()` → if found, role = `agent`
3. If not found, fetch from `partners` where `user_id = auth.uid()` AND `status = 'active'` → if found, role = `partner`
4. If neither, sign out (unauthorized)

### Auth state

```typescript
interface AuthState {
  user: User | null;
  session: Session | null;
  agent: AgentWithTier | null;
  partner: PartnerWithAgent | null;
  role: 'agent' | 'partner' | null;
  isLoading: boolean;
}

interface Partner {
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

interface PartnerWithAgent extends Partner {
  agent: Agent;
}
```

### Partner user creation

An Edge Function is required because:
- `supabase.auth.signUp()` would sign out the current Agent session
- `admin.createUser()` requires `service_role` key (server-side only)

## Edge Functions

### `create-partner`

**Called by:** Agent (from Agent Portal)

**Input:**
```typescript
{
  name: string;
  email: string;
  phone: string;
  nric?: string;
  password: string;  // temp password set by Agent
}
```

**Flow:**
1. Verify caller is an authenticated agent (via JWT)
2. Get `agent_id` from the `agents` table using the caller's `user_id`
3. Create auth user via `supabase.auth.admin.createUser({ email, password, email_confirm: true })`
4. Insert into `partners` table with `agent_id` and the new `user_id`
5. Return the created partner record

**Error handling:**
- If email already exists in `auth.users` → return 409 Conflict with clear message
- If `partners` INSERT fails after auth user was created → delete the orphaned auth user via `admin.deleteUser()` before returning error
- Validate email format and password strength before creating the auth user

### `deactivate-partner`

**Called by:** Agent (from Agent Portal)

**Input:**
```typescript
{
  partner_id: string;
}
```

**Flow (all DB writes in a single transaction):**
1. Verify caller is the parent agent of this partner
2. Ban the auth user first: `supabase.auth.admin.updateUserById(user_id, { ban_duration: '876000h' })` (effectively permanent — prevents new requests)
3. In a single transaction:
   a. Update `partners.status = 'inactive'`
   b. Release unclaimed invitations: `UPDATE invitations SET claimed_by_partner_id = NULL WHERE claimed_by_partner_id = partner_id AND status = 'pending'`
4. Return success with count of released invitations

**Ordering rationale:** The auth ban is applied first to invalidate any active sessions. Then the status update and invitation release happen atomically so no stale session can re-claim a just-released invitation between steps.

## Agent Portal UI Changes

### Navigation (role-based sidebar)

**Agent sees:**
| Item | Route | Icon |
|------|-------|------|
| Dashboard | `/` | Home |
| Campaigns | `/campaigns` | Calendar |
| My Invitations | `/invitations` | Send |
| Rewards | `/rewards` | Award |
| **Partners** | `/partners` | Users |

**Partner sees:**
| Item | Route | Icon |
|------|-------|------|
| Dashboard | `/` | Home |
| Available Invitations | `/available-invitations` | Send |
| My Claimed Invitations | `/my-invitations` | CheckSquare |

### Partners Management Page (`/partners` — Agent only)

- **Stat cards:** Total partners, Active partners
- **Table columns:** Name, Email, Phone, Status, Invitations Claimed (count), Actions
- **Actions:** Add Partner (button → dialog), Deactivate (toggle)
- **Add Partner dialog:** Form with name, email, phone, NRIC (optional), temporary password fields

### Available Invitations Page (`/available-invitations` — Partner only)

- Shows unclaimed invitations (`claimed_by_partner_id IS NULL`) belonging to parent Agent
- Grouped by Campaign → Slot
- Each invitation row shows: Campaign name, Slot day/time, Capacity type, Status
- "Claim" button → sets `claimed_by_partner_id`, then shows Copy Link button
- **Concurrency handling:** If a claim UPDATE returns 0 rows (another partner claimed it first), show a toast: "This invitation was just claimed — please select another" and refresh the list
- Stat cards: Total available, Claimed by me

### My Claimed Invitations Page (`/my-invitations` — Partner only)

- Same layout as existing Agent Invitations page
- Filtered to `claimed_by_partner_id = partner.id`
- Shows: Campaign, Slot, Invitee name, Status, Copy link action
- Stat cards: Pending, Registered, Completed

### Dashboard adjustments

- **Agent dashboard:** Add "Active Partners" stat card
- **Partner dashboard:** Show claimed invitations stats (pending/registered/completed), parent agent name in welcome message

## Admin Portal Impact

Minimal:
- **Agents list:** Optionally add "Partners" count column
- **Agent detail:** Optionally show read-only partner list
- No new admin pages — partner management is the Agent's responsibility

## Data Flow

```
Agent creates invitation → invitation.claimed_by_partner_id = NULL (unclaimed)
                         ↓
Partner browses available invitations
                         ↓
Partner claims invitation → invitation.claimed_by_partner_id = partner.id
                         ↓
Partner copies link, shares with invitee
                         ↓
Invitee registers → invitation.status = 'registered' (attribution preserved)
                         ↓
Invitee attends event → attendance recorded → reward credited to Agent
```

## Security Considerations

- Edge Functions validate that the calling Agent owns the partner being managed
- Partners cannot claim already-claimed invitations (RLS enforces `claimed_by_partner_id IS NULL`)
- Deactivated partners are banned at the Supabase Auth level, preventing login
- Partners cannot modify invitation data beyond the `claimed_by_partner_id` field
- `service_role` key only used server-side in Edge Functions

## Out of Scope

- Partner-specific reward structures (rewards go to the Agent)
- Partner self-registration (Agent creates accounts)
- Partner-to-Partner transfers of claimed invitations
- Partner access to reward information
