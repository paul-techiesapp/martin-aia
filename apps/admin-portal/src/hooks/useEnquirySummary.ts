import { useQuery } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';

export interface EnquiryUnitSummaryRow {
  unit_name: string;
  unit_root_id: string | null;
  forms_submitted: number;
  customers: number;
  cars: number;
  cars_open: number;
  cars_renewed: number;
  agents_active: number;
}

export interface EnquiryAgentSummaryRow {
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

/** Per-unit enquiry totals. `from`/`to` are YYYY-MM-DD, compared on the
 *  Asia/Singapore calendar day inside the RPC. */
export function useEnquiryUnitSummary(from?: string, to?: string) {
  return useQuery({
    queryKey: ['enquiry-unit-summary', from ?? null, to ?? null],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('enquiry_unit_summary', {
        p_from: from || null,
        p_to: to || null,
      });
      if (error) throw error;
      return (data ?? []) as EnquiryUnitSummaryRow[];
    },
  });
}

/** Per-agent breakdown inside one unit. Disabled until a unit is expanded. */
export function useEnquiryAgentSummary(
  from: string | undefined,
  to: string | undefined,
  unitRootId: string | null,
) {
  return useQuery({
    queryKey: ['enquiry-agent-summary', from ?? null, to ?? null, unitRootId],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('enquiry_agent_summary', {
        p_from: from || null,
        p_to: to || null,
        p_unit_root: unitRootId,
      });
      if (error) throw error;
      return (data ?? []) as EnquiryAgentSummaryRow[];
    },
    enabled: !!unitRootId,
  });
}
