-- ============================================================
-- DEMO SEED DATA for Production
-- Run via Supabase Dashboard SQL Editor
-- https://supabase.com/dashboard/project/wictbtiulqmzzneyoelv/sql/new
-- ============================================================
-- IMPORTANT: This script is IDEMPOTENT - uses ON CONFLICT DO NOTHING
-- Safe to run multiple times without duplicating data.
-- ============================================================

-- ============================================
-- 0. BASE DATA (from seed.sql - may already exist)
-- ============================================
INSERT INTO tiers (id, name, role_type, reward_amount) VALUES
  ('f669fbc3-94ea-46ed-bfc5-a24e669ec337', 'Standard Agent', 'agent', 50.00)
ON CONFLICT (name) DO NOTHING;

INSERT INTO campaigns (id, name, start_date, end_date, venue, registration_type, status, checkout_config, max_headcount) VALUES
  ('aaaa1111-1111-1111-1111-111111111111', 'March 2026 Recruitment Drive', '2026-03-01', '2026-03-31', 'Marina Bay Sands Convention Centre', 'business_opportunity', 'active',
   '{"fb_enabled": true, "fb_url": "https://facebook.com/demo", "video_enabled": false, "video_url": "", "rating_enabled": true}'::jsonb, 100)
ON CONFLICT (id) DO NOTHING;

INSERT INTO slots (id, campaign_id, start_at, end_at, checkin_window_minutes, checkout_window_minutes, is_active, is_auto_card) VALUES
  ('bbbb2222-2222-2222-2222-222222222222', 'aaaa1111-1111-1111-1111-111111111111', '2026-03-15 10:00:00+08', '2026-03-15 13:00:00+08', 30, 30, true, true)
ON CONFLICT (id) DO NOTHING;

INSERT INTO agent_links (id, agent_id, slot_id, link_code, is_active) VALUES
  ('cccc3333-3333-3333-3333-333333333333', 'ca1b78e3-ae85-41ee-912a-d9a7cd70a345', 'bbbb2222-2222-2222-2222-222222222222', 'dddd4444-4444-4444-4444-444444444444', true)
ON CONFLICT (id) DO NOTHING;

-- ============================================
-- 1. ADDITIONAL TIERS
-- ============================================
INSERT INTO tiers (id, name, role_type, reward_amount) VALUES
  ('d0000001-0000-0000-0000-000000000001', 'Senior Agent', 'agent', 100.00),
  ('d0000001-0000-0000-0000-000000000002', 'Business Partner', 'business_partner', 75.00)
ON CONFLICT (name) DO NOTHING;

-- ============================================
-- 2. ADDITIONAL CAMPAIGNS
-- ============================================

-- Campaign 2: Active future campaign
INSERT INTO campaigns (id, name, start_date, end_date, venue, registration_type, status, checkout_config, max_headcount) VALUES
  ('c0000002-0000-0000-0000-000000000002',
   'April 2026 Career Fair',
   '2026-04-01', '2026-04-30',
   'Raffles City Convention Centre',
   'job_opportunity', 'active',
   '{"fb_enabled": true, "fb_url": "https://facebook.com/demo", "video_enabled": true, "video_url": "https://www.youtube.com/watch?v=dQw4w9WgXcQ", "rating_enabled": true}'::jsonb,
   200
  )
ON CONFLICT (id) DO NOTHING;

-- Campaign 3: Completed past campaign (for reports)
INSERT INTO campaigns (id, name, start_date, end_date, venue, registration_type, status) VALUES
  ('c0000003-0000-0000-0000-000000000003',
   'February 2026 Kickoff Event',
   '2026-02-01', '2026-02-28',
   'Suntec Singapore Convention Centre',
   'business_opportunity', 'completed'
  )
ON CONFLICT (id) DO NOTHING;

