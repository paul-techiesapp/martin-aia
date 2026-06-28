import { useQuery } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import type { MerchantCommission } from '@agent-system/shared-types';

export interface MerchantCommissionWithVehicle extends MerchantCommission {
  vehicle: {
    car_plate: string;
    insurance_expiry_date: string;
    enquiry: { customer_name: string } | null;
  } | null;
}

// The agent's commission ledger (one row per renewed vehicle on a tied link),
// with the car + customer for context. Mirrors how Rewards.tsx reads rewards.
export function useMyCommissions(agentId: string | undefined) {
  return useQuery({
    queryKey: ['my-commissions', agentId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('merchant_commissions')
        .select(`
          *,
          vehicle:enquiry_vehicles(
            car_plate,
            insurance_expiry_date,
            enquiry:enquiries(customer_name)
          )
        `)
        .eq('agent_id', agentId!)
        .order('created_at', { ascending: false });

      if (error) throw error;
      return (data ?? []) as MerchantCommissionWithVehicle[];
    },
    enabled: !!agentId,
  });
}
