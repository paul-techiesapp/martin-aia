import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { MerchantStatus, type Merchant } from '@agent-system/shared-types';

/** Agent (with unit) who proposed the partnership; null for admin-created ones. */
export interface MerchantCreator {
  id: string;
  name: string;
  agent_code: string;
  unit_name: string;
}

export interface MerchantWithCreator extends Merchant {
  created_by: MerchantCreator | null;
}

// Round 10 items 1+2: admins need to see which unit/agent uploaded each
// partnership. `created_by_agent_id` is the only agents FK on merchants
// (approved_by is a bare auth uuid), so the bare embed is unambiguous.
const MERCHANT_SELECT = '*, created_by:agents(id, name, agent_code, unit_name)';

export function useMerchants() {
  return useQuery({
    queryKey: ['merchants'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('merchants')
        .select(MERCHANT_SELECT)
        .order('created_at', { ascending: false });

      if (error) throw error;
      return data as unknown as MerchantWithCreator[];
    },
  });
}

export function useMerchant(id: string) {
  return useQuery({
    queryKey: ['merchants', id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('merchants')
        .select(MERCHANT_SELECT)
        .eq('id', id)
        .single();

      if (error) throw error;
      return data as unknown as MerchantWithCreator;
    },
    enabled: !!id,
  });
}

// Admin-created merchants go live immediately (status active).
export function useCreateMerchant() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (
      merchant: Pick<Merchant, 'name' | 'logo_url'>
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
