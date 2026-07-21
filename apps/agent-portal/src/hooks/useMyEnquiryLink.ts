import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';

/**
 * Fetches (or creates) the caller-agent's generic enquiry link code.
 * `enabled` defaults to true; pass false for unit roots (agent_admin), who
 * have no personal link — server-side ensure_my_enquiry_link raises P0016
 * for them, so callers should gate the query client-side too.
 */
export function useMyEnquiryLink(enabled: boolean = true) {
  return useQuery({
    queryKey: ['my-enquiry-link'],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('ensure_my_enquiry_link');
      if (error) throw error;
      return data as string;
    },
    enabled,
  });
}

/** Assigns one of the agent's enquiries to an active merchant partnership. */
export function useAssignEnquiryMerchant(agentId: string | undefined) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      enquiryId,
      merchantId,
    }: {
      enquiryId: string;
      merchantId: string;
    }) => {
      const { error } = await supabase.rpc('assign_enquiry_merchant', {
        p_enquiry_id: enquiryId,
        p_merchant_id: merchantId,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['my-enquiries', agentId] });
    },
  });
}
