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

// House link: agent_id NULL (no agent commission). link_code has no DB default,
// so generate a stable code client-side (crypto.randomUUID is available in the
// browser, mirroring the UUID link_code the agent_links flow uses).
export function useCreateBranchLink() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (branchId: string) => {
      const { data, error } = await supabase
        .from('branch_links')
        .insert({
          merchant_branch_id: branchId,
          agent_id: null,
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
