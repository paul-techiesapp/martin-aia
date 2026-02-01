-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Create enum types
CREATE TYPE invitation_type AS ENUM ('business_opportunity', 'job_opportunity');
CREATE TYPE campaign_status AS ENUM ('draft', 'active', 'paused', 'completed');
CREATE TYPE invitation_status AS ENUM ('pending', 'registered', 'attended', 'completed', 'expired');
CREATE TYPE capacity_type AS ENUM ('agent', 'business_partner');
CREATE TYPE role_type AS ENUM ('agent', 'business_partner');
CREATE TYPE agent_status AS ENUM ('active', 'inactive');
CREATE TYPE reward_status AS ENUM ('pending', 'confirmed', 'paid');

-- Campaigns table
CREATE TABLE campaigns (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name TEXT NOT NULL,
  start_date DATE NOT NULL,
  end_date DATE NOT NULL,
  venue TEXT NOT NULL,
  invitation_type invitation_type NOT NULL,
  status campaign_status NOT NULL DEFAULT 'draft',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT valid_dates CHECK (end_date >= start_date)
);

-- Slots table
CREATE TABLE slots (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  campaign_id UUID NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  day_of_week INTEGER NOT NULL CHECK (day_of_week >= 0 AND day_of_week <= 6),
  start_time TIME NOT NULL,
  end_time TIME NOT NULL,
  checkin_window_minutes INTEGER NOT NULL DEFAULT 30,
  checkout_window_minutes INTEGER NOT NULL DEFAULT 30,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT valid_times CHECK (end_time > start_time)
);

-- Tiers table
CREATE TABLE tiers (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name TEXT NOT NULL UNIQUE,
  role_type role_type NOT NULL,
  reward_amount DECIMAL(10, 2) NOT NULL CHECK (reward_amount >= 0),
  invitation_limit_per_slot INTEGER NOT NULL CHECK (invitation_limit_per_slot > 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Agents table
CREATE TABLE agents (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  phone TEXT NOT NULL UNIQUE,
  nric TEXT NOT NULL UNIQUE,
  agent_code TEXT NOT NULL UNIQUE,
  unit_name TEXT NOT NULL,
  tier_id UUID NOT NULL REFERENCES tiers(id),
  status agent_status NOT NULL DEFAULT 'active',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Invitations table
CREATE TABLE invitations (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  agent_id UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  slot_id UUID NOT NULL REFERENCES slots(id) ON DELETE CASCADE,
  capacity_type capacity_type NOT NULL,
  unique_token UUID NOT NULL UNIQUE DEFAULT uuid_generate_v4(),
  status invitation_status NOT NULL DEFAULT 'pending',
  invitee_name TEXT,
  invitee_nric TEXT,
  invitee_phone TEXT,
  invitee_email TEXT,
  invitee_occupation TEXT,
  registered_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Create unique partial indexes for invitee_nric and invitee_phone
-- Only enforce uniqueness when values are not null
CREATE UNIQUE INDEX invitations_invitee_nric_unique
  ON invitations(invitee_nric)
  WHERE invitee_nric IS NOT NULL;

CREATE UNIQUE INDEX invitations_invitee_phone_unique
  ON invitations(invitee_phone)
  WHERE invitee_phone IS NOT NULL;

-- PIN codes table
CREATE TABLE pin_codes (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  slot_id UUID NOT NULL REFERENCES slots(id) ON DELETE CASCADE,
  code TEXT NOT NULL,
  linked_nric TEXT,
  is_used BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(slot_id, code)
);

-- Attendance table
CREATE TABLE attendance (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  invitation_id UUID NOT NULL REFERENCES invitations(id) ON DELETE CASCADE,
  pin_code_id UUID NOT NULL REFERENCES pin_codes(id),
  checkin_time TIMESTAMPTZ NOT NULL,
  checkout_time TIMESTAMPTZ,
  is_full_attendance BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(invitation_id)
);

-- Rewards table
CREATE TABLE rewards (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  agent_id UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  attendance_id UUID NOT NULL REFERENCES attendance(id) ON DELETE CASCADE,
  amount DECIMAL(10, 2) NOT NULL,
  capacity_type capacity_type NOT NULL,
  status reward_status NOT NULL DEFAULT 'pending',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(attendance_id)
);

-- Create updated_at trigger function
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Apply updated_at triggers
CREATE TRIGGER campaigns_updated_at BEFORE UPDATE ON campaigns FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER slots_updated_at BEFORE UPDATE ON slots FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER tiers_updated_at BEFORE UPDATE ON tiers FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER agents_updated_at BEFORE UPDATE ON agents FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER invitations_updated_at BEFORE UPDATE ON invitations FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER pin_codes_updated_at BEFORE UPDATE ON pin_codes FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER attendance_updated_at BEFORE UPDATE ON attendance FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER rewards_updated_at BEFORE UPDATE ON rewards FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- Create indexes for common queries
CREATE INDEX idx_slots_campaign ON slots(campaign_id);
CREATE INDEX idx_agents_tier ON agents(tier_id);
CREATE INDEX idx_agents_user ON agents(user_id);
CREATE INDEX idx_invitations_agent ON invitations(agent_id);
CREATE INDEX idx_invitations_slot ON invitations(slot_id);
CREATE INDEX idx_invitations_token ON invitations(unique_token);
CREATE INDEX idx_pin_codes_slot ON pin_codes(slot_id);
CREATE INDEX idx_attendance_invitation ON attendance(invitation_id);
CREATE INDEX idx_rewards_agent ON rewards(agent_id);
