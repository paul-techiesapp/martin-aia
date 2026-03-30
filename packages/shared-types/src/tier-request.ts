import { TierRequestStatus } from './enums';
import type { Agent, Tier } from './database';

export interface TierRequest {
  id: string;
  agent_id: string;
  requested_tier_id: string;
  requested_by: string;
  status: TierRequestStatus;
  admin_notes: string | null;
  reviewed_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface TierRequestWithDetails extends TierRequest {
  agent: Agent;
  requested_tier: Tier;
  requester: Agent;
}
