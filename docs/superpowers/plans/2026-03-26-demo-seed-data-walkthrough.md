# Demo Seed Data & Production Walkthrough Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Insert realistic demo data into production Supabase and verify all three portals work end-to-end on Render.

**Architecture:** Direct SQL inserts against production Supabase (bypassing RPC functions to create diverse data states). Browser walkthrough of all three Render-hosted portals to verify the complete user journey.

**Tech Stack:** PostgreSQL (Supabase), Chrome browser, production Render static sites

**Production URLs:**
- Admin: https://martin-admin-portal.onrender.com
- Agent: https://martin-agent-portal.onrender.com
- Public: https://martin-public-pages.onrender.com
- Supabase Dashboard: https://supabase.com/dashboard/project/wictbtiulqmzzneyoelv

**Test Credentials:**
- Admin: `admin@test.com` / `@Abc1234`
- Agent: `agent@test.com` / `@Abc1234`

---

## File Structure

| Action | File | Purpose |
|--------|------|---------|
| Create | `supabase/seed-demo.sql` | Production demo seed data script |

---

### Task 1: Create Demo Seed Data SQL Script

**Files:**
- Create: `supabase/seed-demo.sql`

**Context:** The production DB already has:
- Auth users: `admin@test.com` (admin), `agent@test.com` (agent)
- Tier: `Standard Agent` (id: `f669fbc3-94ea-46ed-bfc5-a24e669ec337`, $50, 10 invites/slot)
- Agent: `Test Agent` / AGT001 (id: `ca1b78e3-ae85-41ee-912a-d9a7cd70a345`)
- Campaign: `March 2026 Recruitment Drive` (id: `aaaa1111-1111-1111-1111-111111111111`)
- Slot: March 15 10:00-13:00 (id: `bbbb2222-2222-2222-2222-222222222222`)
- Agent Link: for Test Agent on that slot (id: `cccc3333-3333-3333-3333-333333333333`)

We need to add richer data for a convincing demo.

- [ ] **Step 1: Write the seed-demo.sql script**

