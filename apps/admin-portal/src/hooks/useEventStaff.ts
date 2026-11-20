import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { readEdgeFunctionError } from '@agent-system/shared-ui';
import type { Campaign, Slot } from '@agent-system/shared-types';
import { supabase } from '../lib/supabase';

export interface EventStaffMember {
  user_id: string;
  name: string;
  email: string;
  created_at: string;
  assignments: { campaign_id: string; campaign: { id: string; name: string; status: string } | null }[];
}

/** Admin: every event-staff login with the events assigned to it. */
export function useEventStaffList() {
  return useQuery({
    queryKey: ['event-staff'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('event_staff')
        .select('user_id, name, email, created_at, assignments:campaign_staff(campaign_id, campaign:campaigns(id, name, status))')
        .order('name', { ascending: true });
      if (error) throw error;
      return (data ?? []) as unknown as EventStaffMember[];
    },
  });
}

async function invokeManage(body: Record<string, unknown>, fallback: string) {
  const response = await supabase.functions.invoke('manage-event-staff', { body });
  if (response.error) {
    const { message } = await readEdgeFunctionError(response.error, fallback);
    throw new Error(message);
  }
  if (response.data?.error) throw new Error(response.data.error);
  return response.data;
}

export function useCreateEventStaff() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { name: string; email: string; password: string }) =>
      invokeManage({ action: 'create', ...input }, 'Failed to create staff login'),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['event-staff'] }),
  });
}

export function useSetEventStaffPassword() {
  return useMutation({
    mutationFn: (input: { user_id: string; password: string }) =>
      invokeManage({ action: 'set_password', ...input }, 'Failed to reset password'),
  });
}

export function useDeleteEventStaff() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (user_id: string) => invokeManage({ action: 'delete', user_id }, 'Failed to delete staff login'),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['event-staff'] }),
  });
}

/** Admin: replace the set of events a staff login may check in for. */
export function useSetEventStaffAssignments() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ user_id, campaignIds, current }: { user_id: string; campaignIds: string[]; current: string[] }) => {
      const toAdd = campaignIds.filter((id) => !current.includes(id));
      const toRemove = current.filter((id) => !campaignIds.includes(id));
      if (toRemove.length > 0) {
        const { error } = await supabase
          .from('campaign_staff')
          .delete()
          .eq('user_id', user_id)
          .in('campaign_id', toRemove);
        if (error) throw error;
      }
      if (toAdd.length > 0) {
        const { error } = await supabase
          .from('campaign_staff')
          .insert(toAdd.map((campaign_id) => ({ campaign_id, user_id })));
        if (error) throw error;
      }
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['event-staff'] }),
  });
}

/** Event staff: only the events assigned to the signed-in staff login. */
export function useMyStaffCampaigns(enabled: boolean) {
  return useQuery({
    queryKey: ['my-staff-campaigns'],
    enabled,
    queryFn: async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return [] as Campaign[];
      const { data, error } = await supabase
        .from('campaign_staff')
        .select('campaign:campaigns(*)')
        .eq('user_id', user.id);
      if (error) throw error;
      return ((data ?? []) as unknown as { campaign: Campaign | null }[])
        .map((r) => r.campaign)
        .filter((c): c is Campaign => !!c)
        .sort((a, b) => (b.created_at ?? '').localeCompare(a.created_at ?? ''));
    },
  });
}

/** Active slots of one event, for opening the checkout (venue) display. */
export function useEventSlots(campaignId: string) {
  return useQuery({
    queryKey: ['event-slots', campaignId],
    enabled: !!campaignId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('slots')
        .select('*')
        .eq('campaign_id', campaignId)
        .eq('is_active', true)
        .order('start_at', { ascending: true });
      if (error) throw error;
      return (data ?? []) as Slot[];
    },
  });
}
