-- Round 8 fix wave: two Important gaps found in a final branch review of
-- 20260808000003/000004. Both are latent in production today because
-- campaign_units is still empty -- they fire the first time an admin
-- assigns a unit to an event.
--
-- Gap 1: "Agents read active slots" (20260808000004) makes a slot unreadable
-- once its campaign is scoped away from the caller's unit. An agent who
-- already created a link to that slot loses the embedded `slot` object in
-- useAgentLinks/usePartnerLinks (the client filters out slot=null so the
-- non-nullable type holds), so the link vanishes from My Links entirely --
-- no QR, no deactivate control -- even though 20260808000004's own comment
-- promises links already handed out "must stay manageable". The public
-- link keeps working (anon policy untouched); this is a management gap.
--
-- Fix: OR in slot ownership via agent_links. The subquery below is filtered
-- to al.agent_id = get_agent_id(), which is exactly the predicate
-- agent_links' own "Agents manage own links" USING clause enforces. RLS
-- applied to this subquery can only narrow visible agent_links rows to
-- (agent_id = get_agent_id() OR agent_id = get_partner_agent_id() OR
-- is_admin()) -- an OR of policies -- and our explicit filter already
-- satisfies the first branch, so RLS can never remove a row our WHERE
-- clause would otherwise return. That's different from the campaigns-status
-- coupling 20260808000004 had to route around with a SECURITY DEFINER
-- helper (there, the referenced table's RLS added an *extra* unwanted
-- condition). Here the referenced table's RLS predicate is a strict subset
-- of what we already require, so a plain subquery is correct and simpler --
-- no helper function needed.
DROP POLICY IF EXISTS "Agents read active slots" ON slots;
CREATE POLICY "Agents read active slots" ON slots
  FOR SELECT TO authenticated
  USING (
    is_active = true
    AND (
      campaign_visible_to_me(slots.campaign_id)
      OR EXISTS (
        SELECT 1 FROM agent_links al
        WHERE al.slot_id = slots.id AND al.agent_id = get_agent_id()
      )
    )
  );

-- Gap 2: agent_ancestor_ids() (20260808000003) resolves only via
-- agents.user_id = auth.uid(). A partner-portal login has no agents row, so
-- the set is always empty and campaign_visible_to_me() is false for every
-- scoped campaign -- even when the partner's own owning agent sits inside
-- the assigned unit. Partners use the agent portal's /partner-links page
-- (useActiveCampaigns + useCampaignSlots), so a partner whose agent IS in
-- the assigned unit could neither browse the event nor create links.
--
-- Fix: fall back to walking up from the partner's owning agent
-- (get_partner_agent_id(), from 20260311000004_partners.sql) when the
-- caller has no agents row of their own. A caller who is neither an agent
-- nor a partner resolves the COALESCE to NULL, `a.id = NULL` matches
-- nothing, and the function still returns an empty set for them. Depth cap
-- and SECURITY DEFINER / search_path conventions are unchanged.
CREATE OR REPLACE FUNCTION agent_ancestor_ids()
RETURNS SETOF uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH RECURSIVE up AS (
    SELECT a.id, a.parent_agent_id, 0 AS depth
    FROM agents a
    WHERE a.id = COALESCE(
      (SELECT id FROM agents WHERE user_id = auth.uid()),
      get_partner_agent_id()
    )
    UNION ALL
    SELECT p.id, p.parent_agent_id, up.depth + 1
    FROM agents p
    JOIN up ON p.id = up.parent_agent_id
    WHERE up.depth < 50
  )
  SELECT id FROM up;
$$;
GRANT EXECUTE ON FUNCTION agent_ancestor_ids() TO authenticated;

-- Gap 2, continued: for symmetry with the agent-side fix in
-- 20260808000004, close the same write path for partners. "Partners manage
-- own links" (20260313000001) had no slot-visibility condition at all, so a
-- partner could create a link for a slot outside their scope through
-- PostgREST. USING is deliberately UNCHANGED -- partners keep full
-- read/manage access to links they already created for events since scoped
-- away, exactly like the agent-side policy.
DROP POLICY IF EXISTS "Partners manage own links" ON agent_links;
CREATE POLICY "Partners manage own links"
  ON agent_links FOR ALL TO authenticated
  USING (partner_id = get_partner_id() AND agent_id = get_partner_agent_id())
  WITH CHECK (
    partner_id = get_partner_id()
    AND agent_id = get_partner_agent_id()
    AND slot_campaign_visible_to_me(slot_id)
  );
