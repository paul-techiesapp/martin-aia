import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { fetchAllRows } from '@agent-system/shared-ui';
import { supabase } from '../lib/supabase';
import { RewardStatus } from '@agent-system/shared-types';

export interface AdminCommissionRow {
  id: string;
  amount: number;
  status: RewardStatus;
  paid_at: string | null;
  failure_reason: string | null;
  created_at: string;
  agent: { id: string; name: string; agent_code: string; unit_name: string } | null;
  vehicle: {
    id: string;
    car_plate: string;
    enquiry: { customer_name: string; customer_phone: string } | null;
  } | null;
}

export function useMerchantCommissions() {
  return useQuery({
    queryKey: ['merchant-commissions'],
    queryFn: async () => {
      // Paged: merchant_commissions is a table that grows per transaction and
      // this read is fully unfiltered. `id` is a tiebreaker for deterministic
      // page boundaries.
      return fetchAllRows<AdminCommissionRow>(
        (from, to) =>
          supabase
            .from('merchant_commissions')
            .select(`
              id, amount, status, paid_at, failure_reason, created_at,
              agent:agents(id, name, agent_code, unit_name),
              vehicle:enquiry_vehicles(
                id, car_plate,
                enquiry:enquiries(customer_name, customer_phone)
              )
            `)
            .order('created_at', { ascending: false })
            .order('id', { ascending: false })
            .range(from, to) as unknown as PromiseLike<{
            data: AdminCommissionRow[] | null;
            error: { message: string } | null;
          }>,
        { label: 'admin merchant-commissions' },
      );
    },
  });
}

export function useSetMerchantCommissionStatus() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      id,
      status,
      reason,
    }: {
      id: string;
      status: RewardStatus;
      reason?: string;
    }) => {
      const { error } = await supabase.rpc('set_merchant_commission_status', {
        p_id: id,
        p_status: status,
        p_failure_reason: reason ?? null,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['merchant-commissions'] });
    },
  });
}
