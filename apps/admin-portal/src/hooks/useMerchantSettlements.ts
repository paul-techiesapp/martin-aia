import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { RewardStatus } from '@agent-system/shared-types';

export interface AdminSettlementRow {
  id: string;
  amount: number;
  status: RewardStatus;
  paid_at: string | null;
  failure_reason: string | null;
  created_at: string;
  merchant: { id: string; name: string } | null;
  vehicle: {
    id: string;
    car_plate: string;
    enquiry: { customer_name: string; customer_phone: string } | null;
  } | null;
}

export function useMerchantSettlements() {
  return useQuery({
    queryKey: ['merchant-settlements'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('merchant_settlements')
        .select(`
          id, amount, status, paid_at, failure_reason, created_at,
          merchant:merchants(id, name),
          vehicle:enquiry_vehicles(
            id, car_plate,
            enquiry:enquiries(customer_name, customer_phone)
          )
        `)
        .order('created_at', { ascending: false });

      if (error) throw error;
      return (data ?? []) as unknown as AdminSettlementRow[];
    },
  });
}

export function useSetMerchantSettlementStatus() {
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
      const { error } = await supabase.rpc('set_merchant_settlement_status', {
        p_id: id,
        p_status: status,
        p_failure_reason: reason ?? null,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['merchant-settlements'] });
    },
  });
}