-- Campaign 4: Draft campaign
INSERT INTO campaigns (id, name, start_date, end_date, venue, registration_type, status) VALUES
  ('c0000004-0000-0000-0000-000000000004',
   'May 2026 Leadership Summit',
   '2026-05-10', '2026-05-12',
   'Marina Bay Sands Expo Hall',
   'business_opportunity', 'draft'
  )
ON CONFLICT (id) DO NOTHING;

-- Update existing March campaign with checkout_config (only if not already set)
UPDATE campaigns
SET checkout_config = '{"fb_enabled": true, "fb_url": "https://facebook.com/demo", "video_enabled": false, "video_url": "", "rating_enabled": true}'::jsonb
WHERE id = 'aaaa1111-1111-1111-1111-111111111111'
  AND checkout_config = '{}'::jsonb;

-- ============================================
-- 3. ADDITIONAL SLOTS
-- ============================================

-- Slots for April Career Fair
INSERT INTO slots (id, campaign_id, start_at, end_at, checkin_window_minutes, checkout_window_minutes, is_active, is_auto_card) VALUES
  ('e0000001-0000-0000-0000-000000000001',
   'c0000002-0000-0000-0000-000000000002',
   '2026-04-05 09:00:00+08', '2026-04-05 12:00:00+08',
   30, 30, true, true),
  ('e0000002-0000-0000-0000-000000000002',
   'c0000002-0000-0000-0000-000000000002',
   '2026-04-12 14:00:00+08', '2026-04-12 17:00:00+08',
   30, 30, true, false),
  ('e0000003-0000-0000-0000-000000000003',
   'c0000002-0000-0000-0000-000000000002',
   '2026-04-19 10:00:00+08', '2026-04-19 13:00:00+08',
   30, 30, true, true)
ON CONFLICT (id) DO NOTHING;

-- Slots for completed February campaign
INSERT INTO slots (id, campaign_id, start_at, end_at, checkin_window_minutes, checkout_window_minutes, is_active, is_auto_card) VALUES
  ('e0000004-0000-0000-0000-000000000004',
   'c0000003-0000-0000-0000-000000000003',
   '2026-02-10 09:00:00+08', '2026-02-10 12:00:00+08',
   30, 30, false, true),
  ('e0000005-0000-0000-0000-000000000005',
   'c0000003-0000-0000-0000-000000000003',
   '2026-02-20 14:00:00+08', '2026-02-20 17:00:00+08',
   30, 30, false, true)
ON CONFLICT (id) DO NOTHING;

-- Extra slot for March campaign
INSERT INTO slots (id, campaign_id, start_at, end_at, checkin_window_minutes, checkout_window_minutes, is_active, is_auto_card) VALUES
  ('e0000006-0000-0000-0000-000000000006',
   'aaaa1111-1111-1111-1111-111111111111',
   '2026-03-22 14:00:00+08', '2026-03-22 17:00:00+08',
   30, 30, true, true)
ON CONFLICT (id) DO NOTHING;

-- ============================================
-- 4. AGENT LINKS for Test Agent
-- ============================================

-- Links for April Career Fair slots
INSERT INTO agent_links (id, agent_id, slot_id, link_code, is_active) VALUES
  ('ab000001-0000-0000-0000-000000000001',
   'ca1b78e3-ae85-41ee-912a-d9a7cd70a345',
   'e0000001-0000-0000-0000-000000000001',
   'ac000001-0000-0000-0000-000000000001', true),
  ('ab000002-0000-0000-0000-000000000002',
   'ca1b78e3-ae85-41ee-912a-d9a7cd70a345',
   'e0000002-0000-0000-0000-000000000002',
   'ac000002-0000-0000-0000-000000000002', true),
  ('ab000003-0000-0000-0000-000000000003',
   'ca1b78e3-ae85-41ee-912a-d9a7cd70a345',
   'e0000003-0000-0000-0000-000000000003',
   'ac000003-0000-0000-0000-000000000003', true)
ON CONFLICT (id) DO NOTHING;

