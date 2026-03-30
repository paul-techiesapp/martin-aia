import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
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
    mutationFn: async (input: { agent_id: string; tier_id: string }) => {
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
    },
  });
}

export function useDeactivateSubAgent() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (agentId: string) => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error('Not authenticated');

      const response = await supabase.functions.invoke('deactivate-sub-agent', {
        body: { agent_id: agentId },
      });

      if (response.error) throw new Error(response.error.message || 'Failed to deactivate sub-agent');
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
