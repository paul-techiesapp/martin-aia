-- Agent-side "mark as renewed": rolls the expiry forward one year and re-arms
-- the reminder. Date-only by design (client decision 2026-07-21): the gold
-- gift stays merchant-confirmed via confirm_vehicle_renewal, so this must NOT
-- change status/renewed_at/renewed_by or the merchant could no longer confirm.

ALTER TABLE enquiry_vehicles
  ADD COLUMN IF NOT EXISTS marked_renewed_at timestamptz,
  ADD COLUMN IF NOT EXISTS marked_renewed_by uuid REFERENCES agents(id) ON DELETE SET NULL;

CREATE OR REPLACE FUNCTION mark_vehicle_renewed(p_vehicle_id uuid)
RETURNS date
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_vehicle enquiry_vehicles%ROWTYPE;
  v_enquiry_agent uuid;
  v_new_expiry date;
BEGIN
  SELECT * INTO v_vehicle FROM enquiry_vehicles WHERE id = p_vehicle_id FOR UPDATE;
  IF NOT FOUND OR v_vehicle.removed_at IS NOT NULL THEN
    RAISE EXCEPTION 'Vehicle not found or removed' USING ERRCODE = 'P0014';
  END IF;
  IF v_vehicle.status NOT IN ('submitted', 'quoted') THEN
    RAISE EXCEPTION 'Vehicle is not in a renewable state' USING ERRCODE = 'P0015';
  END IF;
  IF v_vehicle.marked_renewed_at IS NOT NULL
     AND v_vehicle.marked_renewed_at > now() - INTERVAL '6 months' THEN
    RAISE EXCEPTION 'Vehicle was already marked renewed recently' USING ERRCODE = 'P0019';
  END IF;

  SELECT agent_id INTO v_enquiry_agent FROM enquiries WHERE id = v_vehicle.enquiry_id;

  -- Non-agent authenticated callers (merchant/partner logins) have no business
  -- here; also guards the OR-chain below against NULL from get_agent_id().
  IF NOT is_admin() AND get_agent_id() IS NULL THEN
    RAISE EXCEPTION 'Not allowed to mark this vehicle renewed' USING ERRCODE = '42501';
  END IF;

  IF NOT COALESCE((
    is_admin()
    OR (v_enquiry_agent IS NOT NULL AND v_enquiry_agent = get_agent_id())
    OR (v_enquiry_agent IS NOT NULL AND is_unit_viewer()
        AND v_enquiry_agent IN (SELECT unit_member_ids()))
  ), false) THEN
    RAISE EXCEPTION 'Not allowed to mark this vehicle renewed' USING ERRCODE = '42501';
  END IF;

  v_new_expiry := (v_vehicle.insurance_expiry_date + INTERVAL '1 year')::date;

  UPDATE enquiry_vehicles
     SET insurance_expiry_date = v_new_expiry,
         reminder_sent_at = NULL,          -- re-arm next year's reminder
         marked_renewed_at = now(),
         marked_renewed_by = get_agent_id(),
         updated_at = now()
   WHERE id = p_vehicle_id;

  RETURN v_new_expiry;
END;
$$;

REVOKE EXECUTE ON FUNCTION mark_vehicle_renewed(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION mark_vehicle_renewed(uuid) TO authenticated;