-- Links for completed February campaign
INSERT INTO agent_links (id, agent_id, slot_id, link_code, is_active) VALUES
  ('ab000004-0000-0000-0000-000000000004',
   'ca1b78e3-ae85-41ee-912a-d9a7cd70a345',
   'e0000004-0000-0000-0000-000000000004',
   'ac000004-0000-0000-0000-000000000004', false),
  ('ab000005-0000-0000-0000-000000000005',
   'ca1b78e3-ae85-41ee-912a-d9a7cd70a345',
   'e0000005-0000-0000-0000-000000000005',
   'ac000005-0000-0000-0000-000000000005', false)
ON CONFLICT (id) DO NOTHING;

-- Link for March extra slot
INSERT INTO agent_links (id, agent_id, slot_id, link_code, is_active) VALUES
  ('ab000006-0000-0000-0000-000000000006',
   'ca1b78e3-ae85-41ee-912a-d9a7cd70a345',
   'e0000006-0000-0000-0000-000000000006',
   'ac000006-0000-0000-0000-000000000006', true)
ON CONFLICT (id) DO NOTHING;

-- ============================================
-- 5. REGISTRATIONS (demo invitees)
-- ============================================

-- March campaign slot (existing) - 5 registrations
INSERT INTO registrations (id, agent_link_id, agent_id, slot_id, capacity_type, status, invitee_name, invitee_nric, invitee_phone, invitee_email, invitee_occupation, registered_at) VALUES
  ('f0000001-0000-0000-0000-000000000001',
   'cccc3333-3333-3333-3333-333333333333',
   'ca1b78e3-ae85-41ee-912a-d9a7cd70a345',
   'bbbb2222-2222-2222-2222-222222222222',
   'agent', 'registered',
   'Sarah Tan', 'S8812345A', '+6591001001', 'sarah.tan@email.com', 'Marketing Manager',
   '2026-03-10 09:00:00+08'),
  ('f0000002-0000-0000-0000-000000000002',
   'cccc3333-3333-3333-3333-333333333333',
   'ca1b78e3-ae85-41ee-912a-d9a7cd70a345',
   'bbbb2222-2222-2222-2222-222222222222',
   'agent', 'registered',
   'James Lim', 'S9023456B', '+6591002002', 'james.lim@email.com', 'Software Engineer',
   '2026-03-10 10:30:00+08'),
  ('f0000003-0000-0000-0000-000000000003',
   'cccc3333-3333-3333-3333-333333333333',
   'ca1b78e3-ae85-41ee-912a-d9a7cd70a345',
   'bbbb2222-2222-2222-2222-222222222222',
   'agent', 'registered',
   'Michelle Wong', 'S8534567C', '+6591003003', 'michelle.w@email.com', 'Accountant',
   '2026-03-11 14:00:00+08'),
  ('f0000004-0000-0000-0000-000000000004',
   'cccc3333-3333-3333-3333-333333333333',
   'ca1b78e3-ae85-41ee-912a-d9a7cd70a345',
   'bbbb2222-2222-2222-2222-222222222222',
   'agent', 'registered',
   'David Chen', 'S9145678D', '+6591004004', 'david.chen@email.com', 'Financial Advisor',
   '2026-03-12 08:15:00+08'),
  ('f0000005-0000-0000-0000-000000000005',
   'cccc3333-3333-3333-3333-333333333333',
   'ca1b78e3-ae85-41ee-912a-d9a7cd70a345',
   'bbbb2222-2222-2222-2222-222222222222',
   'agent', 'registered',
   'Rachel Goh', 'S8756789E', '+6591005005', 'rachel.goh@email.com', 'Teacher',
   '2026-03-12 16:45:00+08')
ON CONFLICT (id) DO NOTHING;

