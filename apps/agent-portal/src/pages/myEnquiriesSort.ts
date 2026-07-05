import { EnquiryStatus } from '@agent-system/shared-types';
import type { EnquiryWithDetails } from '../hooks/useMyEnquiries';

// Sentinel that sorts after any real partner name (nulls last) and after any
// real ISO date (no-vehicle / no-expiry enquiries last).
const NAME_LAST = '￿';
const DATE_LAST = '9999-12-31';

// Open enquiries before closed ones.
export const statusRank = (s: EnquiryStatus): number => (s === EnquiryStatus.OPEN ? 0 : 1);

// Earliest insurance-expiry date across the enquiry's vehicles. Missing dates
// and empty vehicle lists sort last.
export function earliestExpiry(vehicles?: { insurance_expiry_date: string | null }[]): string {
  if (!vehicles?.length) return DATE_LAST;
  const dates = vehicles
    .map((v) => v.insurance_expiry_date)
    .filter((d): d is string => !!d)
    .sort();
  return dates[0] ?? DATE_LAST;
}

// Multi-key comparator for an agent's enquiry rows:
//   Partner (merchant name) -> Status (open before closed)
//   -> earliest vehicle insurance expiry -> Received (created_at, newest first).
// Nulls sort last on every key.
export function compareMyEnquiries(a: EnquiryWithDetails, b: EnquiryWithDetails): number {
  const partner = (a.merchant?.name ?? NAME_LAST).localeCompare(b.merchant?.name ?? NAME_LAST);
  if (partner !== 0) return partner;

  const status = statusRank(a.status) - statusRank(b.status);
  if (status !== 0) return status;

  const expiry = earliestExpiry(a.vehicles).localeCompare(earliestExpiry(b.vehicles));
  if (expiry !== 0) return expiry;

  // Received: newest first.
  return (b.created_at ?? '').localeCompare(a.created_at ?? '');
}

export type EnquirySortKey = 'default' | 'received' | 'expiry' | 'status' | 'partner' | 'customer';

// Unit view default: Agent -> (then the standard default keys).
export function compareUnitEnquiries(a: EnquiryWithDetails, b: EnquiryWithDetails): number {
  const agent = (a.agent?.name ?? NAME_LAST).localeCompare(b.agent?.name ?? NAME_LAST);
  if (agent !== 0) return agent;
  return compareMyEnquiries(a, b);
}

export function compareByKey(key: EnquirySortKey, isUnitView: boolean) {
  return (a: EnquiryWithDetails, b: EnquiryWithDetails): number => {
    switch (key) {
      case 'received': return (b.created_at ?? '').localeCompare(a.created_at ?? '');
      case 'expiry':   return earliestExpiry(a.vehicles).localeCompare(earliestExpiry(b.vehicles));
      case 'status':   return statusRank(a.status) - statusRank(b.status) || compareMyEnquiries(a, b);
      case 'partner':  return compareMyEnquiries(a, b); // partner is already the leading default key
      case 'customer': return (a.customer_name ?? '').localeCompare(b.customer_name ?? '');
      default:         return isUnitView ? compareUnitEnquiries(a, b) : compareMyEnquiries(a, b);
    }
  };
}
