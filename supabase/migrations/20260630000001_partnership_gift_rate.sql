-- ============================================================
-- Partnership feedback: remove gift pool / merchant-share split.
-- Customer gift = standard rate (default 10%) of the car-insurance renewal
-- premium; the merchant settlement (payable RACC owes the partner) equals
-- that same gift value. The partner is confirmed PER CAR at renewal, and the
-- renewal premium is captured at confirmation time.
-- ============================================================

-- 1. Per-vehicle columns -------------------------------------------------
ALTER TABLE enquiry_vehicles
  ADD COLUMN IF NOT EXISTS renewal_premium_amount NUMERIC(12,2),
  ADD COLUMN IF NOT EXISTS merchant_id            UUID REFERENCES merchants(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS road_tax_renewal       BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS quote_requested_at     TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_enquiry_vehicles_merchant ON enquiry_vehicles(merchant_id);

-- 2. Global customer gift rate (percent of renewal premium) --------------
ALTER TABLE system_settings
  ADD COLUMN IF NOT EXISTS customer_gift_rate_pct NUMERIC(5,2) NOT NULL DEFAULT 10
    CHECK (customer_gift_rate_pct >= 0 AND customer_gift_rate_pct <= 100);

-- 3. Rewrite confirm_vehicle_renewal -------------------------------------
--    New signature takes the renewal premium + the per-car partner. Gift and
--    merchant settlement are BOTH = round(premium * rate / 100, 2).
--    Drop the old single-arg overload so only one definition exists.
DROP FUNCTION IF EXISTS confirm_vehicle_renewal(uuid);

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
  IF v_vehicle.status = 'lost' THEN RAISE EXCEPTION 'Vehicle is lost'; END IF;
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
        WHERE ev.enquiry_id = e.id AND ev.status NOT IN ('renewed','lost')
     );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

GRANT EXECUTE ON FUNCTION confirm_vehicle_renewal(uuid, numeric, uuid) TO authenticated;
