-- Soft-delete ripple for enquiry_vehicles.removed_at (20260716000002).
--
-- removed_at is not a local change: every site that counts vehicles returns a
-- WRONG NUMBER rather than an error if it ignores it. The two enquiry-close
-- predicates are the worst -- if a customer removes their last open car, a
-- NOT EXISTS over (status NOT IN ('renewed','lost')) still sees the removed row
-- and the enquiry never closes.
--
-- Each function below is copied verbatim from its authoritative migration with
-- exactly one predicate changed (two for confirm_vehicle_renewal and
-- mark_vehicle_lost, which also gain a removed_at guard before mutating).
-- Sources:
--   confirm_vehicle_renewal   20260630000001:29-103
--   record_quotation          20260628000010:11-40
--   mark_vehicle_lost         20260628000010:42-85
--   enqueue_expiry_reminders  20260628000020:40-60
--   merchant_branch_leads     20260706000010:6-40
--   reassign_customer_agent   20260716000001:50-121

-- ============================================================
-- 1. confirm_vehicle_renewal(uuid, numeric, uuid)
--    verbatim from 20260630000001:29-103, plus:
--      - a removed_at guard right after the vehicle is locked FOR UPDATE
--      - AND ev.removed_at IS NULL in the enquiry-close NOT EXISTS
-- ============================================================
CREATE OR REPLACE FUNCTION confirm_vehicle_renewal(
  p_vehicle_id     uuid,
  p_premium_amount numeric,
  p_merchant_id    uuid
) RETURNS void AS $$
DECLARE
  v_vehicle    enquiry_vehicles%ROWTYPE;
  v_enquiry_id uuid;
  v_rate       numeric(5,2);
  v_gift       numeric(10,2);
  v_code       text;
BEGIN
  IF NOT is_admin() THEN
    RAISE EXCEPTION 'Only admins can confirm renewal' USING ERRCODE='42501';
  END IF;
  IF p_premium_amount IS NULL OR p_premium_amount < 0 THEN
    RAISE EXCEPTION 'Renewal premium must be zero or greater' USING ERRCODE='P0001';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM merchants WHERE id = p_merchant_id AND status = 'active') THEN
    RAISE EXCEPTION 'Partnership not found or not active' USING ERRCODE='P0001';
  END IF;

  SELECT * INTO v_vehicle FROM enquiry_vehicles WHERE id = p_vehicle_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Vehicle not found'; END IF;
  IF v_vehicle.removed_at IS NOT NULL THEN
    RAISE EXCEPTION 'This vehicle was removed by the customer' USING ERRCODE = 'P0013';
  END IF;
  IF v_vehicle.status NOT IN ('submitted','quoted') THEN
    RAISE EXCEPTION 'Vehicle is not in a confirmable state (already renewed or lost)' USING ERRCODE = 'P0002';
  END IF;
  v_enquiry_id := v_vehicle.enquiry_id;

  SELECT customer_gift_rate_pct INTO v_rate FROM system_settings LIMIT 1;
  v_rate := COALESCE(v_rate, 10);
  v_gift := round(p_premium_amount * v_rate / 100.0, 2);

  UPDATE enquiry_vehicles
     SET status                 = 'renewed',
         renewed_at             = COALESCE(renewed_at, now()),
         renewed_by             = COALESCE(renewed_by, auth.uid()),
         renewal_premium_amount = p_premium_amount,
         merchant_id            = p_merchant_id
   WHERE id = p_vehicle_id;

  -- keep the enquiry-level suggested partner in sync when unset
  UPDATE enquiries SET merchant_id = p_merchant_id, assigned_at = COALESCE(assigned_at, now())
   WHERE id = v_enquiry_id AND merchant_id IS NULL;

  -- customer gold gift (= rate% of premium). Generate a unique voucher code.
  IF NOT EXISTS (SELECT 1 FROM gifts WHERE enquiry_vehicle_id = p_vehicle_id) THEN
    LOOP
      v_code := upper(substring(replace(gen_random_uuid()::text,'-','') for 10));
      BEGIN
        INSERT INTO gifts (enquiry_vehicle_id, merchant_id, merchant_branch_id, value_amount, voucher_code, status, issued_at)
        VALUES (p_vehicle_id, p_merchant_id, NULL, v_gift, v_code, 'issued', now());
        EXIT;
      EXCEPTION WHEN unique_violation THEN
        IF EXISTS (SELECT 1 FROM gifts WHERE enquiry_vehicle_id = p_vehicle_id) THEN EXIT; END IF;
      END;
    END LOOP;
  END IF;

  -- merchant payable (= same value as the gift)
  INSERT INTO merchant_settlements (enquiry_vehicle_id, merchant_id, amount, status)
  VALUES (p_vehicle_id, p_merchant_id, v_gift, 'pending')
  ON CONFLICT (enquiry_vehicle_id) DO NOTHING;

  -- close the enquiry when no vehicles remain open
  UPDATE enquiries e SET status = 'closed'
   WHERE e.id = v_enquiry_id AND e.status <> 'closed'
     AND NOT EXISTS (
       SELECT 1 FROM enquiry_vehicles ev
        WHERE ev.enquiry_id = e.id
          AND ev.removed_at IS NULL
          AND ev.status NOT IN ('renewed','lost')
     );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

