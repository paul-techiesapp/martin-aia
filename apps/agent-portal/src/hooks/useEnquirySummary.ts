import { useQuery } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';

export interface AgentEnquirySummaryRow {
  agent_id: string;
  agent_name: string;
  agent_code: string;
  unit_name: string;
  forms_submitted: number;
  customers: number;
  cars: number;
  cars_open: number;
  cars_renewed: number;
}

/**
 * Per-agent enquiry totals for the caller's own unit. The RPC ignores any unit
 * root that is not the caller's own, so a manager cannot read another unit even
 * by passing its id.
 */
export function useUnitEnquirySummary(unitRootId: string | undefined, enabled: boolean) {
  return useQuery({
    queryKey: ['unit-enquiry-summary', unitRootId],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('enquiry_agent_summary', {
        p_from: null,
        p_to: null,
        p_unit_root: unitRootId,
      });
      if (error) throw error;
      return (data ?? []) as AgentEnquirySummaryRow[];
    },
    enabled: enabled && !!unitRootId,
  });
}
