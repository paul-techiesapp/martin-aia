-- Unit Admin reporting access
--
-- A "Unit Admin" is an agents row whose parent_agent_id IS NULL; get_agent_id()
-- returns that agent's id, and their sub-agents have parent_agent_id = that id.
-- Previously the only SELECT policies on the reporting tables scoped rows to the
-- row owner (agent_id = get_agent_id()) or to partners reading their own links,
-- so a Unit Admin could see ONLY their personal activity and none of their
-- unit's (sub-agents' / partners') registrations, rewards, attendance or links.
--
-- These are additive SELECT policies. PostgreSQL OR-combines policies of the same
-- command, so plain agents and partners keep their existing own-data access
-- unchanged; only the parent (Unit Admin) gains read access to their children.
-- get_agent_id() is SECURITY DEFINER and returns NULL for non-agent users, so the
-- IN (...) subqueries are empty (deny) for partners/admins and cause no leak.

-- Registrations owned by the admin's sub-agents
CREATE POLICY "Unit admins read unit registrations"
  ON registrations FOR SELECT TO authenticated
  USING (
    agent_id IN (SELECT id FROM agents WHERE parent_agent_id = get_agent_id())
  );

-- Registrations captured through partner links under the admin's unit
CREATE POLICY "Unit admins read unit partner registrations"
  ON registrations FOR SELECT TO authenticated
  USING (
    agent_link_id IN (
      SELECT al.id
      FROM agent_links al
      JOIN partners p ON p.id = al.partner_id
      WHERE p.agent_id = get_agent_id()
    )
  );

-- Rewards earned by the admin's sub-agents
CREATE POLICY "Unit admins read unit rewards"
  ON rewards FOR SELECT TO authenticated
  USING (
    agent_id IN (SELECT id FROM agents WHERE parent_agent_id = get_agent_id())
  );

-- Attendance for registrations owned by the admin's sub-agents
CREATE POLICY "Unit admins read unit attendance"
  ON attendance FOR SELECT TO authenticated
  USING (
    registration_id IN (
      SELECT r.id
      FROM registrations r
      JOIN agents a ON a.id = r.agent_id
      WHERE a.parent_agent_id = get_agent_id()
    )
  );

-- agent_links owned by the admin's sub-agents (so unit link reports work)
CREATE POLICY "Unit admins read unit links"
  ON agent_links FOR SELECT TO authenticated
  USING (
    agent_id IN (SELECT id FROM agents WHERE parent_agent_id = get_agent_id())
  );
