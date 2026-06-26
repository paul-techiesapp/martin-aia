import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { MerchantStatus, type MerchantBranch } from '@agent-system/shared-types';

export function useMerchantBranches(merchantId: string) {
  return useQuery({
    queryKey: ['merchant_branches', merchantId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('merchant_branches')
        .select('*')
        .eq('merchant_id', merchantId)
        .order('created_at', { ascending: true });

      if (error) throw error;
      return data as MerchantBranch[];
    },
    enabled: !!merchantId,
  });
}

export function useCreateMerchantBranch() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (
      branch: Pick<MerchantBranch, 'merchant_id' | 'name' | 'address' | 'phone'>
    ) => {
      const { data, error } = await supabase
        .from('merchant_branches')
        .insert({ ...branch, status: MerchantStatus.ACTIVE })
        .select()
        .single();

      if (error) throw error;
      return data as MerchantBranch;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['merchant_branches', data.merchant_id] });
    },
  });
}

export function useUpdateMerchantBranch() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, ...updates }: Partial<MerchantBranch> & { id: string }) => {
      const { data, error } = await supabase
        .from('merchant_branches')
        .update(updates)
        .eq('id', id)
        .select()
        .single();

      if (error) throw error;
      return data as MerchantBranch;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['merchant_branches', data.merchant_id] });
    },
  });
}

export function useDeleteMerchantBranch(merchantId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('merchant_branches').delete().eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['merchant_branches', merchantId] });
    },
  });
}

export function useApproveMerchantBranch(merchantId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.rpc('approve_merchant_branch', { branch_uuid: id });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['merchant_branches', merchantId] });
    },
  });
}
