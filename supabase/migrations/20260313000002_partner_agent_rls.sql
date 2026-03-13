-- Allow partners to read the agent they belong to
-- Without this, the join `select('*, agent:agents(*)')` in useAuth.ts
-- returns null for partner users because no RLS policy grants them
-- SELECT access on the agents table.
CREATE POLICY "Partners read own agent"
  ON agents FOR SELECT TO authenticated
  USING (id = get_partner_agent_id());
