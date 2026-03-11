import { AgentStatus } from './enums';
import type { Agent } from './database';

export interface Partner {
  id: string;
  agent_id: string;
  user_id: string;
  name: string;
  email: string;
  phone: string;
  nric: string | null;
  status: AgentStatus;
  created_at: string;
  updated_at: string;
}

export interface PartnerWithAgent extends Partner {
  agent: Agent;
}
