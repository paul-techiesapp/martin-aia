import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';

/** Fetches (or creates) the caller-agent's generic enquiry link code. */
export function useMyEnquiryLink() {
  return useQuery({
    queryKey: ['my-enquiry-link'],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('ensure_my_enquiry_link');
      if (error) throw error;
      return data as string;
    },
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
