-- Enable RLS on all tables
ALTER TABLE campaigns ENABLE ROW LEVEL SECURITY;
ALTER TABLE slots ENABLE ROW LEVEL SECURITY;
ALTER TABLE tiers ENABLE ROW LEVEL SECURITY;
ALTER TABLE agents ENABLE ROW LEVEL SECURITY;
ALTER TABLE invitations ENABLE ROW LEVEL SECURITY;
ALTER TABLE pin_codes ENABLE ROW LEVEL SECURITY;
ALTER TABLE attendance ENABLE ROW LEVEL SECURITY;
ALTER TABLE rewards ENABLE ROW LEVEL SECURITY;

-- Create admin check function
CREATE OR REPLACE FUNCTION is_admin()
RETURNS BOOLEAN AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM auth.users
    WHERE id = auth.uid()
    AND raw_user_meta_data->>'role' = 'admin'
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Create agent check function
CREATE OR REPLACE FUNCTION get_agent_id()
RETURNS UUID AS $$
BEGIN
  RETURN (SELECT id FROM agents WHERE user_id = auth.uid());
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Campaigns: Admin full access, agents read active only
CREATE POLICY "Admin full access to campaigns" ON campaigns FOR ALL TO authenticated USING (is_admin());
CREATE POLICY "Agents read active campaigns" ON campaigns FOR SELECT TO authenticated USING (status = 'active');

-- Slots: Admin full access, agents read active only
CREATE POLICY "Admin full access to slots" ON slots FOR ALL TO authenticated USING (is_admin());
CREATE POLICY "Agents read active slots" ON slots FOR SELECT TO authenticated USING (is_active = true);

-- Tiers: Admin full access, agents read only
CREATE POLICY "Admin full access to tiers" ON tiers FOR ALL TO authenticated USING (is_admin());
CREATE POLICY "Agents read tiers" ON tiers FOR SELECT TO authenticated USING (true);

-- Agents: Admin full access, agents read own data
CREATE POLICY "Admin full access to agents" ON agents FOR ALL TO authenticated USING (is_admin());
CREATE POLICY "Agents read own data" ON agents FOR SELECT TO authenticated USING (user_id = auth.uid());

-- Invitations: Admin full access, agents manage own
CREATE POLICY "Admin full access to invitations" ON invitations FOR ALL TO authenticated USING (is_admin());
CREATE POLICY "Agents manage own invitations" ON invitations FOR ALL TO authenticated USING (agent_id = get_agent_id());

-- PIN codes: Admin full access, public check-in/out access
CREATE POLICY "Admin full access to pin_codes" ON pin_codes FOR ALL TO authenticated USING (is_admin());
CREATE POLICY "Public can update pin_codes for checkin" ON pin_codes FOR UPDATE TO anon USING (true);
CREATE POLICY "Public can read pin_codes" ON pin_codes FOR SELECT TO anon USING (true);

-- Attendance: Admin full access, public can insert/update, agents read own
CREATE POLICY "Admin full access to attendance" ON attendance FOR ALL TO authenticated USING (is_admin());
CREATE POLICY "Public can insert attendance" ON attendance FOR INSERT TO anon WITH CHECK (true);
CREATE POLICY "Public can update attendance" ON attendance FOR UPDATE TO anon USING (true);
CREATE POLICY "Agents read own attendance" ON attendance FOR SELECT TO authenticated
  USING (invitation_id IN (SELECT id FROM invitations WHERE agent_id = get_agent_id()));

-- Rewards: Admin full access, agents read own
CREATE POLICY "Admin full access to rewards" ON rewards FOR ALL TO authenticated USING (is_admin());
CREATE POLICY "Agents read own rewards" ON rewards FOR SELECT TO authenticated USING (agent_id = get_agent_id());
