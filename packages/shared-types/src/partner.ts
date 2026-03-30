import { AgentStatus } from './enums';
import type { Agent, Tier } from './database';

export interface Partner {
  id: string;
  agent_id: string;
  user_id: string;
  name: string;
  email: string;
  phone: string;
  nric: string | null;
  tier_id: string | null;
  status: AgentStatus;
  created_at: string;
  updated_at: string;
}

export interface PartnerWithAgent extends Partner {
  agent: Agent;
}

export interface PartnerWithTier extends Partner {
  tier: Tier | null;
}
