import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { readEdgeFunctionError } from '@agent-system/shared-ui';
import type { Agent, AgentWithTier, TierRequest } from '@agent-system/shared-types';

export function useMySubAgents(agentId: string | undefined) {
  return useQuery({
    queryKey: ['my-sub-agents', agentId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('agents')
        .select('*, tier:tiers(*)')
        .eq('parent_agent_id', agentId!)
        .order('created_at', { ascending: false });

      if (error) throw error;
      return data as AgentWithTier[];
    },
    enabled: !!agentId,
  });
}

/**
 * Roster of every agent in a unit (the unit root + everyone whose
 * parent_agent_id is that root). Works for both a Unit Admin (root = own id →
 * self + sub-agents) and a Unit Manager (root = parent id → the whole unit).
 * RLS ("Unit viewers read unit agents") permits unit viewers to read these rows.
 */
export function useUnitRoster(unitRootId: string | undefined) {
  return useQuery({
    queryKey: ['unit-roster', unitRootId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('agents')
        .select('id, name')
        .or(`id.eq.${unitRootId},parent_agent_id.eq.${unitRootId}`)
        .order('name', { ascending: true });
      if (error) throw error;
      return data as { id: string; name: string }[];
    },
    enabled: !!unitRootId,
  });
}

export function useMyTierRequests(agentId: string | undefined) {
  return useQuery({
    queryKey: ['my-tier-requests', agentId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('tier_requests')
        .select('*')
        .eq('requested_by', agentId!)
        .order('created_at', { ascending: false });

      if (error) throw error;
      return data as TierRequest[];
    },
    enabled: !!agentId,
  });
}

export function useCreateSubAgent() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: {
      name: string;
      email: string;
      phone: string;
      nric?: string;
      agent_code: string;
      password: string;
    }) => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error('Not authenticated');

      const response = await supabase.functions.invoke('create-sub-agent', {
        body: input,
      });

      if (response.error) throw new Error(response.error.message || 'Failed to create sub-agent');
      if (response.data?.error) throw new Error(response.data.error);
      return response.data.agent as Agent;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['my-sub-agents'] });
    },
  });
}

export function useRequestTier() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: { agent_id?: string; partner_id?: string; tier_id: string }) => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error('Not authenticated');

      const response = await supabase.functions.invoke('request-tier', {
        body: input,
      });

      if (response.error) throw new Error(response.error.message || 'Failed to request tier');
      if (response.data?.error) throw new Error(response.data.error);
      return response.data.request as TierRequest;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['my-tier-requests'] });
      queryClient.invalidateQueries({ queryKey: ['my-sub-agents'] });
      queryClient.invalidateQueries({ queryKey: ['my-partners'] });
    },
  });
}

export function useUpdateSubAgent() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: {
      agent_id: string;
      name?: string;
      email?: string;
      phone?: string;
      nric?: string;
      agent_code?: string;
      tier_id?: string | null;
      status?: 'active' | 'inactive';
      is_unit_manager?: boolean;
      password?: string;
    }) => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error('Not authenticated');

      const response = await supabase.functions.invoke('update-sub-agent', {
        body: input,
      });

      if (response.error) {
        const { message } = await readEdgeFunctionError(response.error, 'Failed to update agent');
        throw new Error(message);
      }
      if (response.data?.error) throw new Error(response.data.error);
      return response.data.agent as Agent;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['my-sub-agents'] });
    },
  });
}

export function useDeleteUnitAgent() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: { agent_id: string }) => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error('Not authenticated');

      const response = await supabase.functions.invoke('delete-agent', {
        body: input,
      });

      if (response.error) {
        const { message } = await readEdgeFunctionError(response.error, 'Failed to delete agent');
        throw new Error(message);
      }
      if (response.data?.error) throw new Error(response.data.error);
      return response.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['my-sub-agents'] });
    },
  });
}

export function useAvailableTiers() {
  return useQuery({
    queryKey: ['available-tiers'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('tiers')
        .select('*')
        .order('name', { ascending: true });

      if (error) throw error;
      return data;
    },
  });
}
