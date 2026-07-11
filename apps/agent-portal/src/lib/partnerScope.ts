import { MerchantStatus, type Merchant } from '@agent-system/shared-types';

// Round 5 item 1: a merchant is available to an agent when it is active AND
// (explicitly Master, OR proposed by this agent, OR the agent holds a branch
// link into it). Mirrors merchant_available_to_agent() in Postgres — keep the
// two in sync.
export function isMerchantAvailableToAgent(
  m: Merchant,
  agentId: string | undefined,
  linkedMerchantIds: ReadonlySet<string>,
): boolean {
  return (
    m.status === MerchantStatus.ACTIVE &&
    (m.is_master ||
      (!!agentId && m.created_by_agent_id === agentId) ||
      linkedMerchantIds.has(m.id))
  );
}
