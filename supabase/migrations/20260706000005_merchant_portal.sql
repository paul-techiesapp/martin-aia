-- Round 4 item 7a: Master Partner (merchant) read-only portal access.
ALTER TABLE merchants ADD COLUMN IF NOT EXISTS user_id uuid UNIQUE REFERENCES auth.users(id) ON DELETE SET NULL;
ALTER TABLE merchants ADD COLUMN IF NOT EXISTS portal_email text;

-- The linked merchant user may read their own merchant row (auth resolution).
DROP POLICY IF EXISTS "Merchant user reads own merchant" ON merchants;
CREATE POLICY "Merchant user reads own merchant"
  ON merchants FOR SELECT TO authenticated
  USING (user_id = auth.uid());

-- Branch performance counts for the logged-in merchant user. Counts ONLY leads
-- submitted through branch links (branch_link_id set) — agent-assigned
-- partnership leads are excluded by design. No customer PII returned.
CREATE OR REPLACE FUNCTION merchant_branch_stats()
RETURNS TABLE (
  branch_id uuid,
  branch_name text,
  branch_status merchant_status,
  total_leads bigint,
  leads_this_month bigint,
  last_lead_at timestamptz
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT b.id, b.name, b.status,
    count(e.id) FILTER (WHERE e.branch_link_id IS NOT NULL),
    count(e.id) FILTER (
      WHERE e.branch_link_id IS NOT NULL
        AND e.created_at >= (date_trunc('month', now() AT TIME ZONE 'Asia/Singapore') AT TIME ZONE 'Asia/Singapore')),
    max(e.created_at) FILTER (WHERE e.branch_link_id IS NOT NULL)
  FROM merchant_branches b
  JOIN merchants m ON m.id = b.merchant_id
  LEFT JOIN enquiries e ON e.merchant_branch_id = b.id
  WHERE m.user_id = auth.uid()
  GROUP BY b.id, b.name, b.status
  ORDER BY b.name;
$$;
GRANT EXECUTE ON FUNCTION merchant_branch_stats() TO authenticated;
