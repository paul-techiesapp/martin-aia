-- Round 8 item 5: an event is accessible only to the unit(s) assigned to it.
--
-- Before: "Agents read active campaigns" (20260201000001) was
-- USING (status = 'active') with no unit condition, so every agent could
-- browse and create links for every event in the system.
--
-- DEFAULT-OPEN: a campaign with no rows in campaign_units stays visible to
-- everyone, exactly as today. Every existing production event has zero rows
-- the moment this lands, so nothing disappears; scoping begins only when an
-- admin assigns units. The opposite default would empty every agent portal on
-- deploy -- the 2026-08-04 failure mode.

CREATE TABLE IF NOT EXISTS campaign_units (
  campaign_id   uuid NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  unit_agent_id uuid NOT NULL REFERENCES agents(id)    ON DELETE CASCADE,
  created_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (campaign_id, unit_agent_id)
);
CREATE INDEX IF NOT EXISTS idx_campaign_units_unit ON campaign_units(unit_agent_id);

ALTER TABLE campaign_units ENABLE ROW LEVEL SECURITY;

-- Admins manage assignments. Agents never read this table directly -- their
-- visibility runs through campaign_visible_to_me(), which is SECURITY DEFINER
-- and therefore not blocked by the absence of an agent SELECT policy.
DROP POLICY IF EXISTS "Admins manage campaign_units" ON campaign_units;
CREATE POLICY "Admins manage campaign_units"
  ON campaign_units FOR ALL TO authenticated
  USING (is_admin()) WITH CHECK (is_admin());

-- Upward mirror of unit_member_ids() (20260804000001): the caller's own agent
-- id plus every ancestor. Depth-capped so a hypothetical parent cycle degrades
-- to a short list instead of hanging. Flat COALESCE(parent_agent_id, id) unit
-- derivation is deliberately NOT used -- that assumption is what hid
-- mid-level managers' teams on 2026-08-04.
CREATE OR REPLACE FUNCTION agent_ancestor_ids()
RETURNS SETOF uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH RECURSIVE up AS (
    SELECT a.id, a.parent_agent_id, 0 AS depth
    FROM agents a WHERE a.user_id = auth.uid()
    UNION ALL
    SELECT p.id, p.parent_agent_id, up.depth + 1
    FROM agents p
    JOIN up ON p.id = up.parent_agent_id
    WHERE up.depth < 50
  )
  SELECT id FROM up;
$$;
GRANT EXECUTE ON FUNCTION agent_ancestor_ids() TO authenticated;

-- Visible when unassigned (default-open) or when one of the assigned unit
-- heads is the caller or one of the caller's ancestors. SECURITY DEFINER so
-- the policy does not depend on the caller being able to read campaign_units.
CREATE OR REPLACE FUNCTION campaign_visible_to_me(p_campaign_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT NOT EXISTS (
    SELECT 1 FROM campaign_units cu WHERE cu.campaign_id = p_campaign_id
  ) OR EXISTS (
    SELECT 1 FROM campaign_units cu
    WHERE cu.campaign_id = p_campaign_id
      AND cu.unit_agent_id IN (SELECT agent_ancestor_ids())
  );
$$;
GRANT EXECUTE ON FUNCTION campaign_visible_to_me(uuid) TO authenticated;

DROP POLICY IF EXISTS "Agents read active campaigns" ON campaigns;
CREATE POLICY "Agents read active campaigns"
  ON campaigns FOR SELECT TO authenticated
  USING (status = 'active' AND campaign_visible_to_me(id));
