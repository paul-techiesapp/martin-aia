import {
  MerchantStatus,
  EnquiryStatus,
  VehicleStatus,
  GiftStatus,
  RewardStatus,
} from './enums';

/** Per-partner overrides for the public branch enquiry form (Round 5 item 3). */
export interface MerchantFormSettings {
  header_image_url?: string;
  header_logo_url?: string;
  header_title?: string;
  header_subtitle?: string;
  footer_text?: string;
}

export interface Merchant {
  id: string;
  name: string;
  logo_url: string | null;
  /** Storage path of the signed partnership agreement (merchant-agreements bucket). */
  agreement_path: string | null;
  contact_person: string | null;
  contact_phone: string | null;
  /** @deprecated Gift pool/split removed; customer gift = system_settings.customer_gift_rate_pct of renewal premium. */
  gift_pool_amount?: number;
  /** @deprecated Gift pool/split removed; see customer_gift_rate_pct. */
  merchant_share_pct?: number;
  status: MerchantStatus;
  created_by_agent_id: string | null;
  approved_by: string | null;
  approved_at: string | null;
  /** Linked auth user for the merchant portal (read-only access to own data). */
  user_id: string | null;
  /** Email used to identify/invite the merchant portal user. */
  portal_email: string | null;
  /** Master Partner: assignable/visible to every agent (Round 5 item 1). */
  is_master: boolean;
  /** Per-partner form design; null = use global enquiry-form settings. */
  form_settings: MerchantFormSettings | null;
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
  branch_link_id: string | null;
  merchant_branch_id: string | null;
  /** Suggested/assigned partner at the enquiry level (per-car merchant_id is authoritative for ledgers). */
  merchant_id: string | null;
  assigned_at: string | null;
  assigned_by: string | null;
  agent_id: string | null;
  customer_name: string;
  customer_nric: string;
  customer_nric_normalized: string;
  customer_phone: string;
  customer_phone_normalized: string;
  customer_email: string | null;
  status: EnquiryStatus;
  /** Referring staff ID captured on branch (master-partner) enquiry forms; optional. */
  staff_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface EnquiryVehicle {
  id: string;
  enquiry_id: string;
  merchant_branch_id: string | null;
  /** Per-car partner, confirmed by admin at renewal. */
  merchant_id: string | null;
  car_plate: string;
  car_plate_normalized: string;
  insurance_expiry_date: string;
  insurance_product_id: string | null;
  /** Customer's Road Tax renewal choice captured on the enquiry form. */
  road_tax_renewal: boolean;
  /** Total car-insurance renewal premium captured at confirmation; gift = rate% of this. */
  renewal_premium_amount: number | null;
  /** Set when an agent requests a quote via "Get Quote". */
  quote_requested_at: string | null;
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