-- February completed campaign - 6 registrations (all completed)
INSERT INTO registrations (id, agent_link_id, agent_id, slot_id, capacity_type, status, invitee_name, invitee_nric, invitee_phone, invitee_email, invitee_occupation, registered_at) VALUES
  ('f0000010-0000-0000-0000-000000000010',
   'ab000004-0000-0000-0000-000000000004',
   'ca1b78e3-ae85-41ee-912a-d9a7cd70a345',
   'e0000004-0000-0000-0000-000000000004',
   'agent', 'completed',
   'Alice Ng', 'S8867890F', '+6592001001', 'alice.ng@email.com', 'Nurse',
   '2026-02-05 10:00:00+08'),
  ('f0000011-0000-0000-0000-000000000011',
   'ab000004-0000-0000-0000-000000000004',
   'ca1b78e3-ae85-41ee-912a-d9a7cd70a345',
   'e0000004-0000-0000-0000-000000000004',
   'agent', 'completed',
   'Benjamin Teo', 'S9078901G', '+6592002002', 'ben.teo@email.com', 'Banker',
   '2026-02-06 11:30:00+08'),
  ('f0000012-0000-0000-0000-000000000012',
   'ab000004-0000-0000-0000-000000000004',
   'ca1b78e3-ae85-41ee-912a-d9a7cd70a345',
   'e0000004-0000-0000-0000-000000000004',
   'agent', 'completed',
   'Catherine Lee', 'S8589012H', '+6592003003', 'cat.lee@email.com', 'Designer',
   '2026-02-07 09:00:00+08'),
  ('f0000013-0000-0000-0000-000000000013',
   'ab000005-0000-0000-0000-000000000005',
   'ca1b78e3-ae85-41ee-912a-d9a7cd70a345',
   'e0000005-0000-0000-0000-000000000005',
   'agent', 'completed',
   'Daniel Koh', 'S9190123I', '+6592004004', 'daniel.koh@email.com', 'Lawyer',
   '2026-02-15 14:00:00+08'),
  ('f0000014-0000-0000-0000-000000000014',
   'ab000005-0000-0000-0000-000000000005',
   'ca1b78e3-ae85-41ee-912a-d9a7cd70a345',
   'e0000005-0000-0000-0000-000000000005',
   'agent', 'completed',
   'Emily Tan', 'S8701234J', '+6592005005', 'emily.tan@email.com', 'Real Estate Agent',
   '2026-02-16 10:30:00+08'),
  ('f0000015-0000-0000-0000-000000000015',
   'ab000005-0000-0000-0000-000000000005',
   'ca1b78e3-ae85-41ee-912a-d9a7cd70a345',
   'e0000005-0000-0000-0000-000000000005',
   'agent', 'completed',
   'Frank Lim', 'S9212345K', '+6592006006', 'frank.lim@email.com', 'Insurance Agent',
   '2026-02-17 15:00:00+08')
ON CONFLICT (id) DO NOTHING;

-- April career fair - 3 early registrations
INSERT INTO registrations (id, agent_link_id, agent_id, slot_id, capacity_type, status, invitee_name, invitee_nric, invitee_phone, invitee_email, invitee_occupation, registered_at) VALUES
  ('f0000020-0000-0000-0000-000000000020',
   'ab000001-0000-0000-0000-000000000001',
   'ca1b78e3-ae85-41ee-912a-d9a7cd70a345',
   'e0000001-0000-0000-0000-000000000001',
   'agent', 'registered',
   'Grace Ong', 'S8823456L', '+6593001001', 'grace.ong@email.com', 'HR Manager',
   '2026-03-25 10:00:00+08'),
  ('f0000021-0000-0000-0000-000000000021',
   'ab000001-0000-0000-0000-000000000001',
   'ca1b78e3-ae85-41ee-912a-d9a7cd70a345',
   'e0000001-0000-0000-0000-000000000001',
   'agent', 'registered',
   'Henry Chua', 'S9034567M', '+6593002002', 'henry.chua@email.com', 'Project Manager',
   '2026-03-25 11:30:00+08'),
  ('f0000022-0000-0000-0000-000000000022',
   'ab000002-0000-0000-0000-000000000002',
   'ca1b78e3-ae85-41ee-912a-d9a7cd70a345',
   'e0000002-0000-0000-0000-000000000002',
   'agent', 'registered',
   'Irene Sim', 'S8545678N', '+6593003003', 'irene.sim@email.com', 'Pharmacist',
   '2026-03-26 09:00:00+08')
