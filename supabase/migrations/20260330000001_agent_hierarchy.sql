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
