-- Customer self-serve vehicle list: the permanent per-customer link.
--
-- There is no customers table: a "customer" is every enquiries row sharing a
-- customer_nric_normalized. The token therefore hangs off the NRIC, not off an
-- enquiry — a my_cars_token column on enquiries would give a customer with two
-- enquiries two tokens and two disjoint car lists, which is exactly the thing
-- this feature exists to avoid.
--
-- The link is permanent and unauthenticated (matching agents.enquiry_link_code
-- and branch_links.link_code, which are also permanent random codes). It is
-- revocable instead of expiring, because a customer who hits a dead link just
-- calls their agent. NRIC is masked by the read RPC, so a leaked link does not
-- disclose a full IC.
--
-- Removal of a car is a SOFT delete. A renewed car has a gifts voucher and a
-- merchant_settlements row attached, so hard-deleting one would strand money
-- records; and an agent needs to see that a lead existed even after the
-- customer withdrew it. removed_at is the single source of truth and every
-- site that counts vehicles must exclude it (see 20260716000004).

CREATE TABLE customer_portal_tokens (
  token           text PRIMARY KEY,
  nric_normalized text NOT NULL UNIQUE,
  created_at      timestamptz NOT NULL DEFAULT now(),
  revoked_at      timestamptz
);

ALTER TABLE customer_portal_tokens ENABLE ROW LEVEL SECURITY;

-- NO anon policy: anon reaches this table only through the SECURITY DEFINER
-- RPCs in 20260716000003, matching the rule set in 20260627000002.
-- Read-only for admins; the RPCs below are SECURITY DEFINER and write directly.
CREATE POLICY "Admins read customer_portal_tokens"
  ON customer_portal_tokens FOR SELECT TO authenticated USING (is_admin());

ALTER TABLE enquiry_vehicles
  ADD COLUMN removed_at          timestamptz,
  ADD COLUMN removed_by_customer boolean NOT NULL DEFAULT false;

-- Partial index: every hot query filters removed_at IS NULL.
CREATE INDEX idx_enquiry_vehicles_live
  ON enquiry_vehicles (enquiry_id) WHERE removed_at IS NULL;

-- Get-or-create, mirroring ensure_my_enquiry_link() (20260629000010).
-- Callable by the enquiry's owning agent, a unit viewer of that agent, or an
-- admin. The admin path matters: it is the fallback when the agent has resigned
-- and cannot share the link themselves.
CREATE OR REPLACE FUNCTION ensure_customer_portal_token(p_enquiry_id uuid)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_nric_norm text;
  v_agent_id  uuid;
  v_token     text;
BEGIN
  SELECT e.customer_nric_normalized, e.agent_id
    INTO v_nric_norm, v_agent_id
  FROM enquiries e WHERE e.id = p_enquiry_id;

  IF v_nric_norm IS NULL THEN
    RAISE EXCEPTION 'Enquiry not found' USING ERRCODE = 'P0012';
  END IF;

  -- A blank NRIC would collide every blank-NRIC customer onto one token.
  IF v_nric_norm = '' THEN
    RAISE EXCEPTION 'This customer has no IC on record' USING ERRCODE = '22023';
  END IF;

  -- COALESCE is load-bearing: get_agent_id() returns NULL for a caller with no
  -- agents row (e.g. a merchant portal login), which makes
  -- `v_agent_id = get_agent_id()` NULL rather than false. The whole OR chain
  -- then evaluates to NULL, and PL/pgSQL treats `IF NULL THEN` as false — so
  -- without COALESCE the RAISE below is silently skipped and authorization is
  -- bypassed entirely.
  IF NOT COALESCE(
       is_admin()
       OR (v_agent_id IS NOT NULL AND v_agent_id = get_agent_id())
       OR (v_agent_id IS NOT NULL AND v_agent_id IN (SELECT unit_member_ids())),
       false
     ) THEN
    RAISE EXCEPTION 'Not allowed to issue this customer link' USING ERRCODE = '42501';
  END IF;

  SELECT t.token INTO v_token
  FROM customer_portal_tokens t WHERE t.nric_normalized = v_nric_norm;

  IF v_token IS NULL THEN
    -- Same shape as ensure_my_enquiry_link(): 32 lowercase hex chars.
    v_token := replace(gen_random_uuid()::text, '-', '');
    -- ON CONFLICT guards the get-or-create race: two concurrent first-time
    -- calls for the same NRIC would otherwise both INSERT and the second would
    -- raise a raw unique_violation. If the conflict fires, our INSERT wrote
    -- nothing, so re-read the token the other caller committed.
    INSERT INTO customer_portal_tokens (token, nric_normalized)
    VALUES (v_token, v_nric_norm)
    ON CONFLICT (nric_normalized) DO NOTHING;

    IF NOT FOUND THEN
      SELECT t.token INTO v_token
      FROM customer_portal_tokens t WHERE t.nric_normalized = v_nric_norm;
    END IF;
  END IF;

  -- A revoked token is returned as-is rather than silently reissued: reissuing
  -- would defeat the revoke. Re-enabling is an explicit admin action.
  RETURN v_token;
END;
$$;

GRANT EXECUTE ON FUNCTION ensure_customer_portal_token(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION revoke_customer_portal_token(p_token text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT is_admin() THEN
    RAISE EXCEPTION 'Only admins can revoke a customer link' USING ERRCODE = '42501';
  END IF;
  UPDATE customer_portal_tokens SET revoked_at = now()
  WHERE token = p_token AND revoked_at IS NULL;
END;
$$;

GRANT EXECUTE ON FUNCTION revoke_customer_portal_token(text) TO authenticated;
