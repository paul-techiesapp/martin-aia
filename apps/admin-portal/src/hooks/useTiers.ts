import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import type { Tier } from '@agent-system/shared-types';

export function useTiers() {
  return useQuery({
    queryKey: ['tiers'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('tiers')
        .select('*')
        .order('name', { ascending: true });

      if (error) throw error;
      return data as Tier[];
    },
  });
}

export function useTier(id: string) {
  return useQuery({
    queryKey: ['tiers', id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('tiers')
        .select('*')
        .eq('id', id)
        .single();

      if (error) throw error;
      return data as Tier;
    },
    enabled: !!id,
  });
}

export function useCreateTier() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (tier: Omit<Tier, 'id' | 'created_at' | 'updated_at'>) => {
      const { data, error } = await supabase
        .from('tiers')
        .insert(tier)
        .select()
        .single();

      if (error) throw error;
      return data as Tier;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tiers'] });
    },
  });
}

export function useUpdateTier() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ id, ...updates }: Partial<Tier> & { id: string }) => {
      const { data, error } = await supabase
        .from('tiers')
        .update(updates)
        .eq('id', id)
        .select()
        .single();

      if (error) throw error;
      return data as Tier;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['tiers'] });
      queryClient.invalidateQueries({ queryKey: ['tiers', data.id] });
    },
  });
}

export function useDeleteTier() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from('tiers')
        .delete()
        .eq('id', id);

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tiers'] });
    },
  });
}
