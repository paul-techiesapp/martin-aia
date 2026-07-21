import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
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

/**
 * Postgres error codes raised by mark_vehicle_renewed, mapped to text an
 * agent can act on. Mirrors the mapping style of
 * apps/admin-portal/src/hooks/useEnquiries.ts:206-217.
 */
function markRenewedErrorMessage(error: { code?: string; message: string }): string {
  switch (error.code) {
    case 'P0014':
      return 'That car is no longer active on this enquiry.';
    case 'P0015':
      return 'This car is already renewed or closed.';
    case 'P0019':
      return 'This car was already marked renewed recently — no need to do it again.';
    case '42501':
      return "You can only mark your own customers' cars.";
    default:
      return error.message;
  }
}

/**
 * Agent-side "mark as renewed": advances a car's expiry by one year and
 * re-arms next year's reminder. Does NOT issue the gold gift — that stays a
 * merchant-confirmed action via confirm_vehicle_renewal. Resolves to the new
 * expiry date (yyyy-mm-dd) returned by the RPC.
 */
export function useMarkVehicleRenewed(agentId: string | undefined) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (vehicleId: string) => {
      const { data, error } = await supabase.rpc('mark_vehicle_renewed', {
        p_vehicle_id: vehicleId,
      });
      if (error) throw new Error(markRenewedErrorMessage(error));
      return data as string;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['my-enquiries', agentId] });
    },
  });
}

/**
 * Postgres error codes raised by the unit-scoped reassign_customer_agent,
 * mapped to text a unit viewer can act on. Mirrors the mapping style of
 * apps/admin-portal/src/hooks/useEnquiries.ts:206-217.
 */
function reassignEnquiryErrorMessage(error: { code?: string; message: string }): string {
  switch (error.code) {
    case '42501':
      return 'Only unit managers can reassign customers.';
    case 'P0011':
      return 'That agent is not active any more.';
    case 'P0017':
      return 'That agent is not in your unit.';
    case 'P0018':
      return 'This customer has enquiries outside your unit — ask the admin to reassign.';
    case '22023':
      return 'This customer has no IC on record.';
    default:
      return error.message;
  }
}

/**
 * Moves every open enquiry belonging to this customer's IC to another agent
 * inside the caller's unit. Unit viewers only (RLS/RPC enforce this too).
 * Resolves to the number of enquiries moved.
 */
export function useReassignEnquiryAgent() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      customerNric,
      newAgentId,
    }: {
      customerNric: string;
      newAgentId: string;
    }) => {
      const { data, error } = await supabase.rpc('reassign_customer_agent', {
        p_customer_nric: customerNric,
        p_new_agent_id: newAgentId,
      });
      if (error) throw new Error(reassignEnquiryErrorMessage(error));
      return (data ?? 0) as number;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['my-enquiries'] });
    },
  });
}
