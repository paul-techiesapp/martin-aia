-- Round 8 item 1: a lead submitted through a partner BRANCH link belongs to
-- that partner from the moment it arrives.
--
-- Before: submit_enquiry recorded the source on the ENQUIRY
-- (merchant_id / merchant_branch_id) but left enquiry_vehicles.merchant_id
-- NULL, and the agent portal renders only the per-car partner. A lead from
-- Poh Kong Shah Alam therefore looked partner-less, and after a customer
-- reassignment the receiving agent had no way at all to see where it came
-- from. Nothing was ever deleted -- reassign_customer_agent only touches
-- enquiries.agent_id.
--
-- After: the car's merchant_id is seeded from the branch's merchant at
-- submit, and only unit viewers (Unit Manager / Unit Admin deputies) may
-- change it. Admins keep their existing path: confirm_vehicle_renewal takes
-- p_merchant_id explicitly and overwrites this column, so seeding it early
-- cannot misdirect a gift or a settlement.

-- ---------------------------------------------------------------------------
-- submit_enquiry: body copied verbatim from 20260706000009 with ONE change --
-- the enquiry_vehicles INSERT now writes merchant_id (NULL on the agent path,
-- the branch's merchant on the branch path).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION submit_enquiry(
  p_link_code text, p_customer_name text, p_customer_nric text,
  p_customer_phone text, p_customer_email text, p_vehicles jsonb,
  p_staff_id text DEFAULT NULL) RETURNS uuid AS $$
DECLARE
  v_agent_id uuid; v_branch_link_id uuid; v_merchant_branch_id uuid; v_merchant_id uuid;
  v_enquiry_id uuid; v_vehicle_id uuid; v_nric_norm text; v_phone_norm text; v_digits text;
  v_vehicle jsonb; v_att jsonb;
BEGIN
  SELECT id INTO v_agent_id FROM agents WHERE enquiry_link_code = p_link_code AND status='active';
  IF FOUND THEN
    v_branch_link_id := NULL; v_merchant_branch_id := NULL; v_merchant_id := NULL;  -- agent path
  ELSE
    SELECT bl.id, bl.merchant_branch_id, bl.agent_id, b.merchant_id
      INTO v_branch_link_id, v_merchant_branch_id, v_agent_id, v_merchant_id
    FROM branch_links bl
    JOIN merchant_branches b ON b.id = bl.merchant_branch_id
    JOIN merchants m ON m.id = b.merchant_id
    WHERE bl.link_code = p_link_code AND bl.is_active = true
      AND b.status='active' AND m.status='active';
    IF NOT FOUND THEN RAISE EXCEPTION 'Link not found or inactive' USING ERRCODE='P0001'; END IF;
  END IF;

  IF p_vehicles IS NULL OR jsonb_typeof(p_vehicles)<>'array' OR jsonb_array_length(p_vehicles)=0 THEN
    RAISE EXCEPTION 'At least one vehicle is required' USING ERRCODE='P0006'; END IF;

  v_nric_norm := upper(regexp_replace(coalesce(p_customer_nric,''),'[^a-zA-Z0-9]','','g'));

  -- One gold-form registration per IC per month (lock releases after 1 month).
  IF v_nric_norm <> '' AND EXISTS (
    SELECT 1 FROM enquiries
    WHERE customer_nric_normalized = v_nric_norm
      AND created_at >= now() - interval '1 month'
  ) THEN
    RAISE EXCEPTION 'This IC has already been registered' USING ERRCODE='P0009';
  END IF;

  v_digits := regexp_replace(coalesce(p_customer_phone,''),'\D','','g');
  IF left(v_digits,2)='60' THEN v_phone_norm := v_digits;
  ELSE v_digits := regexp_replace(v_digits,'^0+',''); v_phone_norm := CASE WHEN v_digits='' THEN '' ELSE '60'||v_digits END; END IF;

  INSERT INTO enquiries (branch_link_id, merchant_branch_id, merchant_id, agent_id,
    customer_name, customer_nric, customer_nric_normalized,
    customer_phone, customer_phone_normalized, customer_email, status, assigned_at, assigned_by, staff_id)
  VALUES (v_branch_link_id, v_merchant_branch_id, v_merchant_id, v_agent_id,
    p_customer_name, p_customer_nric, v_nric_norm, p_customer_phone, v_phone_norm,
    NULLIF(trim(coalesce(p_customer_email,'')),''), 'open',
    CASE WHEN v_merchant_id IS NOT NULL THEN now() ELSE NULL END, NULL,
    NULLIF(trim(coalesce(p_staff_id,'')),''))
  RETURNING id INTO v_enquiry_id;

  FOR v_vehicle IN SELECT * FROM jsonb_array_elements(p_vehicles) LOOP
    -- CHANGED (round 8): merchant_id seeded from the source branch's merchant.
    INSERT INTO enquiry_vehicles (enquiry_id, merchant_branch_id, merchant_id, car_plate, car_plate_normalized, insurance_expiry_date, insurance_product_id, road_tax_renewal, status)
    VALUES (v_enquiry_id, v_merchant_branch_id, v_merchant_id, v_vehicle->>'car_plate',
      upper(regexp_replace(coalesce(v_vehicle->>'car_plate',''),'[^a-zA-Z0-9]','','g')),
      (v_vehicle->>'expiry_date')::date, NULLIF(v_vehicle->>'insurance_product_id','')::uuid,
      COALESCE((v_vehicle->>'road_tax_renewal')::boolean, false), 'submitted')
    RETURNING id INTO v_vehicle_id;

    -- per-vehicle attachments (optional)
    IF v_vehicle ? 'attachments' AND jsonb_typeof(v_vehicle->'attachments') = 'array' THEN
      FOR v_att IN SELECT * FROM jsonb_array_elements(v_vehicle->'attachments') LOOP
        IF coalesce(v_att->>'storage_path','') <> '' THEN
          INSERT INTO enquiry_attachments (enquiry_id, enquiry_vehicle_id, storage_path, file_name, content_type, size_bytes)
          VALUES (v_enquiry_id, v_vehicle_id, v_att->>'storage_path',
            coalesce(NULLIF(v_att->>'file_name',''),'document'),
            v_att->>'content_type', NULLIF(v_att->>'size_bytes','')::bigint)
          ON CONFLICT (storage_path) DO NOTHING;
        END IF;
      END LOOP;
    END IF;
  END LOOP;

  PERFORM notify_agent_enquiry(v_enquiry_id);
  RETURN v_enquiry_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions, net, vault;
