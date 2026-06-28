-- ============================================================
-- Merchant Partnership — Phase 2: public enquiry capture
-- get_branch_link_context (public display fields) +
-- submit_enquiry (header + N vehicles, atomic).
-- Both SECURITY DEFINER, granted to anon. No broad anon SELECT
-- on merchants / branches / enquiries (PDPA): the form reads
-- only what these two functions return + active insurance_products.
-- ============================================================

-- Resolve an ACTIVE branch link to its public display fields only.
-- Returns 0 rows for an unknown or deactivated link (frontend treats
-- empty as "invalid / inactive link").
CREATE OR REPLACE FUNCTION get_branch_link_context(p_link_code text)
RETURNS TABLE (
  merchant_name     text,
  merchant_logo_url text,
  branch_name       text
) AS $$
  SELECT m.name, m.logo_url, b.name
  FROM branch_links bl
  JOIN merchant_branches b ON b.id = bl.merchant_branch_id
  JOIN merchants m         ON m.id = b.merchant_id
  WHERE bl.link_code = p_link_code
    AND bl.is_active = true
    AND b.status = 'active'
    AND m.status = 'active';
$$ LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public;

-- Public enquiry submission. Atomic: the whole enquiry rolls back if any
-- vehicle is a duplicate. p_vehicles is a jsonb array of objects:
--   { "car_plate": text, "expiry_date": "YYYY-MM-DD", "insurance_product_id": uuid }
CREATE OR REPLACE FUNCTION submit_enquiry(
  p_link_code      text,
  p_customer_name  text,
  p_customer_nric  text,
  p_customer_phone text,
  p_customer_email text,
  p_vehicles       jsonb
) RETURNS uuid AS $$
DECLARE
  v_link       branch_links%ROWTYPE;
  v_enquiry_id uuid;
  v_nric_norm  text;
  v_phone_norm text;
  v_digits     text;
  v_vehicle    jsonb;
BEGIN
  -- 1. Resolve the branch link (must be active). FOR UPDATE serializes
  --    concurrent submits on the same link and snapshots agent_id cleanly.
  SELECT * INTO v_link
  FROM branch_links
  WHERE link_code = p_link_code AND is_active = true
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Link not found or inactive' USING ERRCODE = 'P0001';
  END IF;

  -- Branch + merchant must be approved (active), not just the link.
  IF NOT EXISTS (
    SELECT 1 FROM merchant_branches b
    JOIN merchants m ON m.id = b.merchant_id
    WHERE b.id = v_link.merchant_branch_id
      AND b.status = 'active' AND m.status = 'active'
  ) THEN
    RAISE EXCEPTION 'Link not found or inactive' USING ERRCODE = 'P0001';
  END IF;

  -- 2. Require at least one vehicle.
  IF p_vehicles IS NULL
     OR jsonb_typeof(p_vehicles) <> 'array'
     OR jsonb_array_length(p_vehicles) = 0 THEN
    RAISE EXCEPTION 'At least one vehicle is required' USING ERRCODE = 'P0006';
  END IF;

  -- 3. Normalize NRIC: strip non-alphanumerics + uppercase (mirrors normalizeNric()).
  v_nric_norm := upper(regexp_replace(coalesce(p_customer_nric, ''), '[^a-zA-Z0-9]', '', 'g'));

  -- 4. Normalize phone to canonical Malaysian MSISDN "60XXXXXXXXX"
  --    (mirrors toMalaysianMsisdn()).
  v_digits := regexp_replace(coalesce(p_customer_phone, ''), '\D', '', 'g');
  IF left(v_digits, 2) = '60' THEN
    v_phone_norm := v_digits;
  ELSE
    v_digits := regexp_replace(v_digits, '^0+', '');
    v_phone_norm := CASE WHEN v_digits = '' THEN '' ELSE '60' || v_digits END;
  END IF;

  -- 5. Insert the enquiry header. Snapshot branch + agent from the link.
  INSERT INTO enquiries (
    branch_link_id, merchant_branch_id, agent_id,
    customer_name,
    customer_nric, customer_nric_normalized,
    customer_phone, customer_phone_normalized,
    customer_email,
    status
  ) VALUES (
    v_link.id, v_link.merchant_branch_id, v_link.agent_id,
    p_customer_name,
    p_customer_nric, v_nric_norm,
    p_customer_phone, v_phone_norm,
    NULLIF(trim(coalesce(p_customer_email, '')), ''),
    'open'
  ) RETURNING id INTO v_enquiry_id;

  -- 6. Insert each vehicle. Denormalize merchant_branch_id for the dedup index;
  --    normalize plate the same way as NRIC (strip + uppercase). Catch the
  --    per-branch unique violation and re-raise as a friendly P0007 — this
  --    aborts the whole transaction so no partial enquiry is left behind.
  FOR v_vehicle IN SELECT * FROM jsonb_array_elements(p_vehicles)
  LOOP
    BEGIN
      INSERT INTO enquiry_vehicles (
        enquiry_id, merchant_branch_id,
        car_plate, car_plate_normalized,
        insurance_expiry_date, insurance_product_id,
        status
      ) VALUES (
        v_enquiry_id, v_link.merchant_branch_id,
        v_vehicle->>'car_plate',
        upper(regexp_replace(coalesce(v_vehicle->>'car_plate', ''), '[^a-zA-Z0-9]', '', 'g')),
        (v_vehicle->>'expiry_date')::date,
        (v_vehicle->>'insurance_product_id')::uuid,
        'submitted'
      );
    EXCEPTION WHEN unique_violation THEN
      RAISE EXCEPTION 'This vehicle (plate %, expiry %) has already been submitted at this branch.',
        v_vehicle->>'car_plate', v_vehicle->>'expiry_date'
        USING ERRCODE = 'P0007';
    END;
  END LOOP;

  RETURN v_enquiry_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- Anon may call both functions (and only these — the underlying tables stay RLS-locked).
GRANT EXECUTE ON FUNCTION get_branch_link_context(text) TO anon;
GRANT EXECUTE ON FUNCTION submit_enquiry(text, text, text, text, text, jsonb) TO anon;
