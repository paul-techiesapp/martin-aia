-- Round 4 hardening (staging smoke-test finding): the "active" clause of the
-- merchant/branch SELECT policies applied to ANY authenticated user, so the new
-- merchant portal logins could list every active merchant (incl. competitors'
-- share % and contacts). Require an agent identity for the browse clause;
-- merchants still read their own row via "Merchant user reads own merchant".
DROP POLICY IF EXISTS "Agents read active or own merchants" ON merchants;
CREATE POLICY "Agents read active or own merchants"
  ON merchants FOR SELECT TO authenticated
  USING (
    (status = 'active' AND get_agent_id() IS NOT NULL)
    OR created_by_agent_id = get_agent_id()
  );

DROP POLICY IF EXISTS "Agents read active or own branches" ON merchant_branches;
CREATE POLICY "Agents read active or own branches"
  ON merchant_branches FOR SELECT TO authenticated
  USING (
    (status = 'active' AND get_agent_id() IS NOT NULL)
    OR created_by_agent_id = get_agent_id()
  );
