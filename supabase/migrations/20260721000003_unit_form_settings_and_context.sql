-- (a) Unit-level form overrides, stored on the unit root agent row.
--     Mirrors merchants.form_settings; only footer_image_url is used today.
ALTER TABLE agents ADD COLUMN IF NOT EXISTS form_settings jsonb;

-- (b) get_enquiry_context v2: expose the relevant agent's phone (thank-you
--     page shows name + contact) and the owning unit root's form_settings
--     (footer precedence: partner > unit > admin). Return type changes, so
--     drop first.
DROP FUNCTION IF EXISTS get_enquiry_context(text);
CREATE FUNCTION get_enquiry_context(p_link_code text)
RETURNS TABLE (
  kind text,
  agent_name text,
  agent_phone text,
  merchant_name text,
  merchant_logo_url text,
  branch_name text,
  merchant_form_settings jsonb,
  unit_form_settings jsonb
)
LANGUAGE sql
SECURITY DEFINER STABLE
SET search_path = public
AS $$
  SELECT 'agent', a.name, a.phone, NULL, NULL, NULL, NULL,
         (SELECT r.form_settings FROM agents r
           WHERE r.id = COALESCE(a.parent_agent_id, a.id))
    FROM agents a
   WHERE a.enquiry_link_code = p_link_code AND a.status = 'active'
  UNION ALL
  SELECT 'branch', ta.name, ta.phone, m.name, m.logo_url, b.name, m.form_settings,
         (SELECT r.form_settings FROM agents r
           WHERE r.id = COALESCE(ta.parent_agent_id, ta.id))
    FROM branch_links bl
    JOIN merchant_branches b ON b.id = bl.merchant_branch_id AND b.status = 'active'
    JOIN merchants m ON m.id = b.merchant_id AND m.status = 'active'
    LEFT JOIN agents ta ON ta.id = bl.agent_id AND ta.status = 'active'
   WHERE bl.link_code = p_link_code AND bl.is_active
  LIMIT 1;
$$;
GRANT EXECUTE ON FUNCTION get_enquiry_context(text) TO anon;

-- (c) REVERTED 2026-08-02 — deliberately left as a no-op, do not reinstate.
-- This line was:
--   UPDATE agents SET enquiry_link_code = NULL WHERE parent_agent_id IS NULL;
-- Unit Managers DO use personal enquiry links: they print them as QR codes for
-- gold-scanning at fairs. Running this on prod (2026-07-31) killed 10 live
-- links, and agents discovered the dead QRs standing at an event. Note the
-- predicate means "has no parent", not "is a Unit Manager" — it also catches
-- any agent who simply has not been assigned to a unit yet.
-- See 20260802000001_restore_unit_root_enquiry_links.sql.

-- (d) ensure_my_enquiry_link: unchanged from 20260629000010_enquiry_v2.sql.
--     The P0016 root guard that lived here was REVERTED 2026-08-02 — it left
--     Unit Managers unable to regenerate the link this migration had just
--     nulled, so a dead printed QR could not be recovered. See (c) above and
--     20260802000001_restore_unit_root_enquiry_links.sql.
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
