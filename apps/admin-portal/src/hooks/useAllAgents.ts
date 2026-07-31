import { useQuery } from '@tanstack/react-query';
import { fetchAllRows } from '@agent-system/shared-ui';
import { supabase } from '../lib/supabase';
import type { AgentWithTier } from '@agent-system/shared-types';

/**
 * Lists ALL active agents (Unit Admins AND their sub-agents), unlike useAgents()
 * which only returns top-level units (parent_agent_id IS NULL). Use this where
 * sub-agents also need to be selectable, e.g. tying a merchant branch link to any
 * agent for commission tracking.
 */
export function useAllAgents() {
  return useQuery({
    queryKey: ['all-agents'],
    queryFn: async () => {
      // Paged: a status filter alone doesn't bound this under 1000 rows as the
      // active roster grows (agents is a table that grows per transaction).
      return fetchAllRows<AgentWithTier>(
        (from, to) =>
          supabase
            .from('agents')
            .select(`
              *,
              tier:tiers(*)
            `)
            .eq('status', 'active')
            .order('name', { ascending: true })
            .order('id', { ascending: true })
            .range(from, to) as unknown as PromiseLike<{
            data: AgentWithTier[] | null;
            error: { message: string } | null;
          }>,
        { label: 'admin all-agents' },
      );
    },
  });
}
