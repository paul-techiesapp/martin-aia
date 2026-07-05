import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import type { Merchant } from '@agent-system/shared-types';

export function useCreateMerchantUser() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: { merchant_id: string; email: string; password: string }) => {
      const response = await supabase.functions.invoke('create-merchant-user', {
        body: { action: 'create', ...input },
      });

      if (response.error) throw new Error(response.error.message || 'Failed to create merchant login');
      if (response.data?.error) throw new Error(response.data.error);
      return response.data.merchant as Merchant;
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ['merchants'] });
      queryClient.invalidateQueries({ queryKey: ['merchants', variables.merchant_id] });
    },
  });
}

export function useRevokeMerchantUser() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (merchantId: string) => {
      const response = await supabase.functions.invoke('create-merchant-user', {
        body: { action: 'revoke', merchant_id: merchantId },
      });

      if (response.error) throw new Error(response.error.message || 'Failed to revoke merchant login');
      if (response.data?.error) throw new Error(response.data.error);
      return response.data.merchant as Merchant;
    },
    onSuccess: (_data, merchantId) => {
      queryClient.invalidateQueries({ queryKey: ['merchants'] });
      queryClient.invalidateQueries({ queryKey: ['merchants', merchantId] });
    },
  });
}
