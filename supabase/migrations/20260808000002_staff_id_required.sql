-- Round 8 item 3: partners may make the referring Staff ID mandatory for
-- leads submitted through their branch link. Client-side validation alone is
-- bypassable by calling this RPC directly, so the rule lives here too.
--
-- submit_enquiry body copied verbatim from 20260808000001_source_locked_leads
-- (which itself carries the per-car merchant_id seeding from that migration)
-- with ONE addition: a guard immediately after the branch-path lookup that
-- raises P0020 when the resolved branch merchant requires a Staff ID and
-- none was supplied. Branch path only -- agent links never show the field,
-- and v_merchant_id is NULL on that path so the EXISTS naturally excludes it.
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

  -- Round 8 item 3: partners may make the referring Staff ID mandatory.
  -- Client-side validation alone is bypassable by calling this RPC directly,
  -- so the rule lives here. Branch path only -- agent links never show the
  -- field.
  IF EXISTS (
    SELECT 1 FROM merchants m
    WHERE m.id = v_merchant_id
      AND coalesce((m.form_settings->>'staff_id_required')::boolean, false)
  ) AND NULLIF(trim(coalesce(p_staff_id,'')),'') IS NULL THEN
    RAISE EXCEPTION 'Staff ID is required for this partner' USING ERRCODE='P0020';
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
