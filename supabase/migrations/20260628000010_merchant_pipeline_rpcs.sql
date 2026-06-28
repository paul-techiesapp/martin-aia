-- ============================================================
-- Merchant Partnership — Phase 3 admin pipeline RPCs
--
-- Six admin-only SECURITY DEFINER functions drive the per-vehicle
-- lifecycle (submitted -> quoted -> renewed | lost) and the payout
-- ledgers minted on a confirmed renewal. All guard with is_admin()
-- and mirror the existing set_reward_status pattern.
-- ============================================================

-- record_quotation: submitted|quoted -> quoted, stamp the external ref ----
CREATE OR REPLACE FUNCTION record_quotation(p_vehicle_id uuid, p_external_ref text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_status vehicle_status;
BEGIN
  IF NOT is_admin() THEN
    RAISE EXCEPTION 'Only admins can record a quotation' USING ERRCODE = '42501';
  END IF;

  SELECT status INTO v_status FROM enquiry_vehicles WHERE id = p_vehicle_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Vehicle % not found', p_vehicle_id USING ERRCODE = 'P0002';
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

-- mark_vehicle_lost: submitted|quoted -> lost, then roll the enquiry up ----
CREATE OR REPLACE FUNCTION mark_vehicle_lost(p_vehicle_id uuid, p_reason text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_enquiry_id uuid;
  v_status     vehicle_status;
BEGIN
  IF NOT is_admin() THEN
    RAISE EXCEPTION 'Only admins can mark a vehicle lost' USING ERRCODE = '42501';
  END IF;

  SELECT enquiry_id, status INTO v_enquiry_id, v_status
  FROM enquiry_vehicles WHERE id = p_vehicle_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Vehicle % not found', p_vehicle_id USING ERRCODE = 'P0002';
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
         AND ev.status NOT IN ('renewed', 'lost')
     );
END;
$$;

-- confirm_vehicle_renewal: the transactional payout core --------------------
-- 1) lock + flip the vehicle to renewed (preserve original stamps on re-run)
-- 2) mint the customer gift voucher  (value = pool * (100 - share_pct)/100)
-- 3) mint the agent commission       (amount = agent tier reward_amount) IFF tied
-- 4) mint the merchant settlement     (amount = pool * share_pct/100)
-- 5) roll the enquiry up to 'closed' when every vehicle is terminal
-- Idempotent: UNIQUE(enquiry_vehicle_id) on each ledger + ON CONFLICT / pre-check.
CREATE OR REPLACE FUNCTION confirm_vehicle_renewal(p_vehicle_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_enquiry_id      uuid;
  v_branch_id       uuid;
  v_status          vehicle_status;
  v_merchant_id     uuid;
  v_pool            numeric(10,2);
  v_share_pct       numeric(5,2);
  v_customer_amount numeric(10,2);
  v_merchant_amount numeric(10,2);
  v_agent_id        uuid;
  v_tier_id         uuid;
  v_reward_amount   numeric(10,2);
  v_voucher_code    text;
BEGIN
  IF NOT is_admin() THEN
    RAISE EXCEPTION 'Only admins can confirm a renewal' USING ERRCODE = '42501';
  END IF;

  -- Lock the vehicle so the whole mint is serialized per vehicle.
  SELECT ev.enquiry_id, ev.merchant_branch_id, ev.status
    INTO v_enquiry_id, v_branch_id, v_status
  FROM enquiry_vehicles ev
  WHERE ev.id = p_vehicle_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Vehicle % not found', p_vehicle_id USING ERRCODE = 'P0002';
  END IF;
  IF v_status = 'lost' THEN
    RAISE EXCEPTION 'Cannot renew a vehicle that is marked lost' USING ERRCODE = '22023';
  END IF;

  -- Merchant split via the vehicle's branch.
  SELECT b.merchant_id, m.gift_pool_amount, m.merchant_share_pct
    INTO v_merchant_id, v_pool, v_share_pct
  FROM merchant_branches b
  JOIN merchants m ON m.id = b.merchant_id
  WHERE b.id = v_branch_id;

  v_customer_amount := round(v_pool * (100 - v_share_pct) / 100, 2);
  v_merchant_amount := round(v_pool * v_share_pct / 100, 2);

  -- Tied agent snapshot (NULL = house branch -> no commission, per spec decision #9).
  SELECT e.agent_id INTO v_agent_id FROM enquiries e WHERE e.id = v_enquiry_id;

  -- 1) Flip vehicle to renewed (keep original stamps if this is a re-run).
  UPDATE enquiry_vehicles
     SET status     = 'renewed',
         renewed_at = COALESCE(renewed_at, now()),
         renewed_by = COALESCE(renewed_by, auth.uid())
   WHERE id = p_vehicle_id;

  -- 2) Customer gift voucher. Idempotent on enquiry_vehicle_id; retry on code collision.
  IF NOT EXISTS (SELECT 1 FROM gifts WHERE enquiry_vehicle_id = p_vehicle_id) THEN
    LOOP
      v_voucher_code := upper(substring(replace(gen_random_uuid()::text, '-', '') FOR 10));
      BEGIN
        INSERT INTO gifts (enquiry_vehicle_id, merchant_id, merchant_branch_id,
                           value_amount, voucher_code, status, issued_at)
        VALUES (p_vehicle_id, v_merchant_id, v_branch_id,
                v_customer_amount, v_voucher_code, 'issued', now());
        EXIT;
      EXCEPTION WHEN unique_violation THEN
        -- Either a concurrent call already minted the gift (enquiry_vehicle_id),
        -- or the random voucher_code collided. If the gift now exists, stop;
        -- otherwise regenerate the code and retry.
        IF EXISTS (SELECT 1 FROM gifts WHERE enquiry_vehicle_id = p_vehicle_id) THEN
          EXIT;
        END IF;
      END;
    END LOOP;
  END IF;

  -- 3) Agent commission (only when the branch link was tied to an agent).
  IF v_agent_id IS NOT NULL THEN
    SELECT a.tier_id, t.reward_amount
      INTO v_tier_id, v_reward_amount
    FROM agents a
    LEFT JOIN tiers t ON t.id = a.tier_id
    WHERE a.id = v_agent_id;

    INSERT INTO merchant_commissions (enquiry_vehicle_id, agent_id, tier_id, amount, status)
    VALUES (p_vehicle_id, v_agent_id, v_tier_id, COALESCE(v_reward_amount, 0), 'pending')
    ON CONFLICT (enquiry_vehicle_id) DO NOTHING;
  END IF;

  -- 4) Merchant payable settlement.
  INSERT INTO merchant_settlements (enquiry_vehicle_id, merchant_id, amount, status)
  VALUES (p_vehicle_id, v_merchant_id, v_merchant_amount, 'pending')
  ON CONFLICT (enquiry_vehicle_id) DO NOTHING;

  -- 5) Roll the enquiry up to 'closed' once every vehicle is terminal.
  UPDATE enquiries e
     SET status = 'closed'
   WHERE e.id = v_enquiry_id
     AND e.status <> 'closed'
     AND NOT EXISTS (
       SELECT 1 FROM enquiry_vehicles ev
       WHERE ev.enquiry_id = v_enquiry_id
         AND ev.status NOT IN ('renewed', 'lost')
     );
