-- Round 4 item 1: an agent may only assign MASTER partners (created_by_agent_id
-- IS NULL) or partners they proposed themselves. Round 4 item 10b: unit viewers
-- (unit admin/boss + is_unit_manager deputies) may act on any unit member's
-- enquiry, not just their own.
CREATE OR REPLACE FUNCTION assign_vehicle_merchant(p_vehicle_id uuid, p_merchant_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_agent_id uuid := get_agent_id();
BEGIN
  IF v_agent_id IS NULL THEN
    RAISE EXCEPTION 'Not an agent' USING ERRCODE='42501';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM merchants
    WHERE id = p_merchant_id AND status = 'active'
      AND (created_by_agent_id IS NULL OR created_by_agent_id = v_agent_id)
  ) THEN
    RAISE EXCEPTION 'Partnership not found, not active, or not assignable by you' USING ERRCODE='P0008';
  END IF;
  UPDATE enquiry_vehicles ev
     SET merchant_id = p_merchant_id
    FROM enquiries e
   WHERE ev.id = p_vehicle_id
     AND e.id = ev.enquiry_id
     AND (e.agent_id = v_agent_id OR e.agent_id IN (SELECT unit_member_ids()));
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Vehicle not found or not yours' USING ERRCODE='42501';
  END IF;
END;
$$;
GRANT EXECUTE ON FUNCTION assign_vehicle_merchant(uuid, uuid) TO authenticated;
