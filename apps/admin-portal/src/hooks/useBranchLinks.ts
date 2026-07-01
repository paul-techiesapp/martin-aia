import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import type { BranchLink } from '@agent-system/shared-types';

export function useBranchLinks(branchId: string) {
  return useQuery({
    queryKey: ['branch_links', branchId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('branch_links')
        .select('*')
        .eq('merchant_branch_id', branchId)
        .order('created_at', { ascending: false });

      if (error) throw error;
      return data as BranchLink[];
    },
    enabled: !!branchId,
  });
}

// Supports optional agent_id: pass null for a house link (no agent commission),
// or a valid agent UUID to tie the QR to a specific agent.
export function useCreateBranchLink() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ branchId, agentId }: { branchId: string; agentId?: string | null }) => {
      const { data, error } = await supabase
        .from('branch_links')
        .insert({
          merchant_branch_id: branchId,
          agent_id: agentId ?? null,
          link_code: crypto.randomUUID(),
          is_active: true,
        })
        .select()
        .single();

      if (error) throw error;
      return data as BranchLink;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['branch_links', data.merchant_branch_id] });
    },
  });
}

// Deactivate (never delete) — enquiries FK-reference branch_links, so we keep the
// row and just flip is_active so the public link stops resolving.
export function useDeactivateBranchLink(branchId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from('branch_links')
        .update({ is_active: false })
        .eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['branch_links', branchId] });
    },
  });
}
