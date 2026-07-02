import { useQuery } from '@tanstack/react-query';
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
      const { data, error } = await supabase
        .from('agents')
        .select(`
          *,
          tier:tiers(*)
        `)
        .eq('status', 'active')
        .order('name', { ascending: true });

      if (error) throw error;
      return data as AgentWithTier[];
    },
  });
}
