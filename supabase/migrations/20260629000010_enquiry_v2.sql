-- ============================================================
-- Enquiry v2: agent-scoped links, assign-to-merchant, gift+settlement only
-- ============================================================

-- 1. Agent's single reusable enquiry link code
ALTER TABLE agents ADD COLUMN IF NOT EXISTS enquiry_link_code text UNIQUE;

-- 2. enquiries: merchant assigned later; branch retired
ALTER TABLE enquiries ADD COLUMN IF NOT EXISTS merchant_id uuid REFERENCES merchants(id);
ALTER TABLE enquiries ADD COLUMN IF NOT EXISTS assigned_at timestamptz;
ALTER TABLE enquiries ADD COLUMN IF NOT EXISTS assigned_by uuid;
ALTER TABLE enquiries ALTER COLUMN branch_link_id DROP NOT NULL;
ALTER TABLE enquiries ALTER COLUMN merchant_branch_id DROP NOT NULL;
CREATE INDEX IF NOT EXISTS idx_enquiries_merchant ON enquiries(merchant_id);

-- 3. enquiry_vehicles + gifts: branch retired
ALTER TABLE enquiry_vehicles ALTER COLUMN merchant_branch_id DROP NOT NULL;
DROP INDEX IF EXISTS uq_enquiry_vehicle_dedup;
ALTER TABLE gifts ALTER COLUMN merchant_branch_id DROP NOT NULL;

-- 4. Agent: get-or-create my enquiry link code
CREATE OR REPLACE FUNCTION ensure_my_enquiry_link() RETURNS text AS $$
DECLARE v_agent_id uuid := get_agent_id(); v_code text;
BEGIN
  IF v_agent_id IS NULL THEN RAISE EXCEPTION 'Not an agent' USING ERRCODE='42501'; END IF;
  SELECT enquiry_link_code INTO v_code FROM agents WHERE id = v_agent_id;
  IF v_code IS NULL THEN
    v_code := replace(gen_random_uuid()::text, '-', '');
    UPDATE agents SET enquiry_link_code = v_code WHERE id = v_agent_id;
  END IF;
  RETURN v_code;
END; $$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;
GRANT EXECUTE ON FUNCTION ensure_my_enquiry_link() TO authenticated;

-- 5. Resolve an agent enquiry link (anon) -> generic context
CREATE OR REPLACE FUNCTION get_enquiry_link_context(p_link_code text)
RETURNS TABLE (agent_name text) AS $$
  SELECT a.name FROM agents a WHERE a.enquiry_link_code = p_link_code AND a.status = 'active';
$$ LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public;
GRANT EXECUTE ON FUNCTION get_enquiry_link_context(text) TO anon;

-- 6. notify helper (best-effort pg_net; no-op if Vault unset)
CREATE OR REPLACE FUNCTION notify_agent_enquiry(p_enquiry_id uuid) RETURNS void AS $$
DECLARE v_url text; v_key text;
BEGIN
  SELECT decrypted_secret INTO v_url FROM vault.decrypted_secrets WHERE name='project_url';
  SELECT decrypted_secret INTO v_key FROM vault.decrypted_secrets WHERE name='service_role_key';
  IF v_url IS NULL OR v_key IS NULL THEN RAISE WARNING 'notify_agent_enquiry: Vault secrets not set; skipping'; RETURN; END IF;
  PERFORM net.http_post(
    url := v_url || '/functions/v1/send-enquiry-notification',
    headers := jsonb_build_object('Content-Type','application/json','Authorization','Bearer '||v_key),
    body := jsonb_build_object('enquiry_id', p_enquiry_id), timeout_milliseconds := 8000);
END; $$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions, net, vault;

-- 7. submit_enquiry v2 (anon): resolve AGENT link; insert; notify agent
CREATE OR REPLACE FUNCTION submit_enquiry(
  p_link_code text, p_customer_name text, p_customer_nric text,
  p_customer_phone text, p_customer_email text, p_vehicles jsonb) RETURNS uuid AS $$
DECLARE v_agent_id uuid; v_enquiry_id uuid; v_nric_norm text; v_phone_norm text; v_digits text; v_vehicle jsonb;
BEGIN
  SELECT id INTO v_agent_id FROM agents WHERE enquiry_link_code = p_link_code AND status='active';
  IF NOT FOUND THEN RAISE EXCEPTION 'Link not found or inactive' USING ERRCODE='P0001'; END IF;
  IF p_vehicles IS NULL OR jsonb_typeof(p_vehicles)<>'array' OR jsonb_array_length(p_vehicles)=0 THEN
    RAISE EXCEPTION 'At least one vehicle is required' USING ERRCODE='P0006'; END IF;
  v_nric_norm := upper(regexp_replace(coalesce(p_customer_nric,''),'[^a-zA-Z0-9]','','g'));
  v_digits := regexp_replace(coalesce(p_customer_phone,''),'\D','','g');
  IF left(v_digits,2)='60' THEN v_phone_norm := v_digits;
  ELSE v_digits := regexp_replace(v_digits,'^0+',''); v_phone_norm := CASE WHEN v_digits='' THEN '' ELSE '60'||v_digits END; END IF;
  INSERT INTO enquiries (branch_link_id, merchant_branch_id, agent_id, customer_name, customer_nric, customer_nric_normalized, customer_phone, customer_phone_normalized, customer_email, status)
  VALUES (NULL, NULL, v_agent_id, p_customer_name, p_customer_nric, v_nric_norm, p_customer_phone, v_phone_norm, NULLIF(trim(coalesce(p_customer_email,'')),''), 'open')
  RETURNING id INTO v_enquiry_id;
  FOR v_vehicle IN SELECT * FROM jsonb_array_elements(p_vehicles) LOOP
    INSERT INTO enquiry_vehicles (enquiry_id, merchant_branch_id, car_plate, car_plate_normalized, insurance_expiry_date, insurance_product_id, status)
    VALUES (v_enquiry_id, NULL, v_vehicle->>'car_plate', upper(regexp_replace(coalesce(v_vehicle->>'car_plate',''),'[^a-zA-Z0-9]','','g')), (v_vehicle->>'expiry_date')::date, NULLIF(v_vehicle->>'insurance_product_id','')::uuid, 'submitted');
  END LOOP;
  PERFORM notify_agent_enquiry(v_enquiry_id);
  RETURN v_enquiry_id;
