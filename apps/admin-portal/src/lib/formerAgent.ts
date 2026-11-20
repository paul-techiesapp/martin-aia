/**
 * When an agent is deleted, their registrations / rewards / commissions are kept
 * (agent_id becomes NULL) and a DB trigger stamps former_agent_name/code/unit on
 * those rows. This turns that snapshot back into an `agent`-shaped object so
 * every report keeps showing who brought the attendee, marked "(deleted)".
 */
export const FORMER_AGENT_COLUMNS = 'former_agent_name, former_agent_code, former_agent_unit';

export interface FormerAgentFields {
  former_agent_name?: string | null;
  former_agent_code?: string | null;
  former_agent_unit?: string | null;
}

export function formerAgent(row: FormerAgentFields) {
  if (!row.former_agent_name) return null;
  return {
    id: '',
    name: `${row.former_agent_name} (deleted)`,
    agent_code: row.former_agent_code ?? '',
    unit_name: row.former_agent_unit ?? '',
    parent_agent_id: null as string | null,
  };
}

/** Returns the row's live agent, or the deleted-agent snapshot when the agent is gone. */
export function withFormerAgent<T extends FormerAgentFields & { agent?: unknown }>(row: T): T {
  if (row.agent) return row;
  const fallback = formerAgent(row);
  return fallback ? ({ ...row, agent: fallback } as T) : row;
}
