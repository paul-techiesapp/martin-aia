import {
  MerchantStatus,
  EnquiryStatus,
  VehicleStatus,
  GiftStatus,
  RewardStatus,
} from './enums';

export interface Merchant {
  id: string;
  name: string;
  logo_url: string | null;
  gift_pool_amount: number;
  merchant_share_pct: number;
  status: MerchantStatus;
  created_by_agent_id: string | null;
  approved_by: string | null;
  approved_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface MerchantBranch {
  id: string;
  merchant_id: string;
  name: string;
  address: string | null;
  phone: string | null;
  status: MerchantStatus;
  created_by_agent_id: string | null;
  approved_by: string | null;
  approved_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface InsuranceProduct {
  id: string;
  name: string;
  is_active: boolean;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

export interface BranchLink {
  id: string;
  merchant_branch_id: string;
  agent_id: string | null;
  link_code: string;
  is_active: boolean;
  created_at: string;
}

export interface Enquiry {
  id: string;
  branch_link_id: string;
  merchant_branch_id: string;
  agent_id: string | null;
  customer_name: string;
  customer_nric: string;
  customer_nric_normalized: string;
  customer_phone: string;
  customer_phone_normalized: string;
  customer_email: string | null;
  status: EnquiryStatus;
  created_at: string;
  updated_at: string;
}

export interface EnquiryVehicle {
  id: string;
  enquiry_id: string;
  merchant_branch_id: string;
  car_plate: string;
  car_plate_normalized: string;
  insurance_expiry_date: string;
  insurance_product_id: string;
  status: VehicleStatus;
  external_quotation_ref: string | null;
  quoted_at: string | null;
  quoted_by: string | null;
  renewed_at: string | null;
  renewed_by: string | null;
  lost_at: string | null;
  lost_reason: string | null;
  reminder_sent_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface Gift {
  id: string;
  enquiry_vehicle_id: string;
  merchant_id: string;
  merchant_branch_id: string;
  value_amount: number;
  voucher_code: string;
  status: GiftStatus;
  issued_at: string;
  redeemed_at: string | null;
  redeemed_by: string | null;
  expires_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface MerchantCommission {
  id: string;
  enquiry_vehicle_id: string;
  agent_id: string;
  tier_id: string | null;
  amount: number;
  status: RewardStatus;
  paid_at: string | null;
  failure_reason: string | null;
  set_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface MerchantSettlement {
  id: string;
  enquiry_vehicle_id: string;
  merchant_id: string;
  amount: number;
  status: RewardStatus;
  paid_at: string | null;
  failure_reason: string | null;
  set_by: string | null;
  created_at: string;
  updated_at: string;
}