END;
$$;

-- mark_gift_redeemed: issued -> redeemed -----------------------------------
CREATE OR REPLACE FUNCTION mark_gift_redeemed(p_gift_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_status gift_status;
BEGIN
  IF NOT is_admin() THEN
    RAISE EXCEPTION 'Only admins can redeem a gift' USING ERRCODE = '42501';
  END IF;

  SELECT status INTO v_status FROM gifts WHERE id = p_gift_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Gift % not found', p_gift_id USING ERRCODE = 'P0002';
  END IF;
  IF v_status <> 'issued' THEN
    RAISE EXCEPTION 'Gift % is % and cannot be redeemed', p_gift_id, v_status USING ERRCODE = '22023';
  END IF;

  UPDATE gifts
     SET status      = 'redeemed',
         redeemed_at = now(),
         redeemed_by = auth.uid()
   WHERE id = p_gift_id;
END;
$$;

-- set_merchant_commission_status: mirror set_reward_status (stamp paid_at + set_by) --
CREATE OR REPLACE FUNCTION set_merchant_commission_status(
  p_id             uuid,
  p_status         reward_status,
  p_failure_reason text DEFAULT NULL
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT is_admin() THEN
    RAISE EXCEPTION 'Only admins can change commission status' USING ERRCODE = '42501';
  END IF;

  UPDATE merchant_commissions SET
    status         = p_status,
    paid_at        = CASE WHEN p_status = 'paid'   THEN now()            ELSE NULL END,
    failure_reason = CASE WHEN p_status = 'failed' THEN p_failure_reason ELSE NULL END,
    set_by         = auth.uid(),
    updated_at     = now()
  WHERE id = p_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Commission % not found', p_id USING ERRCODE = 'P0002';
  END IF;
END;
$$;

-- set_merchant_settlement_status: same, against merchant_settlements --------
CREATE OR REPLACE FUNCTION set_merchant_settlement_status(
  p_id             uuid,
  p_status         reward_status,
  p_failure_reason text DEFAULT NULL
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT is_admin() THEN
    RAISE EXCEPTION 'Only admins can change settlement status' USING ERRCODE = '42501';
  END IF;

  UPDATE merchant_settlements SET
    status         = p_status,
    paid_at        = CASE WHEN p_status = 'paid'   THEN now()            ELSE NULL END,
    failure_reason = CASE WHEN p_status = 'failed' THEN p_failure_reason ELSE NULL END,
    set_by         = auth.uid(),
    updated_at     = now()
  WHERE id = p_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Settlement % not found', p_id USING ERRCODE = 'P0002';
  END IF;
END;
$$;

-- Grants (admin gate is enforced inside each body; callers are authenticated) --
GRANT EXECUTE ON FUNCTION record_quotation(uuid, text)                              TO authenticated;
GRANT EXECUTE ON FUNCTION mark_vehicle_lost(uuid, text)                             TO authenticated;
GRANT EXECUTE ON FUNCTION confirm_vehicle_renewal(uuid)                             TO authenticated;
GRANT EXECUTE ON FUNCTION mark_gift_redeemed(uuid)                                  TO authenticated;
GRANT EXECUTE ON FUNCTION set_merchant_commission_status(uuid, reward_status, text) TO authenticated;
GRANT EXECUTE ON FUNCTION set_merchant_settlement_status(uuid, reward_status, text) TO authenticated;
