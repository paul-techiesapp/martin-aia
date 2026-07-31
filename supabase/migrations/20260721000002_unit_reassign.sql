-- ============================================================
-- reassign_customer_agent(text, uuid) -- unit-scoped reassignment
--
-- Round 6: unit viewers (unit root `parent_agent_id IS NULL`, or deputies
-- `is_unit_manager = true`; both covered by is_unit_viewer()) may now
-- reassign a customer, provided:
--   (a) the target agent is inside their unit (unit_member_ids()), and
--   (b) every OPEN enquiry of that customer already belongs to an agent
--       inside their unit.
-- "Open enquiry" here mirrors the EXISTS predicate this function's own
-- UPDATE uses below: enquiry_vehicles with removed_at IS NULL AND
-- status IN ('submitted','quoted').
-- Admin path is unchanged. New error codes:
--   P0017 -- target agent is not in the caller's unit
--   P0018 -- customer is not fully managed by the caller's unit
--
-- Everything below the authz block is copied verbatim from the current
-- definition (20260716000004_removed_at_ripple.sql:304-379): normalization,
-- the P0011 active-target check, the from_agent lookup, the UPDATE, and the
-- audit insert are all unchanged.
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
  v_is_admin      boolean := is_admin();
BEGIN
  -- Same normalization as submit_enquiry (20260706000009). The caller passes the
  -- raw NRIC because the admin client only holds enquiries.customer_nric.
  v_nric_norm := upper(regexp_replace(coalesce(p_customer_nric, ''), '[^a-zA-Z0-9]', '', 'g'));

  -- Without this guard a blank NRIC would match every blank-NRIC customer at once
  -- and reassign all of them in one call.
  IF v_nric_norm = '' THEN
    RAISE EXCEPTION 'Customer NRIC is required' USING ERRCODE = '22023';
  END IF;

  IF NOT v_is_admin AND NOT is_unit_viewer() THEN
    RAISE EXCEPTION 'not allowed to reassign customers' USING ERRCODE = '42501';
  END IF;

  IF NOT v_is_admin THEN
    IF p_new_agent_id NOT IN (SELECT unit_member_ids()) THEN
      RAISE EXCEPTION 'target agent is not in your unit' USING ERRCODE = 'P0017';
    END IF;

    -- Every open enquiry for this customer must already belong to the unit.
    -- The open-enquiry definition (removed_at IS NULL AND status IN
    -- ('submitted','quoted')) must match the UPDATE's predicate below.
    IF EXISTS (
      SELECT 1 FROM enquiries e
      WHERE e.customer_nric_normalized = v_nric_norm
        AND EXISTS (
          SELECT 1 FROM enquiry_vehicles v
          WHERE v.enquiry_id = e.id
            AND v.removed_at IS NULL
            AND v.status IN ('submitted', 'quoted')
        )
        AND (e.agent_id IS NULL OR e.agent_id NOT IN (SELECT unit_member_ids()))
    ) THEN
      RAISE EXCEPTION 'customer is not managed by your unit' USING ERRCODE = 'P0018';
    END IF;
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
