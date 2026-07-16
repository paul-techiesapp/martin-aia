-- Admin reassignment of a customer from one agent to another (agent resignation).
--
-- enquiries.agent_id was write-once: submit_enquiry set it from the link code and
-- nothing ever changed it. When an agent resigned there was no supported way to
-- hand their customers to someone else, and because enquiries.agent_id is
-- ON DELETE SET NULL, deleting the resigned agent silently orphaned every one of
-- their customers to agent_id NULL — invisible in every agent portal.
--
-- There is no customers table: a "customer" is every enquiries row sharing a
-- customer_nric_normalized. So reassignment keys on the NRIC, which also means it
-- still works on already-orphaned customers.
--
-- Only OPEN work moves. An enquiry moves only if it still has a submitted/quoted
-- vehicle. Enquiries whose vehicles are all renewed/lost keep their original
-- agent_id, so historical reports and recorded renewal credit are not rewritten
-- away from the agent who actually closed them.

CREATE TABLE customer_agent_reassignments (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nric_normalized text NOT NULL,
  from_agent_id   uuid REFERENCES agents(id) ON DELETE SET NULL,
  to_agent_id     uuid REFERENCES agents(id) ON DELETE SET NULL,
  enquiry_count   int NOT NULL,
  reassigned_by   uuid NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_customer_agent_reassignments_nric
  ON customer_agent_reassignments (nric_normalized, created_at DESC);

ALTER TABLE customer_agent_reassignments ENABLE ROW LEVEL SECURITY;

-- Admins only. No agent and no anon policy: this is an audit log of an admin action.
CREATE POLICY "Admin full access to customer_agent_reassignments"
  ON customer_agent_reassignments FOR ALL TO authenticated USING (is_admin());

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

  -- Recorded as the "from" for audit: the agent on the newest matching enquiry.
  SELECT e.agent_id INTO v_from_agent_id
  FROM enquiries e
  WHERE e.customer_nric_normalized = v_nric_norm
  ORDER BY e.created_at DESC
  LIMIT 1;

  UPDATE enquiries e
  SET agent_id = p_new_agent_id,
      updated_at = now()
  WHERE e.customer_nric_normalized = v_nric_norm
    AND EXISTS (
      SELECT 1 FROM enquiry_vehicles v
      WHERE v.enquiry_id = e.id
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
