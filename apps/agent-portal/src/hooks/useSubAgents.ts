import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { readEdgeFunctionError } from '@agent-system/shared-ui';
import type { Agent, AgentWithTier, TierRequest, UnitFormSettings } from '@agent-system/shared-types';

/**
 * The caller's unit root, resolved SERVER-SIDE by the recursive get_unit_root()
 * RPC (top-most ancestor). The old client-side `parent_agent_id ?? id`
 * derivation silently broke for multi-level units — a manager linked under a
 * root computed the wrong "unit" for their own team. Do not reintroduce it.
 */
export function useUnitRoot(enabled = true) {
  return useQuery({
    queryKey: ['unit-root'],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('get_unit_root');
      if (error) throw error;
      return (data as string | null) ?? null;
    },
    enabled,
  });
}

/**
 * Fetches the caller's unit member ids via the recursive unit_member_ids()
 * RPC — the same SECURITY DEFINER helper the RLS policies use, so the portal
 * can never disagree with what RLS permits. Empty for non unit-viewers.
 */
async function fetchUnitMemberIds(): Promise<string[]> {
  const { data, error } = await supabase.rpc('unit_member_ids');
  if (error) throw error;
  return (data as string[] | null) ?? [];
}

/**
 * Every agent in the caller's unit EXCEPT the unit root, with tier — the
 * management list for MyAgents/Dashboard. For a Unit Admin that's everyone
 * under them (incl. sub-unit teams); for a manager/deputy it's the whole unit
 * minus the boss's own row (never rendered, never deletable here).
 */
export function useMySubAgents(enabled: boolean) {
  return useQuery({
    queryKey: ['my-sub-agents'],
    queryFn: async () => {
      const [ids, rootRes] = await Promise.all([
        fetchUnitMemberIds(),
        supabase.rpc('get_unit_root'),
      ]);
      if (rootRes.error) throw rootRes.error;
      const rootId = rootRes.data as string | null;
      const memberIds = ids.filter((id) => id !== rootId);
      if (memberIds.length === 0) return [] as AgentWithTier[];

      const { data, error } = await supabase
        .from('agents')
        .select('*, tier:tiers(*)')
        .in('id', memberIds)
        .order('created_at', { ascending: false });

      if (error) throw error;
      return data as AgentWithTier[];
    },
    enabled,
  });
}

/**
 * Roster of every agent in the caller's unit (root + entire subtree), from the
 * recursive unit_member_ids() RPC. Works for Unit Admins, deputies AND
 * mid-level managers with their own teams — the previous flat
 * `parent_agent_id = root` filter missed grandchildren.
 */
export function useUnitRoster(enabled: boolean) {
  return useQuery({
    queryKey: ['unit-roster'],
    queryFn: async () => {
      const ids = await fetchUnitMemberIds();
      if (ids.length === 0) return [] as { id: string; name: string }[];
      const { data, error } = await supabase
        .from('agents')
        .select('id, name')
        .in('id', ids)
        .order('name', { ascending: true });
      if (error) throw error;
      return data as { id: string; name: string }[];
    },
    enabled,
  });
}

/**
 * Reads the unit root's enquiry-form footer image (round 6, item 6). Always
 * fetches the ROOT row by id — works for both a Unit Admin (root = own id)
 * and a Unit Manager deputy (root = parent id, a different row than their own).
 */
export function useUnitFooterImage(unitRootId: string | undefined) {
  return useQuery({
    queryKey: ['unit-footer-image', unitRootId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('agents')
        .select('form_settings')
        .eq('id', unitRootId!)
        .single();
      if (error) throw error;
      const settings = data?.form_settings as UnitFormSettings | null;
      return settings?.footer_image_url ?? null;
    },
    enabled: !!unitRootId,
  });
}

/**
 * Sets (or clears, with '') the unit root's enquiry-form footer image via the
 * set_unit_footer_image SECURITY DEFINER RPC — unit callers have no RLS
 * UPDATE grant on `agents`, so this can't go through a direct table write.
 */
export function useSetUnitFooter() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (url: string) => {
      const { error } = await supabase.rpc('set_unit_footer_image', { p_url: url });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['my-sub-agents'] });
      queryClient.invalidateQueries({ queryKey: ['unit-footer-image'] });
    },
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
