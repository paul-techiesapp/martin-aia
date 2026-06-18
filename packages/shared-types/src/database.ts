import {
  InvitationType,
  CampaignStatus,
  InvitationStatus,
  RegistrationStatus,
  CapacityType,
  RoleType,
  AgentStatus,
  RewardStatus,
} from './enums';

export interface CheckoutConfig {
  fb_enabled: boolean;
  fb_url: string;
  video_enabled: boolean;
  video_url: string;
  rating_enabled: boolean;
}

export interface CompanyBranding {
  companyName: string;
  logoUrl: string | null;
  logoWidth: number;
}

export interface CardTemplate {
  panelColor: string;
  panelTextColor: string;
  accentColor: string;
  fontFamily: string;
  titleFontSize: number;
  bodyFontSize: number;
  subtitle: string;
  instructionText: string;
  visibleElements: string[];
  elementOrder: string[];
  qrColor: string;
  qrSize: number;
}

export interface SystemSettings {
  id: string;
  company_branding: CompanyBranding;
  card_template: CardTemplate;
  updated_at: string;
}

export const DEFAULT_CARD_TEMPLATE: CardTemplate = {
  panelColor: '#0f172a',
  panelTextColor: '#ffffff',
  accentColor: '#daa520',
  fontFamily: 'helvetica',
  titleFontSize: 14,
  bodyFontSize: 9,
  subtitle: 'Event Invitation',
  instructionText: 'Present this card at the event for check-in',
  visibleElements: ['logo', 'subtitle', 'date', 'campaign', 'venue', 'qr', 'invitee', 'instruction', 'reference'],
  elementOrder: ['campaign', 'venue', 'qr', 'invitee', 'instruction', 'reference'],
  qrColor: '#0f172a',
  qrSize: 25,
};

export const DEFAULT_COMPANY_BRANDING: CompanyBranding = {
  companyName: 'RACC Agency',
  logoUrl: null,
  logoWidth: 20,
};

export function getEffectiveTemplate(
  systemDefault: CardTemplate,
  campaignOverrides?: Partial<CardTemplate> | null
): CardTemplate {
  if (!campaignOverrides) return systemDefault;
  return { ...systemDefault, ...campaignOverrides };
}

export interface Campaign {
  id: string;
  name: string;
  start_date: string;
  end_date: string;
  venue: string;
  registration_type: InvitationType;
  status: CampaignStatus;
  created_at: string;
  updated_at: string;
  checkout_config?: CheckoutConfig;
  card_template_overrides?: Partial<CardTemplate> | null;
  max_headcount: number | null;
  commission_cap: number | null;
}

export interface Slot {
  id: string;
  campaign_id: string;
  start_at: string; // ISO 8601 datetime (TIMESTAMPTZ)
  end_at: string; // ISO 8601 datetime (TIMESTAMPTZ)
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
  tier_id: string | null;
  parent_agent_id: string | null;
  is_auto_invite: boolean;
  status: AgentStatus;
  photo_url: string | null;
  created_at: string;
  updated_at: string;
}

export interface AgentLink {
  id: string;
  agent_id: string;
  slot_id: string;
  partner_id: string | null;
  link_code: string;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface Registration {
  id: string;
  agent_link_id: string | null;
  agent_id: string;
  slot_id: string;
  capacity_type: CapacityType;
  status: RegistrationStatus;
  invitee_name: string;
  invitee_nric: string;
  invitee_phone: string;
  invitee_email: string | null;
  invitee_occupation: string | null;
  registered_at: string | null;
  created_at: string;
  updated_at: string;
}

/**
 * @deprecated Use {@link Registration} instead.
 * Kept temporarily for backwards compatibility during migration.
 */
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
  claimed_by_partner_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface OtpCode {
  id: string;
  registration_id: string;
  slot_id: string;
  phone: string;
  code: string;
  expires_at: string;
  is_used: boolean;
  created_at: string;
}

/**
 * @deprecated Use updated Attendance with registration_id instead.
 * Kept temporarily so consumer apps compile until they migrate.
 */
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
  registration_id: string;
  checkin_time: string;
  checkout_time: string | null;
  is_full_attendance: boolean;
  checkout_rating: number | null;
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
  tier: Tier | null;
}

export interface RegistrationWithRelations extends Registration {
  agent: Agent;
  slot: SlotWithCampaign;
  agent_link?: AgentLink;
}

export interface AgentLinkWithRegistrations extends AgentLink {
  registrations: Registration[];
  registration_count: number;
}

/**
 * @deprecated Use {@link RegistrationWithRelations} instead.
 */
export interface InvitationWithRelations extends Invitation {
  agent: Agent;
  slot: SlotWithCampaign;
}

export interface AttendanceWithRelations extends Attendance {
  registration: RegistrationWithRelations;
}
