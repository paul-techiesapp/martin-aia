import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import type { Invitation, InvitationWithRelations, CapacityType } from '@agent-system/shared-types';
import { InvitationStatus } from '@agent-system/shared-types';

export function useMyInvitations(agentId: string | undefined) {
  return useQuery({
    queryKey: ['my-invitations', agentId],
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
        .eq('agent_id', agentId)
        .order('created_at', { ascending: false });

      if (error) throw error;
      return data as InvitationWithRelations[];
    },
    enabled: !!agentId,
  });
}

export function useCreateInvitations() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      agentId,
      slotId,
      capacityType,
      count,
    }: {
      agentId: string;
      slotId: string;
      capacityType: CapacityType;
      count: number;
    }) => {
      const invitations: Omit<Invitation, 'id' | 'created_at' | 'updated_at'>[] = [];

      for (let i = 0; i < count; i++) {
        invitations.push({
          agent_id: agentId,
          slot_id: slotId,
          capacity_type: capacityType,
          unique_token: crypto.randomUUID(),
          status: InvitationStatus.PENDING,
          invitee_name: null,
          invitee_nric: null,
          invitee_phone: null,
          invitee_email: null,
          invitee_occupation: null,
          registered_at: null,
        });
      }

      const { data, error } = await supabase
        .from('invitations')
        .insert(invitations)
        .select();

      if (error) throw error;
      return data as Invitation[];
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ['my-invitations', variables.agentId] });
      queryClient.invalidateQueries({ queryKey: ['invitation-count'] });
    },
  });
}

export function useInvitationCount(agentId: string | undefined, slotId: string) {
  return useQuery({
    queryKey: ['invitation-count', agentId, slotId],
    queryFn: async () => {
      const { count, error } = await supabase
        .from('invitations')
        .select('*', { count: 'exact', head: true })
        .eq('agent_id', agentId)
        .eq('slot_id', slotId);

      if (error) throw error;
      return count ?? 0;
    },
    enabled: !!agentId && !!slotId,
  });
}
