-- Round 5 item 1 (CRITICAL): explicit Master Partner flag. Round 4 treated
-- "admin-created" (created_by_agent_id IS NULL) as master, which put EVERY
-- admin-created partner in every agent's Assign dropdown. Now only merchants
-- explicitly flagged is_master are assignable by all agents; other merchants
-- stay scoped to the proposing agent or agents holding a branch link.
ALTER TABLE merchants ADD COLUMN IF NOT EXISTS is_master boolean NOT NULL DEFAULT false;
-- Backfill: merchants with a portal login are the client's Master Partners today.
UPDATE merchants SET is_master = true WHERE user_id IS NOT NULL;

-- Round 5 item 3 (NEW): per-partner form design for branch enquiry forms.
-- Optional keys: header_image_url, header_logo_url, header_title,
-- header_subtitle, footer_text. Absent keys fall back to global settings.
ALTER TABLE merchants ADD COLUMN IF NOT EXISTS form_settings jsonb;

-- Single source of truth for "may this agent use this partner?", mirrored by
-- isMerchantAvailableToAgent() in the agent portal.
CREATE OR REPLACE FUNCTION merchant_available_to_agent(p_merchant_id uuid, p_agent_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM merchants m
    WHERE m.id = p_merchant_id AND m.status = 'active'
      AND (
        m.is_master
        OR m.created_by_agent_id = p_agent_id
        OR EXISTS (
          SELECT 1 FROM branch_links bl
          JOIN merchant_branches b ON b.id = bl.merchant_branch_id
          WHERE bl.agent_id = p_agent_id AND b.merchant_id = m.id
            AND bl.is_active AND b.status = 'active'
        )
      )
  );
$$;
GRANT EXECUTE ON FUNCTION merchant_available_to_agent(uuid, uuid) TO authenticated;

-- Same body as 20260706000001 but the merchant check now uses the helper
-- (is_master / own proposal / branch link) instead of created_by IS NULL.
CREATE OR REPLACE FUNCTION assign_vehicle_merchant(p_vehicle_id uuid, p_merchant_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_agent_id uuid := get_agent_id();
BEGIN
  IF v_agent_id IS NULL THEN
    RAISE EXCEPTION 'Not an agent' USING ERRCODE='42501';
  END IF;
  IF NOT merchant_available_to_agent(p_merchant_id, v_agent_id) THEN
    RAISE EXCEPTION 'Partnership not found, not active, or not assignable by you' USING ERRCODE='P0008';
  END IF;
  UPDATE enquiry_vehicles ev
     SET merchant_id = p_merchant_id
    FROM enquiries e
   WHERE ev.id = p_vehicle_id
     AND e.id = ev.enquiry_id
     AND (e.agent_id = v_agent_id OR e.agent_id IN (SELECT unit_member_ids()));
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Vehicle not found or not yours' USING ERRCODE='42501';
  END IF;
END;
$$;
GRANT EXECUTE ON FUNCTION assign_vehicle_merchant(uuid, uuid) TO authenticated;

-- get_enquiry_context gains merchant_form_settings. Return type changes, so
-- drop + recreate (CREATE OR REPLACE cannot change OUT columns).
DROP FUNCTION IF EXISTS get_enquiry_context(text);
CREATE FUNCTION get_enquiry_context(p_link_code text)
RETURNS TABLE (
  kind text, agent_name text, merchant_name text, merchant_logo_url text,
  branch_name text, merchant_form_settings jsonb
) AS $$
  SELECT 'agent'::text, a.name, NULL::text, NULL::text, NULL::text, NULL::jsonb
  FROM agents a WHERE a.enquiry_link_code = p_link_code AND a.status = 'active'
  UNION ALL
  SELECT 'branch'::text, NULL::text, m.name, m.logo_url, b.name, m.form_settings
  FROM branch_links bl
  JOIN merchant_branches b ON b.id = bl.merchant_branch_id
  JOIN merchants m ON m.id = b.merchant_id
  WHERE bl.link_code = p_link_code AND bl.is_active = true
    AND b.status = 'active' AND m.status = 'active'
  LIMIT 1;
$$ LANGUAGE sql SECURITY DEFINER STABLE SET search_path = public;
GRANT EXECUTE ON FUNCTION get_enquiry_context(text) TO anon;
