import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { MerchantStatus, type Merchant, type MerchantBranch } from '@agent-system/shared-types';

export interface MerchantWithBranches extends Merchant {
  // RLS returns only active OR agent-owned branches, so this array already
  // excludes other agents' pending proposals.
  branches: MerchantBranch[];
}

// Every merchant row the agent is allowed to see (active ones for browsing +
// the agent's own pending proposals), each with its visible branches embedded.
export function useAgentMerchants() {
  return useQuery({
    queryKey: ['agent-merchants'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('merchants')
        .select('*, branches:merchant_branches(*)')
        .order('name', { ascending: true });

      if (error) throw error;
      return data as MerchantWithBranches[];
    },
  });
}

// Agent proposes a new merchant. RLS requires status='pending' and
// created_by_agent_id=get_agent_id(); the money split is admin-set on approval.
export function useProposeMerchant() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ name, agentId }: { name: string; agentId: string }) => {
      const { data, error } = await supabase
        .from('merchants')
        .insert({
          name,
          status: MerchantStatus.PENDING,
          created_by_agent_id: agentId,
        })
        .select()
        .single();

      if (error) throw error;
      return data as Merchant;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['agent-merchants'] });
    },
  });
}

// Agent proposes a branch under a merchant (the merchant may be active or the
// agent's own pending one). RLS requires status='pending' + own created_by.
export function useProposeBranch() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      merchantId,
      name,
      address,
      phone,
      agentId,
    }: {
      merchantId: string;
      name: string;
      address: string;
      phone: string;
      agentId: string;
    }) => {
      const { data, error } = await supabase
        .from('merchant_branches')
        .insert({
          merchant_id: merchantId,
          name,
          address: address.trim() === '' ? null : address.trim(),
          phone: phone.trim() === '' ? null : phone.trim(),
          status: MerchantStatus.PENDING,
          created_by_agent_id: agentId,
        })
        .select()
        .single();

      if (error) throw error;
      return data as MerchantBranch;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['agent-merchants'] });
    },
  });
}
