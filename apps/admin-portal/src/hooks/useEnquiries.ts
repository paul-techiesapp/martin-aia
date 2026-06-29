import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { VehicleStatus, EnquiryStatus } from '@agent-system/shared-types';

export interface EnquiryVehicleRow {
  id: string;
  car_plate: string;
  insurance_expiry_date: string;
  status: VehicleStatus;
  external_quotation_ref: string | null;
  quoted_at: string | null;
  renewed_at: string | null;
  lost_at: string | null;
  lost_reason: string | null;
  product: { id: string; name: string } | null;
}

export interface EnquiryListRow {
  id: string;
  customer_name: string;
  customer_phone: string;
  customer_nric: string;
  status: EnquiryStatus;
  created_at: string;
  agent_id: string | null;
  merchant_id: string | null;
  merchant: { id: string; name: string } | null;
  vehicles: { id: string; status: VehicleStatus }[];
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
  merchant: { id: string; name: string; gift_pool_amount: number; merchant_share_pct: number } | null;
  agent: { id: string; name: string; agent_code: string } | null;
  vehicles: EnquiryVehicleRow[];
}

export function useEnquiries() {
  return useQuery({
    queryKey: ['enquiries'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('enquiries')
        .select(`
          id, customer_name, customer_phone, customer_nric, status, created_at, agent_id,
          merchant_id, merchant:merchants(id, name),
          vehicles:enquiry_vehicles(id, status)
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
          merchant_id, merchant:merchants(id, name, gift_pool_amount, merchant_share_pct),
          agent:agents(id, name, agent_code),
          vehicles:enquiry_vehicles(
            id, car_plate, insurance_expiry_date, status, external_quotation_ref,
            quoted_at, renewed_at, lost_at, lost_reason,
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
    mutationFn: async ({ vehicleId }: { vehicleId: string; enquiryId: string }) => {
      const { error } = await supabase.rpc('confirm_vehicle_renewal', { p_vehicle_id: vehicleId });
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
