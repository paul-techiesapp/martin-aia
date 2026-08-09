-- Round 8 item 5, follow-up: 20260808000003 scoped the `campaigns` table only.
-- `slots` had "Agents read active slots" USING (is_active = true) with no
-- campaign condition, and `agent_links` checked only ownership on write, so an
-- agent holding a slot id for an event outside their unit could still read the
-- slot and create a link for it through PostgREST. Hiding a row in the portal
-- is not the same as closing the data path.
--
-- Default-open is inherited unchanged: campaign_visible_to_me() returns true
-- for any campaign with no campaign_units rows, so every event that has not
-- been explicitly assigned behaves exactly as it does today.
--
-- Fix round 1: a subquery inside a policy expression runs with the referenced
-- table's own RLS applied. Wrapping the visibility check in
-- EXISTS (SELECT 1 FROM campaigns c ...) therefore also forced the caller to
-- satisfy "Agents read active campaigns" (status = 'active'), which made an
-- active slot on a draft/paused/completed campaign invisible -- a regression
-- versus the prior is_active-only policy. campaign_visible_to_me() is
-- SECURITY DEFINER and reads only campaign_units, so calling it directly
-- (no campaigns subquery) restores the original scope: visibility depends on
-- unit assignment alone, not on campaign status.

-- Slots: same policy name and shape, plus the campaign visibility condition.
-- The anon policy "Public can read slots" (20260205000001) and the admin
-- FOR ALL policy are deliberately untouched — public registration, check-in
-- and the venue display all read slots as anon.
DROP POLICY IF EXISTS "Agents read active slots" ON slots;
CREATE POLICY "Agents read active slots" ON slots
  FOR SELECT TO authenticated
  USING (
    is_active = true
    AND campaign_visible_to_me(slots.campaign_id)
  );

-- Same coupling problem applies to a WITH CHECK subquery against `slots`: it
-- would inherit "Agents read active slots" (is_active = true AND
-- campaign_visible_to_me), so a write could fail merely because the slot was
-- inactive, not only because the event was scoped away. This SECURITY
-- DEFINER helper reads slots directly, bypassing that coupling, and exposes
-- exactly the check the WITH CHECK needs: is this slot's campaign visible to
-- the caller.
CREATE OR REPLACE FUNCTION slot_campaign_visible_to_me(p_slot_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM slots s
    WHERE s.id = p_slot_id AND campaign_visible_to_me(s.campaign_id)
  );
$$;
GRANT EXECUTE ON FUNCTION slot_campaign_visible_to_me(uuid) TO authenticated;

-- agent_links: USING is deliberately UNCHANGED, so an agent keeps full read
-- and delete access to links they already created for an event that has since
-- been scoped away from them — links already handed out must keep working and
-- must stay manageable. Only the WITH CHECK tightens, which blocks creating a
-- NEW link for a slot whose campaign is not visible to the caller.
DROP POLICY IF EXISTS "Agents manage own links" ON agent_links;
CREATE POLICY "Agents manage own links"
  ON agent_links FOR ALL TO authenticated
  USING (agent_id = get_agent_id())
  WITH CHECK (
    agent_id = get_agent_id()
    AND slot_campaign_visible_to_me(slot_id)
  );