```sql
-- ============================================================
-- DEMO SEED DATA for Production
-- Run via Supabase Dashboard SQL Editor
-- ============================================================
-- IMPORTANT: This script is IDEMPOTENT - uses ON CONFLICT DO NOTHING
-- Safe to run multiple times without duplicating data.
-- ============================================================

-- ============================================
-- 1. ADDITIONAL TIERS
-- ============================================
INSERT INTO tiers (id, name, role_type, reward_amount, invitation_limit_per_slot) VALUES
  ('t0000001-0000-0000-0000-000000000001', 'Senior Agent', 'agent', 100.00, 20),
  ('t0000001-0000-0000-0000-000000000002', 'Business Partner', 'business_partner', 75.00, 15)
ON CONFLICT (name) DO NOTHING;

-- ============================================
-- 2. ADDITIONAL CAMPAIGNS
-- ============================================

-- Campaign 2: Active future campaign
INSERT INTO campaigns (id, name, start_date, end_date, venue, registration_type, status, checkout_config) VALUES
  ('c0000002-0000-0000-0000-000000000002',
   'April 2026 Career Fair',
   '2026-04-01', '2026-04-30',
   'Raffles City Convention Centre',
   'job_opportunity', 'active',
   '{"fb_enabled": true, "fb_url": "https://facebook.com/demo", "video_enabled": true, "video_url": "https://www.youtube.com/watch?v=dQw4w9WgXcQ", "rating_enabled": true}'::jsonb
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

-- Update existing March campaign with checkout_config
UPDATE campaigns
SET checkout_config = '{"fb_enabled": true, "fb_url": "https://facebook.com/demo", "video_enabled": false, "video_url": "", "rating_enabled": true}'::jsonb
WHERE id = 'aaaa1111-1111-1111-1111-111111111111'
  AND checkout_config = '{}'::jsonb;

-- ============================================
-- 3. ADDITIONAL SLOTS
-- ============================================

-- Slots for April Career Fair
INSERT INTO slots (id, campaign_id, start_at, end_at, checkin_window_minutes, checkout_window_minutes, is_active, is_auto_card) VALUES
  ('s0000001-0000-0000-0000-000000000001',
   'c0000002-0000-0000-0000-000000000002',
   '2026-04-05 09:00:00+08', '2026-04-05 12:00:00+08',
   30, 30, true, true),
  ('s0000002-0000-0000-0000-000000000002',
   'c0000002-0000-0000-0000-000000000002',
   '2026-04-12 14:00:00+08', '2026-04-12 17:00:00+08',
   30, 30, true, false),
  ('s0000003-0000-0000-0000-000000000003',
   'c0000002-0000-0000-0000-000000000002',
   '2026-04-19 10:00:00+08', '2026-04-19 13:00:00+08',
   30, 30, true, true)
ON CONFLICT (id) DO NOTHING;

-- Slots for completed February campaign
INSERT INTO slots (id, campaign_id, start_at, end_at, checkin_window_minutes, checkout_window_minutes, is_active, is_auto_card) VALUES
  ('s0000004-0000-0000-0000-000000000004',
   'c0000003-0000-0000-0000-000000000003',
   '2026-02-10 09:00:00+08', '2026-02-10 12:00:00+08',
   30, 30, false, true),
  ('s0000005-0000-0000-0000-000000000005',
   'c0000003-0000-0000-0000-000000000003',
   '2026-02-20 14:00:00+08', '2026-02-20 17:00:00+08',
   30, 30, false, true)
ON CONFLICT (id) DO NOTHING;

-- Extra slot for March campaign
INSERT INTO slots (id, campaign_id, start_at, end_at, checkin_window_minutes, checkout_window_minutes, is_active, is_auto_card) VALUES
  ('s0000006-0000-0000-0000-000000000006',
   'aaaa1111-1111-1111-1111-111111111111',
   '2026-03-22 14:00:00+08', '2026-03-22 17:00:00+08',
   30, 30, true, true)
ON CONFLICT (id) DO NOTHING;

-- ============================================
-- 4. AGENT LINKS for Test Agent
-- ============================================
-- Links for April Career Fair slots
INSERT INTO agent_links (id, agent_id, slot_id, link_code, is_active) VALUES
  ('al000001-0000-0000-0000-000000000001',
   'ca1b78e3-ae85-41ee-912a-d9a7cd70a345',
   's0000001-0000-0000-0000-000000000001',
   'ac000001-0000-0000-0000-000000000001', true),
  ('al000002-0000-0000-0000-000000000002',
   'ca1b78e3-ae85-41ee-912a-d9a7cd70a345',
   's0000002-0000-0000-0000-000000000002',
   'ac000002-0000-0000-0000-000000000002', true),
  ('al000003-0000-0000-0000-000000000003',
   'ca1b78e3-ae85-41ee-912a-d9a7cd70a345',
   's0000003-0000-0000-0000-000000000003',
   'ac000003-0000-0000-0000-000000000003', true)
ON CONFLICT (id) DO NOTHING;

-- Links for completed February campaign
INSERT INTO agent_links (id, agent_id, slot_id, link_code, is_active) VALUES
  ('al000004-0000-0000-0000-000000000004',
   'ca1b78e3-ae85-41ee-912a-d9a7cd70a345',
   's0000004-0000-0000-0000-000000000004',
   'ac000004-0000-0000-0000-000000000004', false),
  ('al000005-0000-0000-0000-000000000005',
   'ca1b78e3-ae85-41ee-912a-d9a7cd70a345',
   's0000005-0000-0000-0000-000000000005',
   'ac000005-0000-0000-0000-000000000005', false)
ON CONFLICT (id) DO NOTHING;

-- Link for March extra slot
INSERT INTO agent_links (id, agent_id, slot_id, link_code, is_active) VALUES
  ('al000006-0000-0000-0000-000000000006',
   'ca1b78e3-ae85-41ee-912a-d9a7cd70a345',
   's0000006-0000-0000-0000-000000000006',
   'ac000006-0000-0000-0000-000000000006', true)
ON CONFLICT (id) DO NOTHING;

-- ============================================
-- 5. REGISTRATIONS (demo invitees)
-- ============================================

-- March campaign slot (existing) - 5 registrations in various states
INSERT INTO registrations (id, agent_link_id, agent_id, slot_id, capacity_type, status, invitee_name, invitee_nric, invitee_phone, invitee_email, invitee_occupation, registered_at) VALUES
  ('r0000001-0000-0000-0000-000000000001',
   'cccc3333-3333-3333-3333-333333333333',
   'ca1b78e3-ae85-41ee-912a-d9a7cd70a345',
   'bbbb2222-2222-2222-2222-222222222222',
   'agent', 'registered',
   'Sarah Tan', 'S8812345A', '+6591001001', 'sarah.tan@email.com', 'Marketing Manager',
   '2026-03-10 09:00:00+08'),
  ('r0000002-0000-0000-0000-000000000002',
   'cccc3333-3333-3333-3333-333333333333',
   'ca1b78e3-ae85-41ee-912a-d9a7cd70a345',
   'bbbb2222-2222-2222-2222-222222222222',
   'agent', 'registered',
   'James Lim', 'S9023456B', '+6591002002', 'james.lim@email.com', 'Software Engineer',
   '2026-03-10 10:30:00+08'),
  ('r0000003-0000-0000-0000-000000000003',
   'cccc3333-3333-3333-3333-333333333333',
   'ca1b78e3-ae85-41ee-912a-d9a7cd70a345',
   'bbbb2222-2222-2222-2222-222222222222',
   'agent', 'registered',
   'Michelle Wong', 'S8534567C', '+6591003003', 'michelle.w@email.com', 'Accountant',
   '2026-03-11 14:00:00+08'),
  ('r0000004-0000-0000-0000-000000000004',
   'cccc3333-3333-3333-3333-333333333333',
   'ca1b78e3-ae85-41ee-912a-d9a7cd70a345',
   'bbbb2222-2222-2222-2222-222222222222',
   'agent', 'registered',
   'David Chen', 'S9145678D', '+6591004004', 'david.chen@email.com', 'Financial Advisor',
   '2026-03-12 08:15:00+08'),
  ('r0000005-0000-0000-0000-000000000005',
   'cccc3333-3333-3333-3333-333333333333',
   'ca1b78e3-ae85-41ee-912a-d9a7cd70a345',
   'bbbb2222-2222-2222-2222-222222222222',
   'agent', 'registered',
   'Rachel Goh', 'S8756789E', '+6591005005', 'rachel.goh@email.com', 'Teacher',
   '2026-03-12 16:45:00+08')
ON CONFLICT (id) DO NOTHING;

-- February completed campaign - 6 registrations (all completed)
INSERT INTO registrations (id, agent_link_id, agent_id, slot_id, capacity_type, status, invitee_name, invitee_nric, invitee_phone, invitee_email, invitee_occupation, registered_at) VALUES
  ('r0000010-0000-0000-0000-000000000010',
   'al000004-0000-0000-0000-000000000004',
   'ca1b78e3-ae85-41ee-912a-d9a7cd70a345',
   's0000004-0000-0000-0000-000000000004',
   'agent', 'completed',
   'Alice Ng', 'S8867890F', '+6592001001', 'alice.ng@email.com', 'Nurse',
   '2026-02-05 10:00:00+08'),
  ('r0000011-0000-0000-0000-000000000011',
   'al000004-0000-0000-0000-000000000004',
   'ca1b78e3-ae85-41ee-912a-d9a7cd70a345',
   's0000004-0000-0000-0000-000000000004',
   'agent', 'completed',
   'Benjamin Teo', 'S9078901G', '+6592002002', 'ben.teo@email.com', 'Banker',
   '2026-02-06 11:30:00+08'),
  ('r0000012-0000-0000-0000-000000000012',
   'al000004-0000-0000-0000-000000000004',
   'ca1b78e3-ae85-41ee-912a-d9a7cd70a345',
   's0000004-0000-0000-0000-000000000004',
   'agent', 'completed',
   'Catherine Lee', 'S8589012H', '+6592003003', 'cat.lee@email.com', 'Designer',
   '2026-02-07 09:00:00+08'),
  ('r0000013-0000-0000-0000-000000000013',
   'al000005-0000-0000-0000-000000000005',
   'ca1b78e3-ae85-41ee-912a-d9a7cd70a345',
   's0000005-0000-0000-0000-000000000005',
   'agent', 'completed',
   'Daniel Koh', 'S9190123I', '+6592004004', 'daniel.koh@email.com', 'Lawyer',
   '2026-02-15 14:00:00+08'),
  ('r0000014-0000-0000-0000-000000000014',
   'al000005-0000-0000-0000-000000000005',
   'ca1b78e3-ae85-41ee-912a-d9a7cd70a345',
   's0000005-0000-0000-0000-000000000005',
   'agent', 'completed',
   'Emily Tan', 'S8701234J', '+6592005005', 'emily.tan@email.com', 'Real Estate Agent',
   '2026-02-16 10:30:00+08'),
  ('r0000015-0000-0000-0000-000000000015',
   'al000005-0000-0000-0000-000000000005',
   'ca1b78e3-ae85-41ee-912a-d9a7cd70a345',
   's0000005-0000-0000-0000-000000000005',
   'agent', 'completed',
   'Frank Lim', 'S9212345K', '+6592006006', 'frank.lim@email.com', 'Insurance Agent',
   '2026-02-17 15:00:00+08')
ON CONFLICT (id) DO NOTHING;

-- April career fair - 3 early registrations
INSERT INTO registrations (id, agent_link_id, agent_id, slot_id, capacity_type, status, invitee_name, invitee_nric, invitee_phone, invitee_email, invitee_occupation, registered_at) VALUES
  ('r0000020-0000-0000-0000-000000000020',
   'al000001-0000-0000-0000-000000000001',
   'ca1b78e3-ae85-41ee-912a-d9a7cd70a345',
   's0000001-0000-0000-0000-000000000001',
   'agent', 'registered',
   'Grace Ong', 'S8823456L', '+6593001001', 'grace.ong@email.com', 'HR Manager',
   '2026-03-25 10:00:00+08'),
  ('r0000021-0000-0000-0000-000000000021',
   'al000001-0000-0000-0000-000000000001',
   'ca1b78e3-ae85-41ee-912a-d9a7cd70a345',
   's0000001-0000-0000-0000-000000000001',
   'agent', 'registered',
   'Henry Chua', 'S9034567M', '+6593002002', 'henry.chua@email.com', 'Project Manager',
   '2026-03-25 11:30:00+08'),
  ('r0000022-0000-0000-0000-000000000022',
   'al000002-0000-0000-0000-000000000002',
   'ca1b78e3-ae85-41ee-912a-d9a7cd70a345',
   's0000002-0000-0000-0000-000000000002',
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
   'r0000010-0000-0000-0000-000000000010',
   '2026-02-10 08:45:00+08', '2026-02-10 12:10:00+08', true, 5),
  ('a0000002-0000-0000-0000-000000000002',
   'r0000011-0000-0000-0000-000000000011',
   '2026-02-10 08:50:00+08', '2026-02-10 12:05:00+08', true, 4),
  ('a0000003-0000-0000-0000-000000000003',
   'r0000012-0000-0000-0000-000000000012',
   '2026-02-10 09:00:00+08', '2026-02-10 12:15:00+08', true, 5),
  ('a0000004-0000-0000-0000-000000000004',
   'r0000013-0000-0000-0000-000000000013',
   '2026-02-20 13:45:00+08', '2026-02-20 17:10:00+08', true, 4),
  ('a0000005-0000-0000-0000-000000000005',
   'r0000014-0000-0000-0000-000000000014',
   '2026-02-20 13:50:00+08', '2026-02-20 17:05:00+08', true, 3),
  ('a0000006-0000-0000-0000-000000000006',
   'r0000015-0000-0000-0000-000000000015',
   '2026-02-20 14:00:00+08', '2026-02-20 17:15:00+08', true, 5)
ON CONFLICT (id) DO NOTHING;

-- ============================================
-- 7. REWARDS (for completed attendance)
-- ============================================
INSERT INTO rewards (id, agent_id, attendance_id, amount, capacity_type, status) VALUES
  ('rw000001-0000-0000-0000-000000000001',
   'ca1b78e3-ae85-41ee-912a-d9a7cd70a345',
   'a0000001-0000-0000-0000-000000000001',
   50.00, 'agent', 'paid'),
  ('rw000002-0000-0000-0000-000000000002',
   'ca1b78e3-ae85-41ee-912a-d9a7cd70a345',
   'a0000002-0000-0000-0000-000000000002',
   50.00, 'agent', 'paid'),
  ('rw000003-0000-0000-0000-000000000003',
   'ca1b78e3-ae85-41ee-912a-d9a7cd70a345',
   'a0000003-0000-0000-0000-000000000003',
   50.00, 'agent', 'confirmed'),
  ('rw000004-0000-0000-0000-000000000004',
   'ca1b78e3-ae85-41ee-912a-d9a7cd70a345',
   'a0000004-0000-0000-0000-000000000004',
   50.00, 'agent', 'confirmed'),
  ('rw000005-0000-0000-0000-000000000005',
   'ca1b78e3-ae85-41ee-912a-d9a7cd70a345',
   'a0000005-0000-0000-0000-000000000005',
   50.00, 'agent', 'pending'),
  ('rw000006-0000-0000-0000-000000000006',
   'ca1b78e3-ae85-41ee-912a-d9a7cd70a345',
   'a0000006-0000-0000-0000-000000000006',
   50.00, 'agent', 'pending')
ON CONFLICT (id) DO NOTHING;
```

