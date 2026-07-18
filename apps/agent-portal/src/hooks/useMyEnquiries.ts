import { useQuery } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import type { Enquiry, EnquiryVehicle } from '@agent-system/shared-types';

export interface EnquiryVehicleWithProduct extends EnquiryVehicle {
  product: { name: string } | null;
  /** Per-car partner, set when admin confirms a renewal. */
  merchant: { id: string; name: string } | null;
}

export interface EnquiryWithDetails extends Enquiry {
  /** Assigned merchant (v2 — set via assign_enquiry_merchant). */
  merchant_id: string | null;
  merchant: { id: string; name: string } | null;
  /** Legacy branch context (may be null for v2 generic-link enquiries). */
  branch: { name: string; merchant: { name: string } | null } | null;
  vehicles: EnquiryVehicleWithProduct[];
  /** Owning agent (for unit viewers seeing the whole unit). */
  agent: { id: string; name: string; agent_code: string } | null;
}

// Enquiries visible to this agent, with assigned merchant and each vehicle's
// product, for follow-up and partnership assignment. Unit viewers (Unit
// Manager / Unit Admin) fetch WITHOUT the agent filter — RLS scopes rows to
// their unit.
export function useMyEnquiries(agentId: string | undefined, unitWide = false) {
  return useQuery({
    queryKey: ['my-enquiries', agentId, unitWide],
    queryFn: async () => {
      let query = supabase
        .from('enquiries')
        .select(`
          *,
          agent:agents(id, name, agent_code),
          merchant:merchants(id, name),
          branch:merchant_branches(name, merchant:merchants(name)),
          vehicles:enquiry_vehicles(*, product:insurance_products(name), merchant:merchants(id, name))
        `)
        .is('vehicles.removed_at', null)
        .order('created_at', { ascending: false });

      if (!unitWide) query = query.eq('agent_id', agentId!);

      const { data, error } = await query;

      if (error) throw error;
      return (data ?? []) as EnquiryWithDetails[];
    },
    enabled: !!agentId,
  });
}
