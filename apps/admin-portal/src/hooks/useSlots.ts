import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import type { Slot } from '@agent-system/shared-types';

export function useSlots(campaignId: string) {
  return useQuery({
    queryKey: ['slots', campaignId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('slots')
        .select('*')
        .eq('campaign_id', campaignId)
        .order('day_of_week', { ascending: true })
        .order('start_time', { ascending: true });

      if (error) throw error;
      return data as Slot[];
    },
    enabled: !!campaignId,
  });
}

export function useSlot(id: string) {
  return useQuery({
    queryKey: ['slots', 'single', id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('slots')
        .select('*')
        .eq('id', id)
        .single();

      if (error) throw error;
      return data as Slot;
    },
    enabled: !!id,
  });
}

export function useCreateSlot() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (slot: Omit<Slot, 'id' | 'created_at' | 'updated_at'>) => {
      const { data, error } = await supabase
        .from('slots')
        .insert(slot)
        .select()
        .single();

      if (error) throw error;
      return data as Slot;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['slots', data.campaign_id] });
    },
  });
}

export function useUpdateSlot() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ id, ...updates }: Partial<Slot> & { id: string }) => {
      const { data, error } = await supabase
        .from('slots')
        .update(updates)
        .eq('id', id)
        .select()
        .single();

      if (error) throw error;
      return data as Slot;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['slots', data.campaign_id] });
    },
  });
}

export function useDeleteSlot() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (id: string) => {
      // First get the slot to know its campaign_id for cache invalidation
      const { data: slot } = await supabase
        .from('slots')
        .select('campaign_id')
        .eq('id', id)
        .single();

      const { error } = await supabase
        .from('slots')
        .delete()
        .eq('id', id);

      if (error) throw error;
      return slot?.campaign_id;
    },
    onSuccess: (campaignId) => {
      if (campaignId) {
        queryClient.invalidateQueries({ queryKey: ['slots', campaignId] });
      }
    },
  });
}

export function useToggleSlotActive() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ id, is_active }: { id: string; is_active: boolean }) => {
      const { data, error } = await supabase
        .from('slots')
        .update({ is_active })
        .eq('id', id)
        .select()
        .single();

      if (error) throw error;
      return data as Slot;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['slots', data.campaign_id] });
    },
  });
}
