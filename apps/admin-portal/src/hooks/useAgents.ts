import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import type { Agent, AgentWithTier } from '@agent-system/shared-types';

export function useAgents() {
  return useQuery({
    queryKey: ['agents'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('agents')
        .select(`
          *,
          tier:tiers(*)
        `)
        .is('parent_agent_id', null)
        .order('name', { ascending: true });

      if (error) throw error;
      return data as AgentWithTier[];
    },
  });
}

export function useAgent(id: string) {
  return useQuery({
    queryKey: ['agents', id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('agents')
        .select(`
          *,
          tier:tiers(*)
        `)
        .eq('id', id)
        .single();

      if (error) throw error;
      return data as AgentWithTier;
    },
    enabled: !!id,
  });
}

export interface CreateAgentInput {
  name: string;
  email: string;
  phone: string;
  nric?: string;
  agent_code: string;
  unit_name: string;
  tier_id: string;
  status: Agent['status'];
  is_unit_manager: boolean;
  password: string;
}

export class CreateAgentError extends Error {
  field?: keyof CreateAgentInput;
  constructor(message: string, field?: keyof CreateAgentInput) {
    super(message);
    this.name = 'CreateAgentError';
    this.field = field;
  }
}

export function useCreateAgent() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: CreateAgentInput) => {
      const response = await supabase.functions.invoke('create-agent', {
        body: input,
      });

      if (response.data?.error) {
        throw new CreateAgentError(response.data.error, response.data.field);
      }
      if (response.error) {
        throw new CreateAgentError(response.error.message || 'Failed to create agent');
      }
      return response.data.agent as Agent;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['agents'] });
    },
  });
}

export function useUpdateAgent() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ id, ...updates }: Partial<Agent> & { id: string }) => {
      const { data, error } = await supabase
        .from('agents')
        .update(updates)
        .eq('id', id)
        .select()
        .single();

      if (error) throw error;
      return data as Agent;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['agents'] });
      queryClient.invalidateQueries({ queryKey: ['agents', data.id] });
    },
  });
}

export function useDeleteAgent() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (id: string) => {
      // Delete via the edge function so the underlying auth.users records are removed
      // too (agent + its sub-agents + their partners). A direct table delete would
      // leave orphaned auth users and keep their emails reserved, blocking re-creation.
      const response = await supabase.functions.invoke('delete-agent', {
        body: { agent_id: id },
      });

      if (response.data?.error) {
        throw new Error(response.data.error);
      }
      if (response.error) {
        throw new Error(response.error.message || 'Failed to delete agent');
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['agents'] });
    },
  });
}
