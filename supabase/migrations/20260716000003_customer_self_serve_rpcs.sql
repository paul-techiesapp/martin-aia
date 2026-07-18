-- The anon surface for the customer self-serve car list.
--
-- enquiries and enquiry_vehicles have no anon RLS policies by design
-- (20260627000002 states it outright), so these SECURITY DEFINER functions are
-- the ONLY way an unauthenticated customer touches their data. Every one
-- resolves the token first and refuses a revoked one.
--
-- NRIC is masked HERE rather than in the page: whatever these functions return
-- lands in the network response regardless of what the UI chooses to render.
-- Phone and email are never returned at all.

-- Resolve a token to its customer, or NULL. Revoked tokens resolve to NULL, so
-- every caller below refuses them identically.
CREATE OR REPLACE FUNCTION customer_token_nric(p_token text)
RETURNS text
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT t.nric_normalized FROM customer_portal_tokens t
  WHERE t.token = p_token AND t.revoked_at IS NULL;
$$;
-- Internal helper for the functions below. It returns the FULL unmasked NRIC,
-- which get_customer_cars deliberately masks — so anon must never reach it.
-- Postgres grants EXECUTE to PUBLIC by default, and anon inherits PUBLIC — so
-- the absence of a GRANT is NOT enough to keep anon out. Revoke explicitly:
-- this helper returns the FULL unmasked NRIC, which get_customer_cars masks.
REVOKE EXECUTE ON FUNCTION customer_token_nric(text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION customer_token_nric(text) FROM anon;

CREATE OR REPLACE FUNCTION get_customer_cars(p_token text)
RETURNS TABLE (customer_name text, nric_masked text, vehicles jsonb)
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
DECLARE
  v_nric_norm text := customer_token_nric(p_token);
BEGIN
  IF v_nric_norm IS NULL THEN
    RAISE EXCEPTION 'This link is no longer valid' USING ERRCODE = 'P0012';
  END IF;

  RETURN QUERY
  SELECT
    -- Newest enquiry wins for the display name.
    (SELECT e.customer_name FROM enquiries e
      WHERE e.customer_nric_normalized = v_nric_norm
      ORDER BY e.created_at DESC LIMIT 1),
    -- Last 4 only. A leaked link must not disclose a full IC.
    ('•••• ' || right(v_nric_norm, 4)),
    COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
               'id', v.id,
               'car_plate', v.car_plate,
               'insurance_expiry_date', v.insurance_expiry_date,
               'status', v.status,
               'road_tax_renewal', v.road_tax_renewal
             ) ORDER BY v.insurance_expiry_date, v.car_plate)
      FROM enquiry_vehicles v
      JOIN enquiries e ON e.id = v.enquiry_id
      WHERE e.customer_nric_normalized = v_nric_norm
        AND v.removed_at IS NULL
    ), '[]'::jsonb);
END;
$$;

GRANT EXECUTE ON FUNCTION get_customer_cars(text) TO anon;

