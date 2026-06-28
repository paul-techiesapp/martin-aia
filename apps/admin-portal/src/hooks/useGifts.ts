import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
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
      const { data, error } = await supabase
        .from('gifts')
        .select(`
          id, value_amount, voucher_code, status, issued_at, redeemed_at, expires_at, created_at,
          merchant:merchants(id, name),
          vehicle:enquiry_vehicles(
            id, car_plate,
            enquiry:enquiries(customer_name, customer_phone)
          )
        `)
        .order('created_at', { ascending: false });

      if (error) throw error;
      return (data ?? []) as unknown as AdminGiftRow[];
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
