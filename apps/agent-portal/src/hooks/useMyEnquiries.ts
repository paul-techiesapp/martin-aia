import { useQuery } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import type { Enquiry, EnquiryVehicle } from '@agent-system/shared-types';

export interface EnquiryVehicleWithProduct extends EnquiryVehicle {
  product: { name: string } | null;
}

export interface EnquiryWithDetails extends Enquiry {
  branch: { name: string; merchant: { name: string } | null } | null;
  vehicles: EnquiryVehicleWithProduct[];
}

// Enquiries that flowed through the agent's branch links (agent_id snapshot =
// get_agent_id()), with each car and its product, for follow-up.
export function useMyEnquiries(agentId: string | undefined) {
  return useQuery({
    queryKey: ['my-enquiries', agentId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('enquiries')
        .select(`
          *,
          branch:merchant_branches(name, merchant:merchants(name)),
          vehicles:enquiry_vehicles(*, product:insurance_products(name))
        `)
        .eq('agent_id', agentId!)
        .order('created_at', { ascending: false });

      if (error) throw error;
      return (data ?? []) as EnquiryWithDetails[];
    },
    enabled: !!agentId,
  });
}