- [ ] **Step 2: Verify script has no syntax errors**

Run: Copy the SQL into Supabase Dashboard SQL Editor and use "Validate" (or just visually check the script for balanced quotes, correct UUID format, valid enum values).

Expected: No syntax errors. All UUIDs follow `xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx` format. All enum values match: `agent`/`business_partner`, `registered`/`completed`, `pending`/`confirmed`/`paid`.

---

### Task 2: Run Seed Data Against Production Supabase

**Prerequisites:** Task 1 complete

- [ ] **Step 1: Open Supabase SQL Editor**

Navigate to: https://supabase.com/dashboard/project/wictbtiulqmzzneyoelv/sql/new

- [ ] **Step 2: Check existing data first**

Run these queries to see what already exists:

```sql
SELECT id, name, status FROM campaigns ORDER BY created_at;
SELECT id, name, role_type, reward_amount FROM tiers ORDER BY name;
SELECT id, name, agent_code, status FROM agents ORDER BY name;
SELECT count(*) as reg_count FROM registrations;
SELECT count(*) as att_count FROM attendance;
SELECT count(*) as rew_count FROM rewards;
```

Expected: At minimum the March campaign, Standard Agent tier, and Test Agent should exist. Record the counts for comparison after insert.

- [ ] **Step 3: Run the seed-demo.sql script**

