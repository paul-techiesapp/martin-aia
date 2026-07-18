import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { VehicleStatus, EnquiryStatus } from '@agent-system/shared-types';

export interface EnquiryVehicleRow {
  id: string;
  car_plate: string;
  insurance_expiry_date: string;
  status: VehicleStatus;
  merchant_id: string | null;
  renewal_premium_amount: number | null;
  road_tax_renewal: boolean;
  external_quotation_ref: string | null;
  quoted_at: string | null;
  renewed_at: string | null;
  lost_at: string | null;
  lost_reason: string | null;
  removed_at: string | null;
  removed_by_customer: boolean;
  product: { id: string; name: string } | null;
}

export interface EnquiryListVehicle {
  id: string;
  status: VehicleStatus;
  car_plate: string;
  insurance_expiry_date: string;
  road_tax_renewal: boolean;
  removed_at: string | null;
  removed_by_customer: boolean;
  merchant: { name: string } | null;
}

export interface EnquiryListAgent {
  id: string;
  name: string;
  agent_code: string;
  unit_name: string;
  parent_agent_id: string | null;
}

export interface EnquiryListRow {
  id: string;
  customer_name: string;
  customer_phone: string;
  customer_email: string | null;
  customer_nric: string;
  /** Referring staff ID captured on branch (master-partner) enquiry forms; optional. */
  staff_id: string | null;
  status: EnquiryStatus;
  created_at: string;
  agent_id: string | null;
  merchant_id: string | null;
  merchant: { id: string; name: string } | null;
  agent: EnquiryListAgent | null;
  vehicles: EnquiryListVehicle[];
}

export interface EnquiryDetailRow {
  id: string;
  customer_name: string;
  customer_phone: string;
  customer_nric: string;
  customer_email: string | null;
  status: EnquiryStatus;
  created_at: string;
  agent_id: string | null;
  merchant_id: string | null;
  merchant: { id: string; name: string } | null;
  agent: { id: string; name: string; agent_code: string; unit_name: string } | null;
  vehicles: EnquiryVehicleRow[];
}

export function useEnquiries() {
  return useQuery({
    queryKey: ['enquiries'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('enquiries')
        .select(`
          id, customer_name, customer_phone, customer_email, customer_nric, staff_id, status, created_at, agent_id,
          merchant_id, merchant:merchants(id, name),
          agent:agents(id, name, agent_code, unit_name, parent_agent_id),
          vehicles:enquiry_vehicles(id, status, car_plate, insurance_expiry_date, road_tax_renewal, removed_at, removed_by_customer, merchant:merchants(name))
        `)
        .order('created_at', { ascending: false });

      if (error) throw error;
      return (data ?? []) as unknown as EnquiryListRow[];
    },
  });
}

export function useEnquiry(id: string) {
  return useQuery({
    queryKey: ['enquiries', id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('enquiries')
        .select(`
          id, customer_name, customer_phone, customer_nric, customer_email, status, created_at, agent_id,
          merchant_id, merchant:merchants(id, name),
          agent:agents(id, name, agent_code, unit_name),
          vehicles:enquiry_vehicles(
            id, car_plate, insurance_expiry_date, status, merchant_id, renewal_premium_amount,
            road_tax_renewal, external_quotation_ref,
            quoted_at, renewed_at, lost_at, lost_reason,
            removed_at, removed_by_customer,
            product:insurance_products(id, name)
          )
        `)
        .eq('id', id)
        .single();

      if (error) throw error;
      return data as unknown as EnquiryDetailRow;
    },
    enabled: !!id,
  });
}

export function useRecordQuotation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      vehicleId,
      externalRef,
    }: {
      vehicleId: string;
      enquiryId: string;
      externalRef: string | null;
    }) => {
      const { error } = await supabase.rpc('record_quotation', {
        p_vehicle_id: vehicleId,
        p_external_ref: externalRef,
      });
      if (error) throw error;
    },
    onSuccess: (_data, vars) => {
      queryClient.invalidateQueries({ queryKey: ['enquiries'] });
      queryClient.invalidateQueries({ queryKey: ['enquiries', vars.enquiryId] });
    },
  });
}

export function useMarkVehicleLost() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      vehicleId,
      reason,
    }: {
      vehicleId: string;
      enquiryId: string;
      reason: string | null;
    }) => {
      const { error } = await supabase.rpc('mark_vehicle_lost', {
        p_vehicle_id: vehicleId,
        p_reason: reason,
      });
      if (error) throw error;
    },
    onSuccess: (_data, vars) => {
      queryClient.invalidateQueries({ queryKey: ['enquiries'] });
      queryClient.invalidateQueries({ queryKey: ['enquiries', vars.enquiryId] });
    },
  });
}

export function useConfirmVehicleRenewal() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      vehicleId,
      premiumAmount,
      merchantId,
    }: {
      vehicleId: string;
      enquiryId: string;
      premiumAmount: number;
      merchantId: string;
    }) => {
      const { error } = await supabase.rpc('confirm_vehicle_renewal', {
        p_vehicle_id: vehicleId,
        p_premium_amount: premiumAmount,
        p_merchant_id: merchantId,
      });
      if (error) throw error;
    },
    onSuccess: (_data, vars) => {
      queryClient.invalidateQueries({ queryKey: ['enquiries'] });
      queryClient.invalidateQueries({ queryKey: ['enquiries', vars.enquiryId] });
      // Renewal mints ledgers — refresh the payout pages too.
      queryClient.invalidateQueries({ queryKey: ['gifts'] });
      queryClient.invalidateQueries({ queryKey: ['merchant-commissions'] });
      queryClient.invalidateQueries({ queryKey: ['merchant-settlements'] });
    },
  });
}

/**
 * Postgres error codes raised by reassign_customer_agent, mapped to text an
 * admin can act on. Without this the raw plpgsql message reaches the toast —
 * the existing behavior everywhere else in this portal.
 */
function reassignErrorMessage(error: { code?: string; message: string }): string {
  switch (error.code) {
    case '42501':
      return 'Only admins can reassign a customer.';
    case '22023':
      return 'This customer has no IC on record, so they cannot be reassigned.';
    case 'P0011':
      return 'That agent is not active any more. Pick a different agent.';
    default:
      return error.message;
  }
}

/**
 * Moves every OPEN enquiry belonging to this customer's IC to another agent.
 * Enquiries whose cars are all renewed/lost stay with the original agent, so
 * past renewal credit is not rewritten. Resolves to the number moved; 0 means
 * the customer had no open work and is not an error.
 */
export function useReassignCustomerAgent() {
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
      if (error) throw new Error(reassignErrorMessage(error));
      return (data ?? 0) as number;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['enquiries'] });
    },
  });
}
