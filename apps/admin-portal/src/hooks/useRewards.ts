import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { RewardStatus } from '@agent-system/shared-types';
import type { CapacityType } from '@agent-system/shared-types';

/**
 * A single reward row joined to its agent and, through the 1:1 attendance row,
 * the underlying registration (attendee) and event. Used by the admin Rewards
 * page so an admin can verify and update issuance status.
 */
export interface AdminRewardRow {
  id: string;
  amount: number;
  status: RewardStatus;
  issued_at: string | null;
  failure_reason: string | null;
  capacity_type: CapacityType;
  created_at: string;
  agent: { name: string; unit_name: string; agent_code: string } | null;
  attendance: {
    checkin_time: string | null;
    checkout_time: string | null;
    registration: {
      invitee_name: string | null;
      invitee_phone: string | null;
      invitee_nric: string | null;
      slot: { start_at: string; campaign: { id: string; name: string } | null } | null;
    } | null;
  } | null;
}

export function useRewards() {
  return useQuery({
    queryKey: ['admin-rewards'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('rewards')
        .select(`
          id, amount, status, issued_at, failure_reason, capacity_type, created_at,
          agent:agents(name, unit_name, agent_code),
          attendance:attendance(
            checkin_time, checkout_time,
            registration:registrations(
              invitee_name, invitee_phone, invitee_nric,
              slot:slots(start_at, campaign:campaigns(id, name))
            )
          )
        `)
        .order('created_at', { ascending: false });

      if (error) throw error;
      // PostgREST returns to-one embeds as objects; the generated types widen them
      // to arrays, so cast through unknown to our explicit row shape.
      return (data ?? []) as unknown as AdminRewardRow[];
    },
  });
}

export function useSetRewardStatus() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      id,
      status,
      reason,
    }: {
      id: string;
      status: RewardStatus;
      reason?: string;
    }) => {
      const { error } = await supabase.rpc('set_reward_status', {
        p_reward_id: id,
        p_status: status,
        p_reason: reason ?? null,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-rewards'] });
      queryClient.invalidateQueries({ queryKey: ['report-stats'] });
    },
  });
}
