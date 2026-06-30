import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';

// Requests a quote for a single enquiry vehicle. Invokes the send-quote-request
// edge function, which emails the admin and stamps quote_requested_at on the
// vehicle. On success we refresh the agent's enquiry list so the per-car cell
// flips to "Quote requested".
export function useRequestQuote(agentId?: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ enquiryId, vehicleId }: { enquiryId: string; vehicleId: string }) => {
      const { data, error } = await supabase.functions.invoke('send-quote-request', {
        body: { enquiry_id: enquiryId, vehicle_id: vehicleId },
      });
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      if (agentId) qc.invalidateQueries({ queryKey: ['my-enquiries', agentId] });
    },
  });
}
