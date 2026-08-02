-- ============================================================
-- HOTFIX 2026-08-02 — restore unit-root (Unit Manager) enquiry links.
--
-- Round 6 (20260721000003) encoded "Unit Managers carry no personal enquiry
-- link". That was wrong in practice: unit roots print their personal link as a
-- QR code for gold-scanning at fairs. The rollout on 2026-07-31 nulled all 10
-- live root codes AND added a P0016 guard preventing regeneration, so agents
-- standing at an event had dead printed QR codes and no way to recover them.
--
-- Applied to prod (mjtdsevynrtcmafsnxsj) 2026-08-02 as
-- `restore_unit_root_enquiry_links`. The 9 recoverable original codes were
-- restored from docs/superpowers/prod-root-enquiry-link-codes-backup-2026-07-31.sql
-- by id, so QRs already in customers' hands resolve again. That restore is a
-- prod-data action and is intentionally NOT replayed here.
-- ============================================================

-- (a) Drop the P0016 root guard: any active agent may hold a personal link.
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

-- (b) Backfill every active agent still missing a link, so nobody discovers a
--     dead QR at an event. Generated, not restored — no prior code to recover.
UPDATE agents SET enquiry_link_code = replace(gen_random_uuid()::text, '-', '')
WHERE status = 'active' AND enquiry_link_code IS NULL;