-- Adds a car for the token's customer.
--
-- Landing rule: the newest OPEN enquiry, else a new enquiry inheriting the
-- customer's newest prior enquiry's agent/merchant/branch. Reopening a closed
-- enquiry was rejected: it would disturb settled gift/settlement reporting.
--
-- The NRIC 1-month dedup window (P0009) deliberately does NOT apply here. That
-- guard lives inside submit_enquiry and exists to stop repeat gold-form
-- REGISTRATIONS. An existing customer adding a second car is not a new
-- registration. This is intentional, not an oversight.
CREATE OR REPLACE FUNCTION customer_add_vehicle(
  p_token text,
  p_car_plate text,
  p_insurance_expiry_date date,
  p_road_tax_renewal boolean
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_nric_norm  text := customer_token_nric(p_token);
  v_enquiry_id uuid;
  v_prior      enquiries%ROWTYPE;
  v_vehicle_id uuid;
BEGIN
  IF v_nric_norm IS NULL THEN
    RAISE EXCEPTION 'This link is no longer valid' USING ERRCODE = 'P0012';
  END IF;

  IF coalesce(btrim(p_car_plate), '') = '' THEN
    RAISE EXCEPTION 'Car plate is required' USING ERRCODE = '22023';
  END IF;

  IF p_insurance_expiry_date IS NULL THEN
    RAISE EXCEPTION 'Insurance expiry date is required' USING ERRCODE = '22023';
  END IF;

  SELECT e.id INTO v_enquiry_id
  FROM enquiries e
  WHERE e.customer_nric_normalized = v_nric_norm
    AND e.status = 'open'
  ORDER BY e.created_at DESC
  LIMIT 1;

  IF v_enquiry_id IS NULL THEN
    SELECT * INTO v_prior
    FROM enquiries e
    WHERE e.customer_nric_normalized = v_nric_norm
    ORDER BY e.created_at DESC
    LIMIT 1;

    IF v_prior.id IS NULL THEN
      -- A token always derives from an enquiry, so this is unreachable in
      -- practice; refuse rather than invent a customer with no history.
      RAISE EXCEPTION 'This link is no longer valid' USING ERRCODE = 'P0012';
    END IF;

    INSERT INTO enquiries (
      agent_id, merchant_id, branch_link_id, merchant_branch_id,
      customer_name, customer_nric, customer_nric_normalized,
      customer_phone, customer_phone_normalized, customer_email, status
    ) VALUES (
      v_prior.agent_id, v_prior.merchant_id, v_prior.branch_link_id, v_prior.merchant_branch_id,
      v_prior.customer_name, v_prior.customer_nric, v_prior.customer_nric_normalized,
      v_prior.customer_phone, v_prior.customer_phone_normalized, v_prior.customer_email, 'open'
    ) RETURNING id INTO v_enquiry_id;
  END IF;

  INSERT INTO enquiry_vehicles (
    enquiry_id, merchant_branch_id, merchant_id, car_plate, car_plate_normalized,
    insurance_expiry_date, road_tax_renewal, status
  )
  SELECT
    v_enquiry_id, e.merchant_branch_id, e.merchant_id, p_car_plate,
    -- Identical expression to submit_enquiry (20260706000009:64).
    upper(regexp_replace(coalesce(p_car_plate, ''), '[^a-zA-Z0-9]', '', 'g')),
    p_insurance_expiry_date, coalesce(p_road_tax_renewal, false), 'submitted'
  FROM enquiries e WHERE e.id = v_enquiry_id
  RETURNING id INTO v_vehicle_id;

  RETURN v_vehicle_id;
END;
$$;

GRANT EXECUTE ON FUNCTION customer_add_vehicle(text, text, date, boolean) TO anon;

-- Soft-removes a car. Refuses renewed/lost: those have a gifts voucher and a
-- merchant_settlements row attached. The enquiry-belongs-to-this-token check is
-- what stops a token holder removing someone else's car by guessing an id.
CREATE OR REPLACE FUNCTION customer_remove_vehicle(p_token text, p_vehicle_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_nric_norm  text := customer_token_nric(p_token);
  v_status     vehicle_status;
  v_enquiry_id uuid;
BEGIN
  IF v_nric_norm IS NULL THEN
    RAISE EXCEPTION 'This link is no longer valid' USING ERRCODE = 'P0012';
  END IF;

  SELECT v.status, v.enquiry_id INTO v_status, v_enquiry_id
  FROM enquiry_vehicles v
  JOIN enquiries e ON e.id = v.enquiry_id
  WHERE v.id = p_vehicle_id
    AND e.customer_nric_normalized = v_nric_norm
    AND v.removed_at IS NULL
  FOR UPDATE OF v;

  -- Same code as a bad token: never disclose that someone else's vehicle id exists.
  IF v_enquiry_id IS NULL THEN
    RAISE EXCEPTION 'This link is no longer valid' USING ERRCODE = 'P0012';
  END IF;

  IF v_status IN ('renewed', 'lost') THEN
    RAISE EXCEPTION 'This car can no longer be removed' USING ERRCODE = 'P0013';
  END IF;

  UPDATE enquiry_vehicles
  SET removed_at = now(), removed_by_customer = true, updated_at = now()
  WHERE id = p_vehicle_id;

  -- Close the enquiry when nothing live and non-terminal is left.
  UPDATE enquiries e SET status = 'closed', updated_at = now()
  WHERE e.id = v_enquiry_id
    AND e.status = 'open'
    AND NOT EXISTS (
      SELECT 1 FROM enquiry_vehicles ev
      WHERE ev.enquiry_id = e.id
        AND ev.removed_at IS NULL
        AND ev.status NOT IN ('renewed', 'lost')
    );
END;
$$;

GRANT EXECUTE ON FUNCTION customer_remove_vehicle(text, uuid) TO anon;
