-- Admin-only deletion of a public registration.
--
-- The public registration form (register_attendee RPC) enforces three permanent
-- identity gates: a global completion gate (a person whose NRIC has a 'completed'
-- registration can never register again), plus per-slot NRIC and phone
-- uniqueness. Until now there was NO delete path for the registrations table at
-- all (anon has INSERT/UPDATE only, agents/partners SELECT only, and deleting an
-- agent/partner auth user does not touch registrations because there is no FK
-- between them). That made a tested or erroneous registrant permanently
-- un-clearable and blocked re-registration with the same NRIC/phone.
--
-- This gives admins a supported way to remove such a registration. attendance,
-- otp_codes (and any reward via attendance) are ON DELETE CASCADE off
-- registrations, so they are removed automatically.
CREATE OR REPLACE FUNCTION delete_registration(p_registration_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT is_admin() THEN
    RAISE EXCEPTION 'Only admins can delete registrations' USING ERRCODE = '42501';
  END IF;

  DELETE FROM registrations WHERE id = p_registration_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Registration not found' USING ERRCODE = 'P0001';
  END IF;
END;
$$;

-- Lock down execution: only authenticated callers reach the function, and the
-- is_admin() check inside gates the actual delete.
REVOKE ALL ON FUNCTION delete_registration(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION delete_registration(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION delete_registration(uuid) TO authenticated;
