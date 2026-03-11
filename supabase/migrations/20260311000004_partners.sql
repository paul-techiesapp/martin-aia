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