ON CONFLICT (id) DO NOTHING;

-- ============================================
-- 6. ATTENDANCE (for completed registrations)
-- ============================================

-- February campaign - all completed with full attendance
INSERT INTO attendance (id, registration_id, checkin_time, checkout_time, is_full_attendance, checkout_rating) VALUES
  ('a0000001-0000-0000-0000-000000000001',
   'f0000010-0000-0000-0000-000000000010',
   '2026-02-10 08:45:00+08', '2026-02-10 12:10:00+08', true, 5),
  ('a0000002-0000-0000-0000-000000000002',
   'f0000011-0000-0000-0000-000000000011',
   '2026-02-10 08:50:00+08', '2026-02-10 12:05:00+08', true, 4),
  ('a0000003-0000-0000-0000-000000000003',
   'f0000012-0000-0000-0000-000000000012',
   '2026-02-10 09:00:00+08', '2026-02-10 12:15:00+08', true, 5),
  ('a0000004-0000-0000-0000-000000000004',
   'f0000013-0000-0000-0000-000000000013',
   '2026-02-20 13:45:00+08', '2026-02-20 17:10:00+08', true, 4),
  ('a0000005-0000-0000-0000-000000000005',
   'f0000014-0000-0000-0000-000000000014',
   '2026-02-20 13:50:00+08', '2026-02-20 17:05:00+08', true, 3),
  ('a0000006-0000-0000-0000-000000000006',
   'f0000015-0000-0000-0000-000000000015',
   '2026-02-20 14:00:00+08', '2026-02-20 17:15:00+08', true, 5)
ON CONFLICT (id) DO NOTHING;

-- ============================================
-- 7. REWARDS (for completed attendance)
-- ============================================
INSERT INTO rewards (id, agent_id, attendance_id, amount, capacity_type, status) VALUES
  ('be000001-0000-0000-0000-000000000001',
   'ca1b78e3-ae85-41ee-912a-d9a7cd70a345',
   'a0000001-0000-0000-0000-000000000001',
   50.00, 'agent', 'paid'),
  ('be000002-0000-0000-0000-000000000002',
   'ca1b78e3-ae85-41ee-912a-d9a7cd70a345',
   'a0000002-0000-0000-0000-000000000002',
   50.00, 'agent', 'paid'),
  ('be000003-0000-0000-0000-000000000003',
   'ca1b78e3-ae85-41ee-912a-d9a7cd70a345',
   'a0000003-0000-0000-0000-000000000003',
   50.00, 'agent', 'confirmed'),
  ('be000004-0000-0000-0000-000000000004',
   'ca1b78e3-ae85-41ee-912a-d9a7cd70a345',
   'a0000004-0000-0000-0000-000000000004',
   50.00, 'agent', 'confirmed'),
  ('be000005-0000-0000-0000-000000000005',
   'ca1b78e3-ae85-41ee-912a-d9a7cd70a345',
   'a0000005-0000-0000-0000-000000000005',
   50.00, 'agent', 'pending'),
  ('be000006-0000-0000-0000-000000000006',
   'ca1b78e3-ae85-41ee-912a-d9a7cd70a345',
   'a0000006-0000-0000-0000-000000000006',
   50.00, 'agent', 'pending')
ON CONFLICT (id) DO NOTHING;

-- ============================================
-- DONE! Verify with:
-- ============================================
-- SELECT name, status FROM campaigns ORDER BY start_date;
-- SELECT count(*), status FROM registrations GROUP BY status;
-- SELECT count(*), status FROM rewards GROUP BY status;
