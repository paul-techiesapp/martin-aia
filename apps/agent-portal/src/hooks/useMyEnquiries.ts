import { useQuery } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import type { Enquiry, EnquiryVehicle } from '@agent-system/shared-types';

export interface EnquiryVehicleWithProduct extends EnquiryVehicle {
  product: { name: string } | null;
  /** Per-car partner, set when admin confirms a renewal. */
  merchant: { name: string } | null;
}

export interface EnquiryWithDetails extends Enquiry {
  /** Assigned merchant (v2 — set via assign_enquiry_merchant). */
  merchant_id: string | null;
  merchant: { name: string } | null;
  /** Legacy branch context (may be null for v2 generic-link enquiries). */
  branch: { name: string; merchant: { name: string } | null } | null;
  vehicles: EnquiryVehicleWithProduct[];
}

// Enquiries owned by this agent, with assigned merchant and each vehicle's
// product, for follow-up and partnership assignment.
export function useMyEnquiries(agentId: string | undefined) {
  return useQuery({
    queryKey: ['my-enquiries', agentId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('enquiries')
        .select(`
          *,
          merchant:merchants(name),
          branch:merchant_branches(name, merchant:merchants(name)),
          vehicles:enquiry_vehicles(*, product:insurance_products(name), merchant:merchants(name))
        `)
        .eq('agent_id', agentId!)
        .order('created_at', { ascending: false });

      if (error) throw error;
      return (data ?? []) as EnquiryWithDetails[];
    },
    enabled: !!agentId,
  });
}
