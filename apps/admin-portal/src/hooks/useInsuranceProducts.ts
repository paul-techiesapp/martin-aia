import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import type { InsuranceProduct } from '@agent-system/shared-types';

export function useInsuranceProducts() {
  return useQuery({
    queryKey: ['insurance_products'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('insurance_products')
        .select('*')
        .order('sort_order', { ascending: true });

      if (error) throw error;
      return data as InsuranceProduct[];
    },
  });
}

export function useCreateInsuranceProduct() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (
      product: Omit<InsuranceProduct, 'id' | 'created_at' | 'updated_at'>
    ) => {
      const { data, error } = await supabase
        .from('insurance_products')
        .insert(product)
        .select()
        .single();

      if (error) throw error;
      return data as InsuranceProduct;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['insurance_products'] });
    },
  });
}

export function useUpdateInsuranceProduct() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, ...updates }: Partial<InsuranceProduct> & { id: string }) => {
      const { data, error } = await supabase
        .from('insurance_products')
        .update(updates)
        .eq('id', id)
        .select()
        .single();

      if (error) throw error;
      return data as InsuranceProduct;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['insurance_products'] });
    },
  });
}

export function useDeleteInsuranceProduct() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('insurance_products').delete().eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['insurance_products'] });
    },
  });
}