GRANT EXECUTE ON FUNCTION submit_enquiry(text,text,text,text,text,jsonb,text) TO anon;

-- ---------------------------------------------------------------------------
-- assign_vehicle_merchant: same UPDATE and ownership rules as 20260711000001,
-- plus two guards.
--   P0021 -- the enquiry came from a partner branch and the caller is not a
--            unit viewer, so the partner is locked.
--   The availability check is skipped when the target IS the enquiry's own
--   source merchant: a non-master source partner is not in any receiving
--   agent's allowed set, so without this a unit viewer who moved a car off it
--   could never move it back.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION assign_vehicle_merchant(p_vehicle_id uuid, p_merchant_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_agent_id           uuid := get_agent_id();
  v_has_source         boolean;
  v_source_merchant_id uuid;
BEGIN
  IF v_agent_id IS NULL THEN
    RAISE EXCEPTION 'Not an agent' USING ERRCODE='42501';
  END IF;

  SELECT e.merchant_branch_id IS NOT NULL, e.merchant_id
    INTO v_has_source, v_source_merchant_id
  FROM enquiry_vehicles ev
  JOIN enquiries e ON e.id = ev.enquiry_id
  WHERE ev.id = p_vehicle_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Vehicle not found or not yours' USING ERRCODE='42501';
  END IF;

  IF v_has_source AND NOT is_unit_viewer() THEN
    RAISE EXCEPTION 'This lead is locked to the partner it came from' USING ERRCODE='P0021';
  END IF;

  IF (v_source_merchant_id IS NULL OR p_merchant_id <> v_source_merchant_id)
     AND NOT merchant_available_to_agent(p_merchant_id, v_agent_id) THEN
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

-- ---------------------------------------------------------------------------
-- One-time backfill: OPEN cars on branch-sourced enquiries inherit the
-- enquiry's partner. Renewed and lost cars are deliberately excluded -- their
-- partner was decided at confirmation time and gift/settlement rows already
-- point at it.
-- ---------------------------------------------------------------------------
UPDATE enquiry_vehicles ev
   SET merchant_id = e.merchant_id
  FROM enquiries e
 WHERE e.id = ev.enquiry_id
   AND ev.merchant_id IS NULL
   AND ev.removed_at IS NULL
   AND ev.status IN ('submitted','quoted')
   AND e.merchant_branch_id IS NOT NULL
   AND e.merchant_id IS NOT NULL;
