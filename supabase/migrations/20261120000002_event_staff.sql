-- Event-specific access for organising teams (Nov 2026).
--
-- An "event staff" login (auth app_metadata.role = 'event_staff', created by an
-- admin via the manage-event-staff edge fn) can sign in to the admin portal but
-- only reaches the Check-In scanner + venue (checkout QR) display, and only for
-- the events an admin assigned to it. Data access is enforced here, not just in
-- the UI: staff can read registrations / attendance only for assigned events,
-- and admin_check_in accepts them only for those events.

-- 1. Tables --------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.event_staff (
  user_id    uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  name       text NOT NULL,
  email      text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.campaign_staff (
  campaign_id uuid NOT NULL REFERENCES public.campaigns(id) ON DELETE CASCADE,
  user_id     uuid NOT NULL REFERENCES public.event_staff(user_id) ON DELETE CASCADE,
  created_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (campaign_id, user_id)
);
CREATE INDEX IF NOT EXISTS campaign_staff_user_id_idx ON public.campaign_staff(user_id);

ALTER TABLE public.event_staff ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.campaign_staff ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admin full access to event_staff" ON public.event_staff;
CREATE POLICY "Admin full access to event_staff" ON public.event_staff
  FOR ALL TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS "Event staff read own profile" ON public.event_staff;
CREATE POLICY "Event staff read own profile" ON public.event_staff
  FOR SELECT TO authenticated USING (user_id = auth.uid());

DROP POLICY IF EXISTS "Admin full access to campaign_staff" ON public.campaign_staff;
CREATE POLICY "Admin full access to campaign_staff" ON public.campaign_staff
  FOR ALL TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS "Event staff read own assignments" ON public.campaign_staff;
CREATE POLICY "Event staff read own assignments" ON public.campaign_staff
  FOR SELECT TO authenticated USING (user_id = auth.uid());

-- 2. Helpers (SECURITY DEFINER so policies don't inherit campaign_staff /
--    slots / registrations RLS) ---------------------------------------------
CREATE OR REPLACE FUNCTION public.is_campaign_staff(p_campaign_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT EXISTS (
    SELECT 1 FROM campaign_staff
    WHERE campaign_id = p_campaign_id AND user_id = auth.uid()
  );
$$;

CREATE OR REPLACE FUNCTION public.staff_can_access_slot(p_slot_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT EXISTS (
    SELECT 1 FROM slots s
    JOIN campaign_staff cs ON cs.campaign_id = s.campaign_id
    WHERE s.id = p_slot_id AND cs.user_id = auth.uid()
  );
$$;

CREATE OR REPLACE FUNCTION public.staff_can_access_registration(p_registration_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT EXISTS (
    SELECT 1 FROM registrations r
    JOIN slots s ON s.id = r.slot_id
    JOIN campaign_staff cs ON cs.campaign_id = s.campaign_id
    WHERE r.id = p_registration_id AND cs.user_id = auth.uid()
  );
$$;

REVOKE ALL ON FUNCTION public.is_campaign_staff(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.staff_can_access_slot(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.staff_can_access_registration(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_campaign_staff(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.staff_can_access_slot(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.staff_can_access_registration(uuid) TO authenticated;

-- 3. Read access for assigned events only --------------------------------------
DROP POLICY IF EXISTS "Event staff read assigned campaigns" ON public.campaigns;
CREATE POLICY "Event staff read assigned campaigns" ON public.campaigns
  FOR SELECT TO authenticated USING (public.is_campaign_staff(id));

DROP POLICY IF EXISTS "Event staff read assigned slots" ON public.slots;
CREATE POLICY "Event staff read assigned slots" ON public.slots
  FOR SELECT TO authenticated USING (public.is_campaign_staff(campaign_id));

DROP POLICY IF EXISTS "Event staff read assigned registrations" ON public.registrations;
CREATE POLICY "Event staff read assigned registrations" ON public.registrations
  FOR SELECT TO authenticated USING (public.staff_can_access_slot(slot_id));

DROP POLICY IF EXISTS "Event staff read assigned attendance" ON public.attendance;
CREATE POLICY "Event staff read assigned attendance" ON public.attendance
  FOR SELECT TO authenticated USING (public.staff_can_access_registration(registration_id));

-- 4. Check-in: admins, or staff for their assigned events -----------------------
CREATE OR REPLACE FUNCTION public.admin_check_in(p_registration_id uuid)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_inserted boolean;
BEGIN
  IF NOT public.is_admin() THEN
    -- Staff get the same "Not authorized" for unknown and out-of-scope
    -- registrations, so they cannot probe other teams' events.
    IF NOT public.staff_can_access_registration(p_registration_id) THEN
      RAISE EXCEPTION 'Not authorized' USING ERRCODE = '42501';
    END IF;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM registrations WHERE id = p_registration_id) THEN
    RAISE EXCEPTION 'Registration not found' USING ERRCODE = 'P0002';
  END IF;

  INSERT INTO attendance (registration_id, checkin_time, checkout_time, is_full_attendance)
  VALUES (p_registration_id, now(), NULL, false)
  ON CONFLICT (registration_id) DO NOTHING;
  v_inserted := FOUND;

  UPDATE registrations
  SET status = 'attended', updated_at = now()
  WHERE id = p_registration_id AND status = 'registered';

  RETURN CASE WHEN v_inserted THEN 'checked_in' ELSE 'already_checked_in' END;
END;
$function$;