Paste the full contents of `supabase/seed-demo.sql` into the SQL Editor and execute.

Expected: All INSERT statements succeed. ON CONFLICT DO NOTHING prevents duplicates.

- [ ] **Step 4: Verify data was inserted**

```sql
SELECT id, name, status FROM campaigns ORDER BY start_date;
-- Expected: 4 rows (Feb completed, March active, April active, May draft)

SELECT id, name, role_type, reward_amount FROM tiers ORDER BY reward_amount;
-- Expected: 3 rows (Standard $50, BP $75, Senior $100)

SELECT count(*) as total, status FROM registrations GROUP BY status;
-- Expected: registered ~11, completed ~6

SELECT count(*) FROM attendance;
-- Expected: 6

SELECT count(*), status FROM rewards GROUP BY status;
-- Expected: paid 2, confirmed 2, pending 2
```

- [ ] **Step 5: Commit the seed file**

```bash
git add supabase/seed-demo.sql
git commit -m "feat: add production demo seed data script"
```

---

### Task 3: Walkthrough — Admin Portal

**URL:** https://martin-admin-portal.onrender.com

- [ ] **Step 1: Login as admin**

Navigate to login page. Enter:
- Email: `admin@test.com`
- Password: `@Abc1234`

Expected: Redirects to dashboard.

