import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { CampaignStatus } from '@agent-system/shared-types';
import type { Campaign, Slot } from '@agent-system/shared-types';

export function useCampaigns() {
  return useQuery({
    queryKey: ['campaigns'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('campaigns')
        .select('*')
        .order('created_at', { ascending: false });

      if (error) throw error;
      return data as Campaign[];
    },
  });
}

export function useCampaign(id: string) {
  return useQuery({
    queryKey: ['campaigns', id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('campaigns')
        .select('*')
        .eq('id', id)
        .single();

      if (error) throw error;
      return data as Campaign;
    },
    enabled: !!id,
  });
}

export function useCreateCampaign() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (campaign: Omit<Campaign, 'id' | 'created_at' | 'updated_at'>) => {
      const { data, error } = await supabase
        .from('campaigns')
        .insert(campaign)
        .select()
        .single();

      if (error) throw error;
      return data as Campaign;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['campaigns'] });
    },
  });
}

export function useUpdateCampaign() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ id, ...updates }: Partial<Campaign> & { id: string }) => {
      const { data, error } = await supabase
        .from('campaigns')
        .update(updates)
        .eq('id', id)
        .select()
        .single();

      if (error) throw error;
      return data as Campaign;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['campaigns'] });
      queryClient.invalidateQueries({ queryKey: ['campaigns', data.id] });
      // PDF Export embeds campaign.card_template_overrides in its own query, so
      // refresh it too — otherwise freshly-saved card colors render stale there.
      queryClient.invalidateQueries({ queryKey: ['registrations-for-pdf'] });
    },
  });
}

export function useDeleteCampaign() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from('campaigns')
        .delete()
        .eq('id', id);

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['campaigns'] });
    },
  });
}

export function useUpdateCampaignStatus() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ id, status }: { id: string; status: CampaignStatus }) => {
      const { data, error } = await supabase
        .from('campaigns')
        .update({ status })
        .eq('id', id)
        .select()
        .single();

      if (error) throw error;
      return data as Campaign;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['campaigns'] });
      queryClient.invalidateQueries({ queryKey: ['campaigns', data.id] });
    },
  });
}

export function useDuplicateCampaign() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      sourceId,
      newName,
      newStartDate,
      newEndDate,
    }: {
      sourceId: string;
      newName: string;
      newStartDate: string;
      newEndDate: string;
    }) => {
      // 1. Fetch source campaign
      const { data: source, error: sourceError } = await supabase
        .from('campaigns')
        .select('*')
        .eq('id', sourceId)
        .single();

      if (sourceError || !source) throw sourceError || new Error('Campaign not found');

      // 2. Fetch source slots
      const { data: sourceSlots, error: slotsError } = await supabase
        .from('slots')
        .select('*')
        .eq('campaign_id', sourceId)
        .order('start_at', { ascending: true });

      if (slotsError) throw slotsError;

      // 3. Calculate date offset (local midnight to avoid UTC parsing issues)
      const offset =
        new Date(newStartDate + 'T00:00:00').getTime() -
        new Date(source.start_date + 'T00:00:00').getTime();

      // 4. Insert new campaign
      const { data: newCampaign, error: insertError } = await supabase
        .from('campaigns')
        .insert({
          name: newName,
          venue: source.venue,
          registration_type: source.registration_type,
          start_date: newStartDate,
          end_date: newEndDate,
          status: CampaignStatus.DRAFT,
          nric_required: source.nric_required ?? true,
          allow_repeat_attendees: source.allow_repeat_attendees ?? false,
        })
        .select()
        .single();

      if (insertError || !newCampaign) throw insertError || new Error('Failed to create campaign');

      // 5. Shift and insert slots
      if (sourceSlots && sourceSlots.length > 0) {
        const newSlots = sourceSlots.map((slot: Slot) => ({
          campaign_id: newCampaign.id,
          start_at: new Date(new Date(slot.start_at).getTime() + offset).toISOString(),
          end_at: new Date(new Date(slot.end_at).getTime() + offset).toISOString(),
          checkin_window_minutes: slot.checkin_window_minutes,
          checkout_window_minutes: slot.checkout_window_minutes,
          is_active: slot.is_active,
        }));

        const { error: slotsInsertError } = await supabase
          .from('slots')
          .insert(newSlots);

        if (slotsInsertError) throw slotsInsertError;
      }

      return { campaign: newCampaign as Campaign, slotCount: sourceSlots?.length ?? 0 };
    },
    onSuccess: ({ campaign }) => {
      queryClient.invalidateQueries({ queryKey: ['campaigns'] });
      queryClient.invalidateQueries({ queryKey: ['campaigns', campaign.id] });
    },
  });
}
