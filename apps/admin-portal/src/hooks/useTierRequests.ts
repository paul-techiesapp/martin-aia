import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import type { TierRequestWithDetails } from '@agent-system/shared-types';

export function usePendingTierRequests() {
  return useQuery({
    queryKey: ['tier-requests', 'pending'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('tier_requests')
        .select(`
          *,
          agent:agents!tier_requests_agent_id_fkey(*),
          partner:partners!tier_requests_partner_id_fkey(*),
          requested_tier:tiers(*),
          requester:agents!tier_requests_requested_by_fkey(*)
        `)
        .eq('status', 'pending')
        .order('created_at', { ascending: true });

      if (error) throw error;
      return data as TierRequestWithDetails[];
    },
  });
}

export function usePendingTierRequestCount() {
  return useQuery({
    queryKey: ['tier-requests', 'pending-count'],
    queryFn: async () => {
      const { count, error } = await supabase
        .from('tier_requests')
        .select('*', { count: 'exact', head: true })
        .eq('status', 'pending');

      if (error) throw error;
      return count ?? 0;
    },
  });
}

export function useApproveTierRequest() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (requestId: string) => {
      const { data: request, error: fetchError } = await supabase
        .from('tier_requests')
        .select('agent_id, partner_id, requested_tier_id')
        .eq('id', requestId)
        .single();

      if (fetchError || !request) throw new Error('Tier request not found');

      const { error: updateError } = await supabase
        .from('tier_requests')
        .update({
          status: 'approved',
          reviewed_at: new Date().toISOString(),
        })
        .eq('id', requestId);

      if (updateError) throw updateError;

      if (request.agent_id) {
        const { error: agentError } = await supabase
          .from('agents')
          .update({ tier_id: request.requested_tier_id })
          .eq('id', request.agent_id);
        if (agentError) throw agentError;
      } else if (request.partner_id) {
        const { error: partnerError } = await supabase
          .from('partners')
          .update({ tier_id: request.requested_tier_id })
          .eq('id', request.partner_id);
        if (partnerError) throw partnerError;
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tier-requests'] });
      queryClient.invalidateQueries({ queryKey: ['agents'] });
    },
  });
}

export function useRejectTierRequest() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ requestId, adminNotes }: { requestId: string; adminNotes?: string }) => {
      const { error } = await supabase
        .from('tier_requests')
        .update({
          status: 'rejected',
          admin_notes: adminNotes || null,
          reviewed_at: new Date().toISOString(),
        })
        .eq('id', requestId);

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tier-requests'] });
    },
  });
}
