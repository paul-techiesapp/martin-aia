-- ============================================================
-- Enquiry attachments: customer-uploaded documents (car registration
-- card, etc.), attached PER VEHICLE. Optional. Stored in a PRIVATE
-- bucket; readable only by admin + the tied agent (via signed URLs).
-- ============================================================

-- 1. Private storage bucket (images + PDF, <=10MB each).
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'enquiry-attachments', 'enquiry-attachments', false, 10485760,
  ARRAY['image/jpeg','image/png','image/webp','image/heic','image/heif','application/pdf']
)
ON CONFLICT (id) DO NOTHING;

-- 2. Attachments table (one row per uploaded file).
CREATE TABLE IF NOT EXISTS enquiry_attachments (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  enquiry_id         uuid NOT NULL REFERENCES enquiries(id) ON DELETE CASCADE,
  enquiry_vehicle_id uuid REFERENCES enquiry_vehicles(id) ON DELETE CASCADE,
  storage_path       text NOT NULL UNIQUE,
  file_name          text NOT NULL,
  content_type       text,
  size_bytes         bigint,
  created_at         timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_enq_attach_enquiry ON enquiry_attachments(enquiry_id);
CREATE INDEX IF NOT EXISTS idx_enq_attach_vehicle ON enquiry_attachments(enquiry_vehicle_id);
ALTER TABLE enquiry_attachments ENABLE ROW LEVEL SECURITY;

-- Rows are inserted by submit_enquiry (SECURITY DEFINER), so anon needs no
-- direct INSERT policy. Reads: admin (all) + the tied agent (own enquiries).
DROP POLICY IF EXISTS "Admin full access enquiry_attachments" ON enquiry_attachments;
CREATE POLICY "Admin full access enquiry_attachments"
  ON enquiry_attachments FOR ALL TO authenticated
  USING (is_admin()) WITH CHECK (is_admin());

DROP POLICY IF EXISTS "Agent reads own enquiry_attachments" ON enquiry_attachments;
CREATE POLICY "Agent reads own enquiry_attachments"
  ON enquiry_attachments FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM enquiries e
    WHERE e.id = enquiry_attachments.enquiry_id AND e.agent_id = get_agent_id()
  ));

-- 3. Storage object policies for this bucket.
--    UPLOAD: anon/authenticated may insert (customers are anonymous). Bucket
--    size/mime limits constrain abuse. READ: admin (all) + tied agent (own).
DROP POLICY IF EXISTS "enquiry-attachments anon upload" ON storage.objects;
CREATE POLICY "enquiry-attachments anon upload"
  ON storage.objects FOR INSERT TO anon, authenticated
  WITH CHECK (bucket_id = 'enquiry-attachments');

DROP POLICY IF EXISTS "enquiry-attachments admin read" ON storage.objects;
CREATE POLICY "enquiry-attachments admin read"
  ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'enquiry-attachments' AND is_admin());

DROP POLICY IF EXISTS "enquiry-attachments agent read own" ON storage.objects;
CREATE POLICY "enquiry-attachments agent read own"
  ON storage.objects FOR SELECT TO authenticated
  USING (
    bucket_id = 'enquiry-attachments'
    AND EXISTS (
      SELECT 1 FROM enquiry_attachments ea
      JOIN enquiries e ON e.id = ea.enquiry_id
      WHERE ea.storage_path = storage.objects.name
        AND e.agent_id = get_agent_id()
    )
  );

-- 4. Extend submit_enquiry to record per-vehicle attachments. Each element of
--    p_vehicles may carry an "attachments" array of
--    { storage_path, file_name, content_type, size_bytes }.
CREATE OR REPLACE FUNCTION submit_enquiry(
  p_link_code text, p_customer_name text, p_customer_nric text,
  p_customer_phone text, p_customer_email text, p_vehicles jsonb) RETURNS uuid AS $$
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
      (v_vehicle->>'expiry_date')::date, NULLIF(v_vehicle->>'insurance_product_id','')::uuid, 'submitted')
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

  IF v_agent_id IS NOT NULL THEN PERFORM notify_agent_enquiry(v_enquiry_id); END IF;
  RETURN v_enquiry_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions, net, vault;
GRANT EXECUTE ON FUNCTION submit_enquiry(text,text,text,text,text,jsonb) TO anon;
