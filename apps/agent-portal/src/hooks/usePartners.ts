import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import type { Partner } from '@agent-system/shared-types';

export function useMyPartners(agentId: string | undefined) {
  return useQuery({
    queryKey: ['my-partners', agentId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('partners')
        .select('*')
        .eq('agent_id', agentId)
        .order('created_at', { ascending: false });

      if (error) throw error;
      return data as Partner[];
    },
    enabled: !!agentId,
  });
}

export function usePartnerClaimCounts(agentId: string | undefined) {
  return useQuery({
    queryKey: ['partner-claim-counts', agentId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('invitations')
        .select('claimed_by_partner_id')
        .eq('agent_id', agentId)
        .not('claimed_by_partner_id', 'is', null);

      if (error) throw error;

      const counts: Record<string, number> = {};
      data?.forEach(inv => {
        const pid = inv.claimed_by_partner_id;
        if (pid) counts[pid] = (counts[pid] || 0) + 1;
      });
      return counts;
    },
    enabled: !!agentId,
  });
}

export function useCreatePartner() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: {
      name: string;
      email: string;
      phone: string;
      nric?: string;
      password: string;
    }) => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error('Not authenticated');

      const response = await supabase.functions.invoke('create-partner', {
        body: input,
      });

      if (response.error) throw new Error(response.error.message || 'Failed to create partner');
      if (response.data?.error) throw new Error(response.data.error);
      return response.data.partner as Partner;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['my-partners'] });
    },
  });
}

export function useDeactivatePartner() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (partnerId: string) => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error('Not authenticated');

      const response = await supabase.functions.invoke('deactivate-partner', {
        body: { partner_id: partnerId },
      });

      if (response.error) throw new Error(response.error.message || 'Failed to deactivate partner');
      if (response.data?.error) throw new Error(response.data.error);
      return response.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['my-partners'] });
      queryClient.invalidateQueries({ queryKey: ['partner-claim-counts'] });
    },
  });
}
