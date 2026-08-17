-- Round 9 (client feedback 2026-08-17), two changes to registration:
--
-- 1. Per-event repeat-attendee toggle. The global completion gate
--    (20260325000001) permanently bars any NRIC with a completed registration
--    from registering for ANY later event. The new "Business Integration"
--    event must accept people who already completed BOP/JOP, so the gate
--    becomes skippable per event via campaigns.allow_repeat_attendees.
--    Default false: every existing event keeps the one-time behaviour.
--
-- 2. Unit gate at registration time. 20260808000003/4 scope event visibility
--    and NEW link creation to the assigned units, but a link that already
--    exists keeps accepting registrations even if its agent is outside the
--    event's units. Client asked for unit assignment to govern the Sign In &
--    Sign Out flow; the entry gate is registration (no registration -> no
--    check-in -> no check-out), so enforcement lands here. Check-in and
--    check-out themselves stay untouched on purpose: people who registered
--    before an event was restricted must still be able to complete it.

ALTER TABLE campaigns
  ADD COLUMN IF NOT EXISTS allow_repeat_attendees boolean NOT NULL DEFAULT false;

-- Parameterized sibling of campaign_visible_to_me() (20260808000003): same
-- default-open + recursive-ancestor semantics, but for an arbitrary agent id
-- instead of auth.uid(), because register_attendee() runs as anon. Recursive
-- walk mirrors agent_ancestor_ids() including the depth cap; flat
-- COALESCE(parent_agent_id, id) derivation is deliberately NOT used
-- (2026-08-04 failure mode).
CREATE OR REPLACE FUNCTION agent_in_campaign_units(p_agent_id uuid, p_campaign_id uuid)
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
      AND cu.unit_agent_id IN (
        WITH RECURSIVE up AS (
          SELECT a.id, a.parent_agent_id, 0 AS depth
          FROM agents a WHERE a.id = p_agent_id
          UNION ALL
          SELECT p.id, p.parent_agent_id, up.depth + 1
          FROM agents p
          JOIN up ON p.id = up.parent_agent_id
          WHERE up.depth < 50
        )
        SELECT id FROM up
      )
  );
$$;

-- Replace register_attendee(): identical to 20260330000004 except
--   (a) the campaign row is fetched right after the link lock so both new
--       checks can read it,
--   (b) new unit gate (P0006) before anything else,
--   (c) the global completion gate is skipped when the campaign allows
--       repeat attendees.
-- Error codes P0001-P0005 keep their exact meaning and text.
CREATE OR REPLACE FUNCTION register_attendee(
  p_link_code uuid,
  p_name text,
  p_nric text,
  p_phone text,
  p_email text DEFAULT NULL,
  p_occupation text DEFAULT NULL
) RETURNS uuid AS $$
DECLARE
  v_link agent_links%ROWTYPE;
  v_campaign campaigns%ROWTYPE;
  v_count integer;
  v_completed_count integer;
  v_capacity_type capacity_type;
  v_registration_id uuid;
BEGIN
  -- Look up agent_link with row lock (serializes concurrent registrations per link)
  SELECT * INTO v_link FROM agent_links WHERE link_code = p_link_code AND is_active = true FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Link not found or inactive' USING ERRCODE = 'P0001';
  END IF;

  SELECT c.* INTO v_campaign
  FROM campaigns c
  JOIN slots s ON s.campaign_id = c.id
  WHERE s.id = v_link.slot_id;

  -- Unit gate: for a unit-restricted event, the link's agent must belong to
  -- one of the assigned units. Closes the "old links keep registering" path.
  IF NOT agent_in_campaign_units(v_link.agent_id, v_campaign.id) THEN
    RAISE EXCEPTION 'This invitation link is not valid for this event'
      USING ERRCODE = 'P0006';
  END IF;

  -- Global completion gate: block registration if NRIC already completed an
  -- event — unless this event explicitly welcomes repeat attendees.
  IF p_nric IS NOT NULL AND NOT COALESCE(v_campaign.allow_repeat_attendees, false) THEN
    SELECT COUNT(*) INTO v_completed_count
    FROM registrations
    WHERE invitee_nric = p_nric AND status = 'completed';

    IF v_completed_count > 0 THEN
      RAISE EXCEPTION 'Invitee has already completed an event'
        USING ERRCODE = 'P0005';
    END IF;
  END IF;

  -- Campaign headcount check (only if max_headcount is set)
  IF v_campaign.max_headcount IS NOT NULL THEN
    SELECT COUNT(*) INTO v_count
    FROM registrations r
    JOIN slots s ON s.id = r.slot_id
    WHERE s.campaign_id = v_campaign.id;

    IF v_count >= v_campaign.max_headcount THEN
      RAISE EXCEPTION 'Registration full' USING ERRCODE = 'P0002';
    END IF;
  END IF;

  -- Determine capacity type
  IF v_link.partner_id IS NULL THEN
    v_capacity_type := 'agent';
  ELSE
    v_capacity_type := 'business_partner';
  END IF;

  -- Check NRIC duplicate per slot
  IF p_nric IS NOT NULL THEN
    PERFORM 1 FROM registrations WHERE slot_id = v_link.slot_id AND invitee_nric = p_nric;
    IF FOUND THEN
      RAISE EXCEPTION 'NRIC already registered for this slot' USING ERRCODE = 'P0003';
    END IF;
  END IF;

  -- Check phone duplicate per slot
  IF p_phone IS NOT NULL THEN
    PERFORM 1 FROM registrations WHERE slot_id = v_link.slot_id AND invitee_phone = p_phone;
    IF FOUND THEN
      RAISE EXCEPTION 'Phone already registered for this slot' USING ERRCODE = 'P0004';
    END IF;
  END IF;

  -- Insert registration
  INSERT INTO registrations (
    agent_link_id, agent_id, slot_id, capacity_type, status,
    invitee_name, invitee_nric, invitee_phone, invitee_email, invitee_occupation,
    registered_at
  ) VALUES (
    v_link.id, v_link.agent_id, v_link.slot_id, v_capacity_type, 'registered',
    p_name, p_nric, p_phone, p_email, p_occupation,
    now()
  ) RETURNING id INTO v_registration_id;

  RETURN v_registration_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
