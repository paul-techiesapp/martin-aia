import {
  InvitationType,
  CampaignStatus,
  InvitationStatus,
  CapacityType,
  RoleType,
  AgentStatus,
  RewardStatus,
} from './enums';

export interface Campaign {
  id: string;
  name: string;
  start_date: string;
  end_date: string;
  venue: string;
  invitation_type: InvitationType;
  status: CampaignStatus;
  created_at: string;
  updated_at: string;
}

export interface Slot {
  id: string;
  campaign_id: string;
  day_of_week: number; // 0-6 (Sunday-Saturday)
  start_time: string; // HH:MM:SS
  end_time: string; // HH:MM:SS
  checkin_window_minutes: number;
  checkout_window_minutes: number;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface Tier {
  id: string;
  name: string;
  role_type: RoleType;
  reward_amount: number;
  invitation_limit_per_slot: number;
  created_at: string;
  updated_at: string;
}

export interface Agent {
  id: string;
  user_id: string;
  name: string;
  email: string;
  phone: string;
  nric: string;
  agent_code: string;
  unit_name: string;
  tier_id: string;
  status: AgentStatus;
  created_at: string;
  updated_at: string;
}

export interface Invitation {
  id: string;
  agent_id: string;
  slot_id: string;
  capacity_type: CapacityType;
  unique_token: string;
  status: InvitationStatus;
  invitee_name: string | null;
  invitee_nric: string | null;
  invitee_phone: string | null;
  invitee_email: string | null;
  invitee_occupation: string | null;
  registered_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface PinCode {
  id: string;
  slot_id: string;
  code: string;
  linked_nric: string | null;
  is_used: boolean;
  created_at: string;
  updated_at: string;
}

export interface Attendance {
  id: string;
  invitation_id: string;
  pin_code_id: string;
  checkin_time: string;
  checkout_time: string | null;
  is_full_attendance: boolean;
  created_at: string;
  updated_at: string;
}

export interface Reward {
  id: string;
  agent_id: string;
  attendance_id: string;
  amount: number;
  capacity_type: CapacityType;
  status: RewardStatus;
  created_at: string;
  updated_at: string;
}

// Extended types with relations
export interface SlotWithCampaign extends Slot {
  campaign: Campaign;
}

export interface AgentWithTier extends Agent {
  tier: Tier;
}

export interface InvitationWithRelations extends Invitation {
  agent: Agent;
  slot: SlotWithCampaign;
}

export interface AttendanceWithRelations extends Attendance {
  invitation: InvitationWithRelations;
  pin_code: PinCode;
}