END; $$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions, net, vault;
GRANT EXECUTE ON FUNCTION submit_enquiry(text,text,text,text,text,jsonb) TO anon;

-- 8. assign_enquiry_merchant (agent-only, own enquiry, active merchant)
CREATE OR REPLACE FUNCTION assign_enquiry_merchant(p_enquiry_id uuid, p_merchant_id uuid) RETURNS void AS $$
DECLARE v_agent_id uuid := get_agent_id();
BEGIN
  IF v_agent_id IS NULL THEN RAISE EXCEPTION 'Not an agent' USING ERRCODE='42501'; END IF;
  IF NOT EXISTS (SELECT 1 FROM merchants WHERE id=p_merchant_id AND status='active') THEN
    RAISE EXCEPTION 'Partnership not found or not active' USING ERRCODE='P0001'; END IF;
  UPDATE enquiries SET merchant_id=p_merchant_id, assigned_at=now(), assigned_by=auth.uid()
   WHERE id=p_enquiry_id AND agent_id=v_agent_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Enquiry not found or not yours' USING ERRCODE='42501'; END IF;
END; $$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;
GRANT EXECUTE ON FUNCTION assign_enquiry_merchant(uuid,uuid) TO authenticated;

-- 9. confirm_vehicle_renewal v2: gift + settlement only (NO commission); merchant from enquiry
CREATE OR REPLACE FUNCTION confirm_vehicle_renewal(p_vehicle_id uuid) RETURNS void AS $$
DECLARE v_vehicle enquiry_vehicles%ROWTYPE; v_enquiry enquiries%ROWTYPE; v_pool numeric(10,2); v_share numeric(5,2); v_customer numeric(10,2); v_merchant_amt numeric(10,2); v_code text;
BEGIN
  IF NOT is_admin() THEN RAISE EXCEPTION 'Only admins can confirm renewal' USING ERRCODE='42501'; END IF;
  SELECT * INTO v_vehicle FROM enquiry_vehicles WHERE id=p_vehicle_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Vehicle not found'; END IF;
  IF v_vehicle.status='lost' THEN RAISE EXCEPTION 'Vehicle is lost'; END IF;
  SELECT * INTO v_enquiry FROM enquiries WHERE id=v_vehicle.enquiry_id;
  IF v_enquiry.merchant_id IS NULL THEN RAISE EXCEPTION 'Assign a partnership before confirming renewal' USING ERRCODE='P0008'; END IF;
  SELECT gift_pool_amount, merchant_share_pct INTO v_pool, v_share FROM merchants WHERE id=v_enquiry.merchant_id;
  v_customer := round(v_pool*(100-v_share)/100, 2); v_merchant_amt := round(v_pool*v_share/100, 2);
  UPDATE enquiry_vehicles SET status='renewed', renewed_at=COALESCE(renewed_at, now()), renewed_by=COALESCE(renewed_by, auth.uid()) WHERE id=p_vehicle_id;
  IF NOT EXISTS (SELECT 1 FROM gifts WHERE enquiry_vehicle_id=p_vehicle_id) THEN
    LOOP
      v_code := upper(substring(replace(gen_random_uuid()::text,'-','') for 10));
      BEGIN
        INSERT INTO gifts (enquiry_vehicle_id, merchant_id, merchant_branch_id, value_amount, voucher_code, status, issued_at)
        VALUES (p_vehicle_id, v_enquiry.merchant_id, NULL, v_customer, v_code, 'issued', now()); EXIT;
      EXCEPTION WHEN unique_violation THEN
        IF EXISTS (SELECT 1 FROM gifts WHERE enquiry_vehicle_id=p_vehicle_id) THEN EXIT; END IF;
      END;
    END LOOP;
  END IF;
  INSERT INTO merchant_settlements (enquiry_vehicle_id, merchant_id, amount, status)
  VALUES (p_vehicle_id, v_enquiry.merchant_id, v_merchant_amt, 'pending') ON CONFLICT (enquiry_vehicle_id) DO NOTHING;
  UPDATE enquiries e SET status='closed' WHERE e.id=v_enquiry.id AND e.status<>'closed'
    AND NOT EXISTS (SELECT 1 FROM enquiry_vehicles ev WHERE ev.enquiry_id=e.id AND ev.status NOT IN ('renewed','lost'));
END; $$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;
GRANT EXECUTE ON FUNCTION confirm_vehicle_renewal(uuid) TO authenticated;
