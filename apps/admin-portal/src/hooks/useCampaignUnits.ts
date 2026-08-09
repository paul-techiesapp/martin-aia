import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';

/**
 * Unit heads an event is restricted to. An empty array means the event is
 * open to every unit — the default-open rule enforced by
 * campaign_visible_to_me() in 20260808000003.
 */
export function useCampaignUnits(campaignId: string | undefined) {
  return useQuery({
    queryKey: ['campaign-units', campaignId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('campaign_units')
        .select('unit_agent_id')
        .eq('campaign_id', campaignId!);
      if (error) throw error;
      return (data ?? []).map((r) => (r as { unit_agent_id: string }).unit_agent_id);
    },
    enabled: !!campaignId,
  });
}

/**
 * Replace-all write: delete the rows that are gone, insert the ones that are
 * new. Done as a diff rather than delete-then-insert-everything so a failed
 * insert cannot leave the event unscoped (i.e. visible to all units).
 */
export function useSetCampaignUnits() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      campaignId,
      unitAgentIds,
    }: {
      campaignId: string;
      unitAgentIds: string[];
    }) => {
      const { data: existingRows, error: readError } = await supabase
        .from('campaign_units')
        .select('unit_agent_id')
        .eq('campaign_id', campaignId);
      if (readError) throw readError;

      const existing = new Set(
        (existingRows ?? []).map((r) => (r as { unit_agent_id: string }).unit_agent_id),
      );
      const wanted = new Set(unitAgentIds);
      const toRemove = [...existing].filter((id) => !wanted.has(id));
      const toAdd = [...wanted].filter((id) => !existing.has(id));

      if (toAdd.length > 0) {
        const { error } = await supabase
          .from('campaign_units')
          .insert(toAdd.map((unit_agent_id) => ({ campaign_id: campaignId, unit_agent_id })));
        if (error) throw error;
      }
      if (toRemove.length > 0) {
        const { error } = await supabase
          .from('campaign_units')
          .delete()
          .eq('campaign_id', campaignId)
          .in('unit_agent_id', toRemove);
        if (error) throw error;
      }
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ['campaign-units', variables.campaignId] });
    },
  });
}
