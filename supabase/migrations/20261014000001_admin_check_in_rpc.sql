-- Atomic admin check-in.
--
-- The scanner used to insert the attendance row and then update the
-- registration status in two separate client requests. On flaky venue
-- networks the second request was sometimes lost, leaving an attendance row
-- with status still 'registered' (scanner says "already checked in", admin list
-- says "registered", checkout says "not checked in"). This RPC does both writes
-- in one transaction, and heals that split state if it is ever met again.

CREATE OR REPLACE FUNCTION public.admin_check_in(p_registration_id uuid)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_inserted boolean;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Not authorized' USING ERRCODE = '42501';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM registrations WHERE id = p_registration_id) THEN
    RAISE EXCEPTION 'Registration not found' USING ERRCODE = 'P0002';
  END IF;

  INSERT INTO attendance (registration_id, checkin_time, checkout_time, is_full_attendance)
  VALUES (p_registration_id, now(), NULL, false)
  ON CONFLICT (registration_id) DO NOTHING;
  v_inserted := FOUND;

  -- Runs for both a fresh check-in and a re-scan, so a registration left at
  -- 'registered' by the old two-step flow is repaired on the next scan.
  UPDATE registrations
  SET status = 'attended', updated_at = now()
  WHERE id = p_registration_id AND status = 'registered';

  RETURN CASE WHEN v_inserted THEN 'checked_in' ELSE 'already_checked_in' END;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_check_in(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_check_in(uuid) TO authenticated;
