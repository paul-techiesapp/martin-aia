import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import type { InvitationWithRelations } from '@agent-system/shared-types';

export function useAvailableInvitations(partnerAgentId: string | undefined) {
  return useQuery({
    queryKey: ['available-invitations', partnerAgentId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('invitations')
        .select(`
          *,
          slot:slots(
            *,
            campaign:campaigns(*)
          )
        `)
        .eq('agent_id', partnerAgentId)
        .is('claimed_by_partner_id', null)
        .eq('status', 'pending')
        .order('created_at', { ascending: false });

      if (error) throw error;
      return data as InvitationWithRelations[];
    },
    enabled: !!partnerAgentId,
  });
}

export function useMyClaimedInvitations(partnerId: string | undefined) {
  return useQuery({
    queryKey: ['my-claimed-invitations', partnerId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('invitations')
        .select(`
          *,
          slot:slots(
            *,
            campaign:campaigns(*)
          )
        `)
        .eq('claimed_by_partner_id', partnerId)
        .order('created_at', { ascending: false });

      if (error) throw error;
      return data as InvitationWithRelations[];
    },
    enabled: !!partnerId,
  });
}

export function useClaimInvitation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      invitationId,
      partnerId,
    }: {
      invitationId: string;
      partnerId: string;
    }) => {
      const { data, error } = await supabase
        .from('invitations')
        .update({ claimed_by_partner_id: partnerId })
        .eq('id', invitationId)
        .is('claimed_by_partner_id', null)
        .select();

      if (error) throw error;

      // If no rows were updated, another partner claimed it first
      if (!data || data.length === 0) {
        throw new Error('ALREADY_CLAIMED');
      }

      return data[0];
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['available-invitations'] });
      queryClient.invalidateQueries({ queryKey: ['my-claimed-invitations'] });
    },
  });
}