- [ ] **Step 2: Verify Dashboard**

Check that the dashboard loads and shows summary stats (campaigns, agents, attendance).

Expected: Dashboard renders without errors. Stats cards should show non-zero numbers.

- [ ] **Step 3: Browse Campaigns list**

Navigate to `/campaigns`.

Expected: See 4 campaigns:
| Campaign | Status | Dates |
|----------|--------|-------|
| February 2026 Kickoff Event | completed | Feb 1-28 |
| March 2026 Recruitment Drive | active | Mar 1-31 |
| April 2026 Career Fair | active | Apr 1-30 |
| May 2026 Leadership Summit | draft | May 10-12 |

- [ ] **Step 4: View Campaign Detail — March campaign**

Click into "March 2026 Recruitment Drive".

Expected:
- Campaign details (venue: Marina Bay Sands Convention Centre)
- 2 slots listed (Mar 15, Mar 22)
- Registrations table shows 5 registered invitees for the Mar 15 slot
- Checkout config should show rating enabled

- [ ] **Step 5: View Campaign Detail — April campaign**

Click into "April 2026 Career Fair".

Expected:
- 3 slots listed (Apr 5, 12, 19)
- 3 registrations across slots
- Checkout config shows video + rating + FB enabled

- [ ] **Step 6: View Campaign Detail — February (completed)**

