-- Migration: Shareable Links & WhatsApp OTP Redesign
-- Replaces invitation tokens + PIN codes with shareable agent links + OTP checkout

-- 1. Create new registration_status enum
CREATE TYPE registration_status AS ENUM ('registered', 'attended', 'completed', 'expired');

-- 2. Create agent_links table
CREATE TABLE agent_links (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id    uuid NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  slot_id     uuid NOT NULL REFERENCES slots(id) ON DELETE CASCADE,
  partner_id  uuid REFERENCES partners(id) ON DELETE SET NULL,
  link_code   uuid NOT NULL DEFAULT gen_random_uuid() UNIQUE,
  is_active   boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

-- Partial unique indexes: one link per agent per slot, one per partner per slot
CREATE UNIQUE INDEX agent_links_unique_agent_slot
  ON agent_links(agent_id, slot_id) WHERE partner_id IS NULL;
CREATE UNIQUE INDEX agent_links_unique_partner_slot
  ON agent_links(agent_id, slot_id, partner_id) WHERE partner_id IS NOT NULL;

CREATE TRIGGER set_agent_links_updated_at
  BEFORE UPDATE ON agent_links
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- 3. Drop pin_code_id from attendance (must happen before pin_codes drop)
ALTER TABLE attendance DROP CONSTRAINT IF EXISTS attendance_pin_code_id_fkey;
ALTER TABLE attendance DROP COLUMN IF EXISTS pin_code_id;

-- 4a. Data migration: convert 'pending' invitations to 'expired'
-- (old one-time tokens no longer valid in link-based model)
UPDATE invitations SET status = 'expired' WHERE status = 'pending';

-- 4b. Rename invitations → registrations
ALTER TABLE invitations RENAME TO registrations;

-- Drop policies that reference columns we're about to drop (must happen before column drops)
DROP POLICY IF EXISTS "Partners read agent invitations" ON registrations;
DROP POLICY IF EXISTS "Partners claim invitations" ON registrations;
DROP POLICY IF EXISTS "Agents manage own invitations" ON registrations;
DROP POLICY IF EXISTS "Admin full access to invitations" ON registrations;
DROP POLICY IF EXISTS "Public can read invitations by token" ON registrations;
DROP POLICY IF EXISTS "Public can update invitations for registration" ON registrations;

-- Drop indexes on columns we're about to drop
DROP INDEX IF EXISTS idx_invitations_partner;

-- Drop old columns
ALTER TABLE registrations DROP COLUMN IF EXISTS unique_token;
ALTER TABLE registrations DROP COLUMN IF EXISTS claimed_by_partner_id;

-- Add new column
ALTER TABLE registrations ADD COLUMN agent_link_id uuid REFERENCES agent_links(id);

-- Drop old default before type change (old default 'pending' can't cast to new enum)
ALTER TABLE registrations ALTER COLUMN status DROP DEFAULT;

-- Switch status column to new enum (safe now: no 'pending' values remain)
ALTER TABLE registrations
  ALTER COLUMN status TYPE registration_status
  USING status::text::registration_status;

-- Set new default for status
ALTER TABLE registrations ALTER COLUMN status SET DEFAULT 'registered';

-- Drop old global unique indexes and create per-slot indexes
DROP INDEX IF EXISTS idx_invitations_token;
DROP INDEX IF EXISTS invitations_invitee_nric_unique;
DROP INDEX IF EXISTS invitations_invitee_phone_unique;

CREATE UNIQUE INDEX registrations_unique_nric_per_slot
  ON registrations(slot_id, invitee_nric) WHERE invitee_nric IS NOT NULL;
CREATE UNIQUE INDEX registrations_unique_phone_per_slot
  ON registrations(slot_id, invitee_phone) WHERE invitee_phone IS NOT NULL;

-- Rename constraints, indexes, triggers for consistency
ALTER INDEX IF EXISTS invitations_pkey RENAME TO registrations_pkey;
ALTER TRIGGER invitations_updated_at ON registrations RENAME TO registrations_updated_at;

-- 5. Create otp_codes table
CREATE TABLE otp_codes (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  registration_id uuid NOT NULL REFERENCES registrations(id) ON DELETE CASCADE,
  slot_id         uuid NOT NULL REFERENCES slots(id) ON DELETE CASCADE,
  phone           text NOT NULL,
  code            text NOT NULL,
  expires_at      timestamptz NOT NULL,
  is_used         boolean NOT NULL DEFAULT false,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_otp_codes_verification
  ON otp_codes(registration_id, code, is_used, expires_at);
CREATE INDEX idx_otp_codes_rate_limit
  ON otp_codes(phone, slot_id, created_at);

-- 6. Rename invitation_id → registration_id in attendance
ALTER TABLE attendance RENAME COLUMN invitation_id TO registration_id;
ALTER TABLE attendance RENAME CONSTRAINT attendance_invitation_id_fkey TO attendance_registration_id_fkey;
ALTER TABLE attendance RENAME CONSTRAINT attendance_invitation_id_key TO attendance_registration_id_key;
ALTER INDEX IF EXISTS idx_attendance_invitation RENAME TO idx_attendance_registration;

-- 7. Drop pin_codes table
DROP TABLE IF EXISTS pin_codes;

-- 8. Drop whatsapp_send_log table
DROP TABLE IF EXISTS whatsapp_send_log;

-- 9. Rename campaigns.invitation_type → registration_type
ALTER TABLE campaigns RENAME COLUMN invitation_type TO registration_type;

-- 10. Drop old enum (after all references removed)
DROP TYPE IF EXISTS invitation_status;

-- 11. RLS for agent_links
ALTER TABLE agent_links ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admin full access to agent_links"
  ON agent_links FOR ALL TO authenticated
  USING (is_admin());

CREATE POLICY "Agents manage own links"
  ON agent_links FOR ALL TO authenticated
  USING (agent_id = get_agent_id())
  WITH CHECK (agent_id = get_agent_id());

CREATE POLICY "Partners manage own links"
  ON agent_links FOR ALL TO authenticated
  USING (partner_id = get_partner_id() AND agent_id = get_partner_agent_id())
  WITH CHECK (partner_id = get_partner_id() AND agent_id = get_partner_agent_id());

CREATE POLICY "Anon read active links"
  ON agent_links FOR SELECT TO anon
  USING (is_active = true);

-- RLS for otp_codes: no direct access, Edge Functions use service role
ALTER TABLE otp_codes ENABLE ROW LEVEL SECURITY;

-- Create new registrations RLS policies (old ones dropped earlier before column drops)
CREATE POLICY "Admin full access to registrations"
  ON registrations FOR ALL TO authenticated
  USING (is_admin());

CREATE POLICY "Agents read own registrations"
  ON registrations FOR SELECT TO authenticated
  USING (agent_id = get_agent_id());

CREATE POLICY "Partners read registrations via own links"
  ON registrations FOR SELECT TO authenticated
  USING (agent_link_id IN (
    SELECT id FROM agent_links WHERE partner_id = get_partner_id()
  ));

CREATE POLICY "Anon insert via RPC"
  ON registrations FOR INSERT TO anon
  WITH CHECK (true);

CREATE POLICY "Anon update for attendance flow"
  ON registrations FOR UPDATE TO anon
  USING (true)
  WITH CHECK (true);

-- Update attendance RLS policies (column renamed invitation_id → registration_id)
DROP POLICY IF EXISTS "Agents read own attendance" ON attendance;
DROP POLICY IF EXISTS "Admin full access to attendance" ON attendance;
DROP POLICY IF EXISTS "Public can insert attendance" ON attendance;
DROP POLICY IF EXISTS "Public can update attendance" ON attendance;

CREATE POLICY "Admin full access to attendance"
  ON attendance FOR ALL TO authenticated
  USING (is_admin());

CREATE POLICY "Agents read own attendance"
  ON attendance FOR SELECT TO authenticated
  USING (registration_id IN (SELECT id FROM registrations WHERE agent_id = get_agent_id()));

CREATE POLICY "Anon insert attendance"
  ON attendance FOR INSERT TO anon
  WITH CHECK (true);

CREATE POLICY "Anon update attendance"
  ON attendance FOR UPDATE TO anon
  USING (true)
  WITH CHECK (true);

-- 12. Atomic registration with capacity check
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
  v_capacity_type capacity_type;
  v_registration_id uuid;
BEGIN
  -- Look up agent_link with row lock (serializes concurrent registrations per link)
  SELECT * INTO v_link FROM agent_links WHERE link_code = p_link_code AND is_active = true FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Link not found or inactive' USING ERRCODE = 'P0001';
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

-- Grant anon access to RPC
GRANT EXECUTE ON FUNCTION register_attendee TO anon;

-- 12b. Atomic OTP verification + checkout (prevents double-checkout race condition)
CREATE OR REPLACE FUNCTION checkout_with_otp(
  p_registration_id uuid,
  p_otp_code text
) RETURNS boolean AS $$
DECLARE
  v_otp_id uuid;
BEGIN
  -- Find and lock valid OTP (FOR UPDATE prevents concurrent use)
  SELECT id INTO v_otp_id
  FROM otp_codes
  WHERE registration_id = p_registration_id
    AND code = p_otp_code
    AND is_used = false
    AND expires_at > now()
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Invalid or expired OTP' USING ERRCODE = 'P0010';
  END IF;

  -- Atomic: mark OTP used + update attendance + update registration
  UPDATE otp_codes SET is_used = true WHERE id = v_otp_id;

  UPDATE attendance
  SET checkout_time = now(), is_full_attendance = true
  WHERE registration_id = p_registration_id AND checkout_time IS NULL;

  UPDATE registrations
  SET status = 'completed', updated_at = now()
  WHERE id = p_registration_id;

  RETURN true;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION checkout_with_otp TO anon;

-- 13. Rewrite partner deactivation to deactivate links instead of releasing invitations
-- Keep parameter name 'partner_uuid' to match existing Edge Function call
CREATE OR REPLACE FUNCTION deactivate_partner_and_release(partner_uuid uuid)
RETURNS integer AS $$
DECLARE
  v_count integer;
BEGIN
  -- Deactivate all partner's links (replaces old invitation release logic)
  UPDATE agent_links
  SET is_active = false, updated_at = now()
  WHERE partner_id = partner_uuid AND is_active = true;

  GET DIAGNOSTICS v_count = ROW_COUNT;

  -- Update partner status
  UPDATE partners
  SET status = 'inactive', updated_at = now()
  WHERE id = partner_uuid;

  RETURN v_count;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
