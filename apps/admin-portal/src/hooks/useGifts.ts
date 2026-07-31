import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { fetchAllRows } from '@agent-system/shared-ui';
import { supabase } from '../lib/supabase';
import { GiftStatus } from '@agent-system/shared-types';

export interface AdminGiftRow {
  id: string;
  value_amount: number;
  voucher_code: string;
  status: GiftStatus;
  issued_at: string;
  redeemed_at: string | null;
  expires_at: string | null;
  created_at: string;
  merchant: { id: string; name: string } | null;
  vehicle: {
    id: string;
    car_plate: string;
    enquiry: { customer_name: string; customer_phone: string } | null;
  } | null;
}

export function useGifts() {
  return useQuery({
    queryKey: ['gifts'],
    queryFn: async () => {
      // Paged: gifts is minted per renewal (same shape as rewards / merchant_
      // commissions / merchant_settlements) and this read is fully unfiltered,
      // so it grows per transaction just like its sibling ledger tables.
      return fetchAllRows<AdminGiftRow>(
        (from, to) =>
          supabase
            .from('gifts')
            .select(`
              id, value_amount, voucher_code, status, issued_at, redeemed_at, expires_at, created_at,
              merchant:merchants(id, name),
              vehicle:enquiry_vehicles(
                id, car_plate,
                enquiry:enquiries(customer_name, customer_phone)
              )
            `)
            .order('created_at', { ascending: false })
            .order('id', { ascending: false })
            .range(from, to) as unknown as PromiseLike<{
            data: AdminGiftRow[] | null;
            error: { message: string } | null;
          }>,
        { label: 'admin gifts' },
      );
    },
  });
}

export function useMarkGiftRedeemed() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.rpc('mark_gift_redeemed', { p_gift_id: id });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['gifts'] });
    },
  });
}
