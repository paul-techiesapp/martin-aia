-- Merchant portal follow-up: Master Partner needs lead-level detail, not just
-- counts. One row per vehicle on enquiries submitted through the merchant's
-- own branch links (agent-assigned leads stay excluded). The customer walked
-- into the merchant's branch and submitted via their QR, so name/plate are
-- shown; NRIC, phone and email are deliberately NOT returned.
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
  ORDER BY e.created_at DESC, v.car_plate
  LIMIT LEAST(GREATEST(coalesce(p_limit, 200), 1), 500);
$$;
GRANT EXECUTE ON FUNCTION merchant_branch_leads(int) TO authenticated;
