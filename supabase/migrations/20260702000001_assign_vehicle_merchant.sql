-- Item 1 (feedback round 2): agent assigns a partner PER CAR
-- (enquiry_vehicles.merchant_id) instead of per enquiry. Mirrors the guards of
-- assign_enquiry_merchant but keyed on the vehicle's parent enquiry ownership.
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
  IF NOT EXISTS (SELECT 1 FROM merchants WHERE id = p_merchant_id AND status = 'active') THEN
    RAISE EXCEPTION 'Partnership not found or not active' USING ERRCODE='P0001';
  END IF;
  UPDATE enquiry_vehicles ev
     SET merchant_id = p_merchant_id
    FROM enquiries e
   WHERE ev.id = p_vehicle_id
     AND e.id = ev.enquiry_id
     AND e.agent_id = v_agent_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Vehicle not found or not yours' USING ERRCODE='42501';
  END IF;
END;
$$;
GRANT EXECUTE ON FUNCTION assign_vehicle_merchant(uuid, uuid) TO authenticated;
