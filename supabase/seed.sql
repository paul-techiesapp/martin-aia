-- Seed data for Agent Onboarding System
-- Run with: npx supabase db reset

-- Ensure pgcrypto is available for password hashing
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- Create Admin User
INSERT INTO auth.users (
  id,
  instance_id,
  email,
  encrypted_password,
  email_confirmed_at,
  raw_app_meta_data,
  raw_user_meta_data,
  aud,
  role,
  created_at,
  updated_at,
  confirmation_token,
  recovery_token
) VALUES (
  'ccc34249-ccdc-4d78-8097-c5b68495b126',
  '00000000-0000-0000-0000-000000000000',
  'admin@test.com',
  crypt('@Abc1234', gen_salt('bf')),
  NOW(),
  '{"provider": "email", "providers": ["email"]}',
  '{"role": "admin"}',
  'authenticated',
  'authenticated',
  NOW(),
  NOW(),
  '',
  ''
);

-- Create Agent User
INSERT INTO auth.users (
  id,
  instance_id,
  email,
  encrypted_password,
  email_confirmed_at,
  raw_app_meta_data,
  raw_user_meta_data,
  aud,
  role,
  created_at,
  updated_at,
  confirmation_token,
  recovery_token
) VALUES (
  '8ef27711-ad8b-42ba-b5d3-864f77fa17e8',
  '00000000-0000-0000-0000-000000000000',
  'agent@test.com',
  crypt('@Abc1234', gen_salt('bf')),
  NOW(),
  '{"provider": "email", "providers": ["email"]}',
  '{"role": "agent"}',
  'authenticated',
  'authenticated',
  NOW(),
  NOW(),
  '',
  ''
);

-- Add identity for admin user (required for email login)
INSERT INTO auth.identities (
  id,
  user_id,
  provider_id,
  identity_data,
  provider,
  last_sign_in_at,
  created_at,
  updated_at
) VALUES (
  'a1111111-1111-1111-1111-111111111111',
  'ccc34249-ccdc-4d78-8097-c5b68495b126',
  'admin@test.com',
  '{"sub": "ccc34249-ccdc-4d78-8097-c5b68495b126", "email": "admin@test.com", "email_verified": true}',
  'email',
  NOW(),
  NOW(),
  NOW()
);

-- Add identity for agent user (required for email login)
INSERT INTO auth.identities (
  id,
  user_id,
  provider_id,
  identity_data,
  provider,
  last_sign_in_at,
  created_at,
  updated_at
) VALUES (
  'b2222222-2222-2222-2222-222222222222',
  '8ef27711-ad8b-42ba-b5d3-864f77fa17e8',
  'agent@test.com',
  '{"sub": "8ef27711-ad8b-42ba-b5d3-864f77fa17e8", "email": "agent@test.com", "email_verified": true}',
  'email',
  NOW(),
  NOW(),
  NOW()
);

-- Create default tier for agents
INSERT INTO tiers (id, name, role_type, reward_amount, invitation_limit_per_slot)
VALUES (
  'f669fbc3-94ea-46ed-bfc5-a24e669ec337',
  'Standard Agent',
  'agent',
  50.00,
  10
);

-- Create agent record for agent@test.com
INSERT INTO agents (
  id,
  user_id,
  name,
  email,
  phone,
  nric,
  agent_code,
  unit_name,
  tier_id,
  status
) VALUES (
  'ca1b78e3-ae85-41ee-912a-d9a7cd70a345',
  '8ef27711-ad8b-42ba-b5d3-864f77fa17e8',
  'Test Agent',
  'agent@test.com',
  '+6591234567',
  'S1234567A',
  'AGT001',
  'Test Unit',
  'f669fbc3-94ea-46ed-bfc5-a24e669ec337',
  'active'
);

-- Create a sample campaign
INSERT INTO campaigns (id, name, start_date, end_date, venue, registration_type, status)
VALUES (
  'aaaa1111-1111-1111-1111-111111111111',
  'March 2026 Recruitment Drive',
  '2026-03-01',
  '2026-03-31',
  'Marina Bay Sands Convention Centre',
  'business_opportunity',
  'active'
);

-- Create a sample slot for the campaign
INSERT INTO slots (id, campaign_id, start_at, end_at, checkin_window_minutes, checkout_window_minutes, is_active)
VALUES (
  'bbbb2222-2222-2222-2222-222222222222',
  'aaaa1111-1111-1111-1111-111111111111',
  '2026-03-15 10:00:00+08',
  '2026-03-15 13:00:00+08',
  30,
  30,
  true
);

-- Create an agent_link for the test agent on the sample slot
INSERT INTO agent_links (id, agent_id, slot_id, link_code, is_active)
VALUES (
  'cccc3333-3333-3333-3333-333333333333',
  'ca1b78e3-ae85-41ee-912a-d9a7cd70a345',
  'bbbb2222-2222-2222-2222-222222222222',
  'dddd4444-4444-4444-4444-444444444444',
  true
);
