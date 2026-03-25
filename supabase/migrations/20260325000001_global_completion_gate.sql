-- Global completion gate: prevent completed invitees from re-registering
-- Spec: docs/superpowers/specs/2026-03-25-global-completion-gate-design.md

-- 1. Partial index for efficient global NRIC completion lookup
CREATE INDEX idx_registrations_nric_completed
  ON registrations(invitee_nric)
  WHERE status = 'completed' AND invitee_nric IS NOT NULL;

-- 2. Replace register_attendee() with global completion gate
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
  v_tier tiers%ROWTYPE;
  v_agent agents%ROWTYPE;
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

  -- Global completion gate: block registration if NRIC already completed an event
  IF p_nric IS NOT NULL THEN
    SELECT COUNT(*) INTO v_completed_count
    FROM registrations
    WHERE invitee_nric = p_nric AND status = 'completed';

    IF v_completed_count > 0 THEN
      RAISE EXCEPTION 'Invitee has already completed an event'
        USING ERRCODE = 'P0005';
    END IF;
  END IF;

  -- Get agent's tier for capacity limit
  SELECT a.* INTO v_agent FROM agents a WHERE a.id = v_link.agent_id;
  SELECT t.* INTO v_tier FROM tiers t WHERE t.id = v_agent.tier_id;

  -- Capacity check (lock held on agent_link prevents concurrent over-registration)
  SELECT COUNT(*) INTO v_count
  FROM registrations
  WHERE agent_id = v_link.agent_id AND slot_id = v_link.slot_id;

  IF v_count >= v_tier.invitation_limit_per_slot THEN
    RAISE EXCEPTION 'Registration full' USING ERRCODE = 'P0002';
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
