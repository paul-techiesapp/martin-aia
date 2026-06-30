import { useQuery } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';

export interface RenewalReportRow {
  id: string;
  car_plate: string;
  renewed_at: string | null;
  renewal_premium_amount: number | null;
  merchant_id: string | null;
  merchant: { name: string } | null;
  enquiry: {
    customer_name: string;
    agent: { name: string; agent_code: string; unit_name: string } | null;
  } | null;
}

export interface RenewalReportFilters {
  from?: string; // ISO date (inclusive)
  to?: string; // ISO date (inclusive)
}

/**
 * Successful renewal cases: every vehicle in status 'renewed'. Unit/agent/
 * partner filtering and value sorting are applied client-side (the joined
 * agent.unit_name is not filterable in PostgREST).
 */
export function useRenewalReport(filters: RenewalReportFilters) {
  return useQuery({
    queryKey: ['renewal-report', filters],
    queryFn: async () => {
      let q = supabase
        .from('enquiry_vehicles')
        .select(`
          id, car_plate, renewed_at, renewal_premium_amount, merchant_id,
          merchant:merchants(name),
          enquiry:enquiries(customer_name, agent:agents(name, agent_code, unit_name))
        `)
        .eq('status', 'renewed');

      if (filters.from) q = q.gte('renewed_at', filters.from);
      // make 'to' inclusive of the whole day
      if (filters.to) q = q.lte('renewed_at', `${filters.to}T23:59:59.999Z`);

      const { data, error } = await q.order('renewed_at', { ascending: false });
      if (error) throw error;
      return (data ?? []) as unknown as RenewalReportRow[];
    },
  });
}
