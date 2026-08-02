import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';

/**
 * Fetches (or creates) the caller-agent's generic enquiry link code.
 * Every active agent has one, Unit Managers (unit roots) included — they print
 * theirs as a QR code for gold-scanning at fairs. Round 6 briefly excluded
 * roots (server-side P0016 + a client-side gate); that was reverted on
 * 2026-08-02 after printed QRs went dead mid-event. Do not re-add a root gate.
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
