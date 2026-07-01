-- Unified resolver for the public form (anon): agent link OR branch link.
CREATE OR REPLACE FUNCTION get_enquiry_context(p_link_code text)
RETURNS TABLE (kind text, agent_name text, merchant_name text, merchant_logo_url text, branch_name text) AS $$
  SELECT 'agent'::text, a.name, NULL::text, NULL::text, NULL::text
  FROM agents a WHERE a.enquiry_link_code = p_link_code AND a.status = 'active'
  UNION ALL
  SELECT 'branch'::text, NULL::text, m.name, m.logo_url, b.name
  FROM branch_links bl
  JOIN merchant_branches b ON b.id = bl.merchant_branch_id
  JOIN merchants m ON m.id = b.merchant_id
  WHERE bl.link_code = p_link_code AND bl.is_active = true
    AND b.status = 'active' AND m.status = 'active'
  LIMIT 1;
$$ LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public;
GRANT EXECUTE ON FUNCTION get_enquiry_context(text) TO anon;

-- Unified submit (anon): resolve agent link first, else branch link.
CREATE OR REPLACE FUNCTION submit_enquiry(
  p_link_code text, p_customer_name text, p_customer_nric text,
  p_customer_phone text, p_customer_email text, p_vehicles jsonb) RETURNS uuid AS $$
DECLARE
  v_agent_id uuid; v_branch_link_id uuid; v_merchant_branch_id uuid; v_merchant_id uuid;
  v_enquiry_id uuid; v_nric_norm text; v_phone_norm text; v_digits text; v_vehicle jsonb;
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
  v_digits := regexp_replace(coalesce(p_customer_phone,''),'\D','','g');
  IF left(v_digits,2)='60' THEN v_phone_norm := v_digits;
  ELSE v_digits := regexp_replace(v_digits,'^0+',''); v_phone_norm := CASE WHEN v_digits='' THEN '' ELSE '60'||v_digits END; END IF;

  INSERT INTO enquiries (branch_link_id, merchant_branch_id, merchant_id, agent_id,
    customer_name, customer_nric, customer_nric_normalized,
    customer_phone, customer_phone_normalized, customer_email, status, assigned_at, assigned_by)
  VALUES (v_branch_link_id, v_merchant_branch_id, v_merchant_id, v_agent_id,
    p_customer_name, p_customer_nric, v_nric_norm, p_customer_phone, v_phone_norm,
    NULLIF(trim(coalesce(p_customer_email,'')),''), 'open',
    CASE WHEN v_merchant_id IS NOT NULL THEN now() ELSE NULL END, NULL)
  RETURNING id INTO v_enquiry_id;

  FOR v_vehicle IN SELECT * FROM jsonb_array_elements(p_vehicles) LOOP
    INSERT INTO enquiry_vehicles (enquiry_id, merchant_branch_id, car_plate, car_plate_normalized, insurance_expiry_date, insurance_product_id, status)
    VALUES (v_enquiry_id, v_merchant_branch_id, v_vehicle->>'car_plate',
      upper(regexp_replace(coalesce(v_vehicle->>'car_plate',''),'[^a-zA-Z0-9]','','g')),
      (v_vehicle->>'expiry_date')::date, NULLIF(v_vehicle->>'insurance_product_id','')::uuid, 'submitted');
  END LOOP;

  IF v_agent_id IS NOT NULL THEN PERFORM notify_agent_enquiry(v_enquiry_id); END IF;
  RETURN v_enquiry_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions, net, vault;
GRANT EXECUTE ON FUNCTION submit_enquiry(text,text,text,text,text,jsonb) TO anon;
