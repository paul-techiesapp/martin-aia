import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';

/**
 * Assigns one specific vehicle (car) within an enquiry to an active merchant
 * partnership. Mirrors useAssignEnquiryMerchant but scopes to a single car so
 * each vehicle in a multi-car enquiry can go to a different partner.
 */
export function useAssignVehicleMerchant(agentId: string | undefined) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      vehicleId,
      merchantId,
    }: {
      vehicleId: string;
      merchantId: string;
    }) => {
      const { error } = await supabase.rpc('assign_vehicle_merchant', {
        p_vehicle_id: vehicleId,
        p_merchant_id: merchantId,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['my-enquiries', agentId] });
    },
  });
}
