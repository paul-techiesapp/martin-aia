import { TierRequestStatus } from './enums';
import type { Agent, Tier } from './database';
import type { Partner } from './partner';

export interface TierRequest {
  id: string;
  agent_id: string | null;
  partner_id: string | null;
  requested_tier_id: string;
  requested_by: string;
  status: TierRequestStatus;
  admin_notes: string | null;
  reviewed_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface TierRequestWithDetails extends TierRequest {
  agent: Agent | null;
  partner: Partner | null;
  requested_tier: Tier;
  requester: Agent;
}
