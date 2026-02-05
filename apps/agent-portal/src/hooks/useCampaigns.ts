import { useQuery } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import type { Campaign, Slot } from '@agent-system/shared-types';
import { CampaignStatus } from '@agent-system/shared-types';

export function useActiveCampaigns() {
  return useQuery({
    queryKey: ['active-campaigns'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('campaigns')
        .select('*')
        .eq('status', CampaignStatus.ACTIVE)
        .order('start_date', { ascending: true });

      if (error) throw error;
      return data as Campaign[];
    },
  });
}

export function useCampaignSlots(campaignId: string) {
  return useQuery({
    queryKey: ['campaign-slots', campaignId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('slots')
        .select('*')
        .eq('campaign_id', campaignId)
        .eq('is_active', true)
        .order('day_of_week', { ascending: true })
        .order('start_time', { ascending: true });

      if (error) throw error;
      return data as Slot[];
    },
    enabled: !!campaignId,
  });
}