Click into "February 2026 Kickoff Event".

Expected:
- 2 slots (both inactive)
- 6 completed registrations
- All registrations show "completed" status

- [ ] **Step 7: View Agents page**

Navigate to `/agents`.

Expected: At least Test Agent (AGT001) listed with Standard Agent tier. Status: active.

- [ ] **Step 8: View Tiers page**

Navigate to `/tiers`.

Expected: 3 tiers listed:
| Tier | Type | Reward | Invite Limit |
|------|------|--------|-------------|
| Standard Agent | agent | $50 | 10 |
| Senior Agent | agent | $100 | 20 |
| Business Partner | business_partner | $75 | 15 |

- [ ] **Step 9: View Reports page**

Navigate to `/reports`.

Expected: Reports page renders with charts/tables showing:
- Attendance data from February campaign
- Registration data across campaigns
- Reward distribution data (pending/confirmed/paid)

- [ ] **Step 10: Screenshot key pages for reference**

Take screenshots of: Dashboard, Campaigns list, a Campaign detail page, Reports page.

---

### Task 4: Walkthrough — Agent Portal

**URL:** https://martin-agent-portal.onrender.com

- [ ] **Step 1: Login as agent**

Navigate to login page. Enter:
- Email: `agent@test.com`
- Password: `@Abc1234`

Expected: Redirects to agent dashboard.

- [ ] **Step 2: View Dashboard**

Expected: Dashboard shows welcome message and summary stats for Test Agent.

- [ ] **Step 3: Browse My Links page**

Navigate to `/my-links`.

Expected:
- Links across multiple campaigns/slots visible
- Active links for March and April campaigns
- Inactive links for February (completed) campaign
- Registration counts shown per link (e.g., "5/10 registered")

- [ ] **Step 4: Copy a registration link**

Find an active link (e.g., April 5 slot) and click Copy Link.

Expected: Link copied to clipboard in format: `https://martin-public-pages.onrender.com/public/register/{linkCode}`

Save this link — we'll use it in Task 5.

- [ ] **Step 5: View Rewards page**

Navigate to `/rewards`.

Expected:
- 6 reward entries from February campaign
- Mix of statuses: 2 paid ($100 total), 2 confirmed ($100), 2 pending ($100)
- Total earnings visible: $300

- [ ] **Step 6: View Campaigns page**

Navigate to `/campaigns`.

Expected: Active campaigns visible (March, April). Completed campaigns may or may not show depending on filtering.

---

### Task 5: Walkthrough — Public Pages (Live Registration Test)

**URL:** https://martin-public-pages.onrender.com

