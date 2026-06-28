import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import type { BranchLink, MerchantBranch, Merchant } from '@agent-system/shared-types';

export interface BranchLinkWithBranch extends BranchLink {
  branch: MerchantBranch & { merchant: Merchant | null };
}

export function useMyBranchLinks(agentId: string | undefined) {
  return useQuery({
    queryKey: ['my-branch-links', agentId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('branch_links')
        .select('*, branch:merchant_branches(*, merchant:merchants(*))')
        .eq('agent_id', agentId!)
        .eq('is_active', true)
        .order('created_at', { ascending: false });

      if (error) throw error;
      // Drop any link whose branch the client can't read (e.g. branch later
      // deactivated → branch=null) so the non-null `branch` type holds.
      return ((data ?? []) as BranchLinkWithBranch[]).filter((l) => l.branch != null);
    },
    enabled: !!agentId,
  });
}

export function useCreateBranchLink() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      agentId,
      merchantBranchId,
    }: {
      agentId: string;
      merchantBranchId: string;
    }) => {
      // Upsert: reuse the agent's existing active link for this branch if any
      // (one shareable QR per agent+branch), mirroring useCreateLink.
      const { data: existing, error: findError } = await supabase
        .from('branch_links')
        .select('*')
        .eq('agent_id', agentId)
        .eq('merchant_branch_id', merchantBranchId)
        .eq('is_active', true)
        .maybeSingle();

      if (findError) throw findError;
      if (existing) return existing as BranchLink;

      // link_code has no DB default — generate it client-side (see Global Constraints).
      const { data, error } = await supabase
        .from('branch_links')
        .insert({
          agent_id: agentId,
          merchant_branch_id: merchantBranchId,
          link_code: crypto.randomUUID(),
          is_active: true,
        })
        .select()
        .single();

      if (error) throw error;
      return data as BranchLink;
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ['my-branch-links', variables.agentId] });
    },
  });
}
