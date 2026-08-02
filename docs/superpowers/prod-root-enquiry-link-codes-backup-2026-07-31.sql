-- Backup of unit-root (Unit Manager) enquiry_link_code values on PRODUCTION
-- (mjtdsevynrtcmafsnxsj), captured 2026-07-31 before the round-6 rollout.
--
-- Why this exists: migration 20260721000003_unit_form_settings_and_context.sql
-- line 44 contains
--     UPDATE agents SET enquiry_link_code = NULL WHERE parent_agent_id IS NULL;
-- which permanently kills these links. 7 of the 10 have taken real enquiries
-- (MT77-WILLIAM 14, latest 24 Jul; Nicole Lim 3, latest 30 Jul; DRT-DANIEL 3;
-- DR88-TRACY 3; BOS/V155/MN9441-NICOLE 1 each), so any customer holding one of
-- these WhatsApp/SMS links would hit a dead form.
--
-- STATUS: the UPDATE was held back during the initial 2026-07-31 rollout, then
-- RUN on 2026-07-31 after the client confirmed. All 10 root links went NULL;
-- 182 sub-agent links were unaffected and all 1608 enquiries kept their agent.
--
-- >>> RESTORED 2026-08-02. The clearing was reverted: agents print their
-- personal link as a QR code for gold-scanning and were standing at a fair with
-- dead printed QRs. 9 of the 10 codes below were restored verbatim by id and
-- verified live via get_enquiry_context(). The 10th (dfea09b1, MN9441-NICOLE)
-- was NOT restored: they had since become a sub-agent and self-generated a new
-- code (7676686ecb374aa6bfa34211cd76104d). enquiry_link_code is UNIQUE, so
-- restoring the old value would have destroyed the newer working link — if a
-- QR printed from their OLD code surfaces, decide which of the two to keep.
--
-- The root-clearing is now permanently reverted in code:
-- 20260721000003 line 44 is a documented no-op and
-- 20260802000001_restore_unit_root_enquiry_links.sql drops the P0016 guard.
-- This file is retained as the audit trail of the original values.

UPDATE agents SET enquiry_link_code = '5c59f12559c342fea72b31abac3273cf' WHERE id = '742ce18c-00c3-40c3-b0c9-3e0fba0195b5'; -- BOS - BOSCO (BOS)
UPDATE agents SET enquiry_link_code = 'c91549b00db34e23851c2fcdafca1018' WHERE id = 'e2c24e4a-6581-40a9-9c6a-b19760a37fe9'; -- DR88 - TRACY (DR88)
UPDATE agents SET enquiry_link_code = '0fd163b601514c179b5c7ddd3f1c8205' WHERE id = '30097b92-646b-429b-bd30-2baa977b1e94'; -- DRT - DANIEL (DRT)
UPDATE agents SET enquiry_link_code = '0bc6dc29542743d5a755e0fd866da378' WHERE id = '1f542908-94bb-4fb9-86cf-9e6739332de6'; -- GP99 - GARY (GP99)
UPDATE agents SET enquiry_link_code = 'ccc685609cb14cc79315cd57aa5e7891' WHERE id = '05fd76c8-188c-4a8c-82ac-f912828a0b7f'; -- INFINITY J - JO
UPDATE agents SET enquiry_link_code = '643fc2cd94454ee6a5938eb2a8cfddcb' WHERE id = 'c7e4a22c-d660-4d8a-8ec0-e4c19e96a157'; -- J771 - JANE (J771)
UPDATE agents SET enquiry_link_code = '7150af2bac564956ad733e9dd606ff98' WHERE id = 'dfea09b1-9cde-42bd-bf63-96ce78091341'; -- MN9441 - NICOLE (MN9441)
UPDATE agents SET enquiry_link_code = 'cb7bdc81241142c3b4d0422b5607f13a' WHERE id = '3cc66dde-6152-4a62-b648-c6d835d6e965'; -- MT77 - WILLIAM (MT77)
UPDATE agents SET enquiry_link_code = '945eca67f46f48159bb6ce3530d6215c' WHERE id = 'bfa09c9d-a888-49c0-ba02-ebd1990c3948'; -- Nicole Lim (MN9441)
UPDATE agents SET enquiry_link_code = '9650799a44b4439796d3a16f7c75329c' WHERE id = '72701c97-5b91-4e30-bbb3-b202936cc79e'; -- V155 - VERA (V155)