GRANT EXECUTE ON FUNCTION confirm_vehicle_renewal(uuid, numeric, uuid) TO authenticated;

-- ============================================================
-- 2. record_quotation(uuid, text)
--    verbatim from 20260628000010:11-40, plus a removed_at guard before
--    mutating. No NOT EXISTS over siblings, so removed_at is fetched
--    alongside status in the existing lock SELECT.
-- ============================================================
CREATE OR REPLACE FUNCTION record_quotation(p_vehicle_id uuid, p_external_ref text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_status     vehicle_status;
  v_removed_at timestamptz;
BEGIN
  IF NOT is_admin() THEN
    RAISE EXCEPTION 'Only admins can record a quotation' USING ERRCODE = '42501';
  END IF;

  SELECT status, removed_at INTO v_status, v_removed_at
  FROM enquiry_vehicles WHERE id = p_vehicle_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Vehicle % not found', p_vehicle_id USING ERRCODE = 'P0002';
  END IF;
  IF v_removed_at IS NOT NULL THEN
    RAISE EXCEPTION 'This vehicle was removed by the customer' USING ERRCODE = 'P0013';
  END IF;
  IF v_status NOT IN ('submitted', 'quoted') THEN
    RAISE EXCEPTION 'Vehicle % is % and cannot be quoted', p_vehicle_id, v_status USING ERRCODE = '22023';
  END IF;

  UPDATE enquiry_vehicles
     SET status                 = 'quoted',
         external_quotation_ref = p_external_ref,
         quoted_at              = now(),
         quoted_by              = auth.uid()
   WHERE id = p_vehicle_id;
END;
$$;

-- ============================================================
-- 3. mark_vehicle_lost(uuid, text)
--    verbatim from 20260628000010:42-85, plus:
--      - removed_at fetched alongside enquiry_id/status in the lock SELECT
--        and guarded before mutating
--      - AND ev.removed_at IS NULL in the enquiry-close NOT EXISTS
-- ============================================================
CREATE OR REPLACE FUNCTION mark_vehicle_lost(p_vehicle_id uuid, p_reason text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_enquiry_id uuid;
  v_status     vehicle_status;
  v_removed_at timestamptz;
BEGIN
  IF NOT is_admin() THEN
    RAISE EXCEPTION 'Only admins can mark a vehicle lost' USING ERRCODE = '42501';
  END IF;

  SELECT enquiry_id, status, removed_at INTO v_enquiry_id, v_status, v_removed_at
  FROM enquiry_vehicles WHERE id = p_vehicle_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Vehicle % not found', p_vehicle_id USING ERRCODE = 'P0002';
  END IF;
  IF v_removed_at IS NOT NULL THEN
    RAISE EXCEPTION 'This vehicle was removed by the customer' USING ERRCODE = 'P0013';
  END IF;
  IF v_status = 'renewed' THEN
    RAISE EXCEPTION 'Cannot mark a renewed vehicle as lost' USING ERRCODE = '22023';
  END IF;

  UPDATE enquiry_vehicles
     SET status      = 'lost',
         lost_at     = COALESCE(lost_at, now()),
         lost_reason = p_reason
   WHERE id = p_vehicle_id;

  -- Close the enquiry once every vehicle is terminal (renewed or lost).
  UPDATE enquiries e
     SET status = 'closed'
   WHERE e.id = v_enquiry_id
     AND e.status <> 'closed'
     AND NOT EXISTS (
       SELECT 1 FROM enquiry_vehicles ev
       WHERE ev.enquiry_id = v_enquiry_id
         AND ev.removed_at IS NULL
         AND ev.status NOT IN ('renewed', 'lost')
     );
END;
$$;

GRANT EXECUTE ON FUNCTION record_quotation(uuid, text)  TO authenticated;
GRANT EXECUTE ON FUNCTION mark_vehicle_lost(uuid, text) TO authenticated;

-- ============================================================
-- 4. enqueue_expiry_reminders()
--    verbatim from 20260628000020:40-60 (full function 20260628000020:24-67),
--    adding AND ev.removed_at IS NULL to the WHERE. Without it the system
--    emails a customer about a car they deleted.
-- ============================================================
CREATE OR REPLACE FUNCTION public.enqueue_expiry_reminders()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, cron, net, vault
AS $$
DECLARE
  v_base_url    text;
  v_service_key text;
  v_vehicle     record;
  v_count       integer := 0;
BEGIN
  SELECT decrypted_secret INTO v_base_url
    FROM vault.decrypted_secrets WHERE name = 'project_url';
  SELECT decrypted_secret INTO v_service_key
    FROM vault.decrypted_secrets WHERE name = 'service_role_key';

  IF v_base_url IS NULL OR v_service_key IS NULL THEN
    RAISE WARNING 'enqueue_expiry_reminders: Vault secrets project_url/service_role_key not set; skipping run';
    RETURN 0;
  END IF;

  FOR v_vehicle IN
    SELECT ev.id
      FROM public.enquiry_vehicles ev
     WHERE ev.insurance_expiry_date = (CURRENT_DATE + INTERVAL '30 days')::date
       AND ev.reminder_sent_at IS NULL
       AND ev.status IN ('submitted', 'quoted')
       AND ev.removed_at IS NULL
  LOOP
    PERFORM net.http_post(
      url     := v_base_url || '/functions/v1/send-expiry-reminders',
      headers := jsonb_build_object(
                   'Content-Type', 'application/json',
                   'Authorization', 'Bearer ' || v_service_key
                 ),
      body    := jsonb_build_object('vehicle_id', v_vehicle.id),
      timeout_milliseconds := 8000
    );
    v_count := v_count + 1;
  END LOOP;

  RETURN v_count;
END;
$$;

-- Lock the function down: it is invoked only by the cron job (which runs as the
-- table owner / postgres). No client role may call it.
REVOKE ALL ON FUNCTION public.enqueue_expiry_reminders() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.enqueue_expiry_reminders() FROM anon, authenticated;

-- ============================================================
-- 5. merchant_branch_leads(int DEFAULT 200)
--    verbatim from 20260706000010:6-40, adding AND v.removed_at IS NULL to
--    the WHERE, so merchant lead counts do not overstate.
-- ============================================================
CREATE OR REPLACE FUNCTION merchant_branch_leads(p_limit int DEFAULT 200)
RETURNS TABLE (
  lead_created_at timestamptz,
  branch_name text,
  staff_id text,
  customer_name text,
  car_plate text,
  insurance_expiry_date date,
  vehicle_status vehicle_status
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT e.created_at, b.name, e.staff_id, e.customer_name,
         v.car_plate, v.insurance_expiry_date, v.status
  FROM enquiries e
  JOIN merchant_branches b ON b.id = e.merchant_branch_id
  JOIN merchants m ON m.id = b.merchant_id
  JOIN enquiry_vehicles v ON v.enquiry_id = e.id
  WHERE m.user_id = auth.uid()
    AND e.branch_link_id IS NOT NULL
    AND v.removed_at IS NULL
  ORDER BY e.created_at DESC, v.car_plate
  LIMIT LEAST(GREATEST(coalesce(p_limit, 200), 1), 500);
$$;
GRANT EXECUTE ON FUNCTION merchant_branch_leads(int) TO authenticated;

-- ============================================================
-- 6. reassign_customer_agent(text, uuid)
--    verbatim from 20260716000001:50-121, adding AND v.removed_at IS NULL to
--    BOTH EXISTS clauses (the from_agent_id SELECT and the UPDATE). They stay
--    character-for-character identical to each other -- that identity is what
--    makes the audit record the agent that actually moved. Without this, a
--    customer whose only open car was removed still counts as having open
--    work, so their enquiry moves and blocks their agent's deletion forever.
-- ============================================================
CREATE OR REPLACE FUNCTION reassign_customer_agent(
  p_customer_nric text,
  p_new_agent_id uuid
)
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_nric_norm     text;
  v_from_agent_id uuid;
  v_count         int;
BEGIN
  IF NOT is_admin() THEN
    RAISE EXCEPTION 'Only admins can reassign a customer' USING ERRCODE = '42501';
  END IF;

  -- Same normalization as submit_enquiry (20260706000009). The caller passes the
  -- raw NRIC because the admin client only holds enquiries.customer_nric.
  v_nric_norm := upper(regexp_replace(coalesce(p_customer_nric, ''), '[^a-zA-Z0-9]', '', 'g'));

  -- Without this guard a blank NRIC would match every blank-NRIC customer at once
  -- and reassign all of them in one call.
  IF v_nric_norm = '' THEN
    RAISE EXCEPTION 'Customer NRIC is required' USING ERRCODE = '22023';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM agents WHERE id = p_new_agent_id AND status = 'active'
  ) THEN
    RAISE EXCEPTION 'Target agent not found or not active' USING ERRCODE = 'P0011';
  END IF;

  -- Recorded as the "from" for audit: the agent on the newest MOVING enquiry.
  -- Must use the identical EXISTS predicate as the UPDATE below -- otherwise,
  -- when a customer's enquiries are split across two agents, this could pick
  -- the newest enquiry overall (which may be closed and owned by a different
  -- agent than the one whose open enquiry is actually being reassigned) and
  -- record the wrong from_agent_id.
  SELECT e.agent_id INTO v_from_agent_id
  FROM enquiries e
  WHERE e.customer_nric_normalized = v_nric_norm
    AND EXISTS (
      SELECT 1 FROM enquiry_vehicles v
      WHERE v.enquiry_id = e.id
        AND v.removed_at IS NULL
        AND v.status IN ('submitted', 'quoted')
    )
  ORDER BY e.created_at DESC
  LIMIT 1;

  UPDATE enquiries e
  SET agent_id = p_new_agent_id,
      updated_at = now()
  WHERE e.customer_nric_normalized = v_nric_norm
    AND EXISTS (
      SELECT 1 FROM enquiry_vehicles v
      WHERE v.enquiry_id = e.id
        AND v.removed_at IS NULL
        AND v.status IN ('submitted', 'quoted')
    );

  GET DIAGNOSTICS v_count = ROW_COUNT;

  INSERT INTO customer_agent_reassignments (
    nric_normalized, from_agent_id, to_agent_id, enquiry_count, reassigned_by
  ) VALUES (
    v_nric_norm, v_from_agent_id, p_new_agent_id, v_count, auth.uid()
  );

  RETURN v_count;
END;
$$;

GRANT EXECUTE ON FUNCTION reassign_customer_agent(text, uuid) TO authenticated;
