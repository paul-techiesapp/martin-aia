-- Item 3(a) (feedback round 2): Unit Manager role.
-- A Unit Manager = an agent flagged is_unit_manager who gets the SAME unit-wide
-- view as a Unit Admin (parent_agent_id IS NULL), scoped to their unit root.
-- Additive: existing "Unit admins read unit ..." policies stay; these new
-- "Unit viewers ..." policies are OR-combined and also cover unit admins.
ALTER TABLE agents ADD COLUMN IF NOT EXISTS is_unit_manager boolean NOT NULL DEFAULT false;

-- Unit root of the CURRENT caller: their parent if a sub-agent, else themselves.
CREATE OR REPLACE FUNCTION get_unit_root()
RETURNS uuid
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(a.parent_agent_id, a.id)
  FROM agents a WHERE a.user_id = auth.uid();
$$;

-- Whether the caller may view their whole unit (unit admin OR unit manager).
CREATE OR REPLACE FUNCTION is_unit_viewer()
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM agents a
    WHERE a.user_id = auth.uid()
      AND (a.parent_agent_id IS NULL OR a.is_unit_manager)
  );
$$;

-- Set of agent ids in the caller's unit (root + every agent sharing that root),
-- but only when the caller is a unit viewer. SECURITY DEFINER so it bypasses RLS
-- internally (no recursion with the agents policy below).
CREATE OR REPLACE FUNCTION unit_member_ids()
RETURNS SETOF uuid
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT a.id FROM agents a
  WHERE is_unit_viewer()
    AND COALESCE(a.parent_agent_id, a.id) = get_unit_root();
$$;

-- Extend unit-scope SELECT RLS to unit viewers (admins + managers).
DROP POLICY IF EXISTS "Unit viewers read unit agents" ON agents;
CREATE POLICY "Unit viewers read unit agents" ON agents
  FOR SELECT TO authenticated
  USING (id IN (SELECT unit_member_ids()));

DROP POLICY IF EXISTS "Unit viewers read unit registrations" ON registrations;
CREATE POLICY "Unit viewers read unit registrations" ON registrations
  FOR SELECT TO authenticated
  USING (agent_id IN (SELECT unit_member_ids()));

DROP POLICY IF EXISTS "Unit viewers read unit rewards" ON rewards;
CREATE POLICY "Unit viewers read unit rewards" ON rewards
  FOR SELECT TO authenticated
  USING (agent_id IN (SELECT unit_member_ids()));

DROP POLICY IF EXISTS "Unit viewers read unit attendance" ON attendance;
CREATE POLICY "Unit viewers read unit attendance" ON attendance
  FOR SELECT TO authenticated
  USING (registration_id IN (
    SELECT r.id FROM registrations r WHERE r.agent_id IN (SELECT unit_member_ids())
  ));

DROP POLICY IF EXISTS "Unit viewers read unit links" ON agent_links;
CREATE POLICY "Unit viewers read unit links" ON agent_links
  FOR SELECT TO authenticated
  USING (agent_id IN (SELECT unit_member_ids()));