- [ ] **Step 1: Open a registration link**

Use the link copied from Task 4 Step 4. Format:
`https://martin-public-pages.onrender.com/public/register/ac000001-0000-0000-0000-000000000001`

(Use the April 5 slot link code)

Expected: Registration page loads showing:
- Campaign: "April 2026 Career Fair"
- Venue: Raffles City Convention Centre
- Date/time: April 5, 2026 9:00 AM - 12:00 PM
- Registration form with fields: Name, NRIC, Phone, Email, Occupation

- [ ] **Step 2: Fill in the registration form**

Enter demo data:
- Full Name: `Demo Visitor`
- NRIC: `S9999999Z`
- Phone: `+6599999999`
- Email: `demo@test.com`
- Occupation: `Demo Tester`
- Accept Terms & Conditions

- [ ] **Step 3: Submit registration**

Click Register.

Expected: Success page shows:
- Green checkmark
- "Registration Successful!"
- Campaign name and slot time
- Venue information

- [ ] **Step 4: Verify registration in admin portal**

Go back to Admin Portal → April 2026 Career Fair → Apr 5 slot.

Expected: "Demo Visitor" appears in registrations list with status "registered".

- [ ] **Step 5: Test duplicate prevention**

Try registering again with the same NRIC or phone on the same slot.

Expected: Error message — "NRIC already registered for this slot" or "Phone already registered for this slot".

- [ ] **Step 6: Test landing page**

Navigate to: `https://martin-public-pages.onrender.com/`

Expected: Landing/welcome page renders without errors.

---

### Task 6: Verify Edge Functions

- [ ] **Step 1: Check edge function deployment status**

Navigate to Supabase Dashboard → Edge Functions.

Expected: These functions should be deployed:
- `generate-qr-token`
- `verify-qr-token`
- `send-checkout-otp`
- `verify-checkout-otp`
- `submit-checkout-rating`
- `create-partner`
- `deactivate-partner`
- `send-email-reminders`

- [ ] **Step 2: Note any functions not yet deployed**

Record which functions are missing and need deployment.

---

### Task 7: Clean Up Demo Data (Optional)

If you need to reset and re-run, this script removes all demo-inserted data:

```sql
-- WARNING: Removes all demo data. Run only if you need a clean slate.
DELETE FROM rewards WHERE id::text LIKE 'rw%';
DELETE FROM attendance WHERE id::text LIKE 'a0%';
DELETE FROM registrations WHERE id::text LIKE 'r0%';
DELETE FROM agent_links WHERE id::text LIKE 'al%';
DELETE FROM slots WHERE id::text LIKE 's0%';
DELETE FROM campaigns WHERE id IN (
  'c0000002-0000-0000-0000-000000000002',
  'c0000003-0000-0000-0000-000000000003',
  'c0000004-0000-0000-0000-000000000004'
);
DELETE FROM tiers WHERE id LIKE 't0%';
```

---

## Demo Data Summary

After running the seed script, the production system will contain:

| Entity | Count | Notes |
|--------|-------|-------|
| Campaigns | 4 | 1 completed, 2 active, 1 draft |
| Tiers | 3 | Standard ($50), Senior ($100), BP ($75) |
| Agents | 1 | Test Agent (AGT001) |
| Slots | 7 | 2 inactive (Feb), 5 active (Mar/Apr) |
| Agent Links | 7 | 2 inactive (Feb), 5 active (Mar/Apr) |
| Registrations | 14 | 8 registered, 6 completed |
| Attendance | 6 | All from Feb campaign, full attendance |
| Rewards | 6 | 2 paid, 2 confirmed, 2 pending |

## Demo Walkthrough Script (Quick Version)

**For a 5-minute demo:**

1. **Admin Portal** → Login → Show campaigns list (4 campaigns in different states) → Click into active campaign → Show registrations → Show Reports page with charts
2. **Agent Portal** → Login → My Links (show link management) → Copy a link → Show Rewards page
3. **Public Pages** → Open copied link → Show registration form → Register a new person → Show success page
4. **Back to Admin** → Refresh campaign detail → Show new registration appeared in real-time
