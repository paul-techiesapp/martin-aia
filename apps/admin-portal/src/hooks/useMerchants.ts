import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { MerchantStatus, type Merchant } from '@agent-system/shared-types';

export function useMerchants() {
  return useQuery({
    queryKey: ['merchants'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('merchants')
        .select('*')
        .order('created_at', { ascending: false });

      if (error) throw error;
      return data as Merchant[];
    },
  });
}

export function useMerchant(id: string) {
  return useQuery({
    queryKey: ['merchants', id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('merchants')
        .select('*')
        .eq('id', id)
        .single();

      if (error) throw error;
      return data as Merchant;
    },
    enabled: !!id,
  });
}

// Admin-created merchants go live immediately (status active).
export function useCreateMerchant() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (
      merchant: Pick<Merchant, 'name' | 'logo_url' | 'gift_pool_amount' | 'merchant_share_pct'>
    ) => {
      const { data, error } = await supabase
        .from('merchants')
        .insert({ ...merchant, status: MerchantStatus.ACTIVE })
        .select()
        .single();

      if (error) throw error;
      return data as Merchant;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['merchants'] });
    },
  });
}

export function useUpdateMerchant() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, ...updates }: Partial<Merchant> & { id: string }) => {
      const { data, error } = await supabase
        .from('merchants')
        .update(updates)
        .eq('id', id)
        .select()
        .single();

      if (error) throw error;
      return data as Merchant;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['merchants'] });
      queryClient.invalidateQueries({ queryKey: ['merchants', data.id] });
    },
  });
}

export function useDeleteMerchant() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('merchants').delete().eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['merchants'] });
    },
  });
}

export function useApproveMerchant() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.rpc('approve_merchant', { merchant_uuid: id });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['merchants'] });
    },
  });
}
