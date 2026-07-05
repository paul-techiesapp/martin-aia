import type { EnquiryExportRow } from '@agent-system/shared-ui';
import type { EnquiryListRow } from '../../hooks/useEnquiries';

const HIGH = '￿'; // sentinel so nulls/House/Unassigned sort last
const statusRank = (s: string) => (s === 'open' ? 0 : 1);

export function earliestExpiry(vehicles: { insurance_expiry_date: string }[]): string {
  const dates = vehicles.map((v) => v.insurance_expiry_date).filter(Boolean).sort();
  return dates[0] ?? '9999-12-31';
}

/**
 * Default enquiry ordering requested in feedback:
 * Units -> Agents -> Partners -> Status -> Expiration Date -> Received Date.
 */
export function compareEnquiries(a: EnquiryListRow, b: EnquiryListRow): number {
  const unit = (a.agent?.unit_name || HIGH).localeCompare(b.agent?.unit_name || HIGH);
  if (unit !== 0) return unit;
  const agent = (a.agent?.name || HIGH).localeCompare(b.agent?.name || HIGH);
  if (agent !== 0) return agent;
  const partner = (a.merchant?.name || HIGH).localeCompare(b.merchant?.name || HIGH);
  if (partner !== 0) return partner;
  const st = statusRank(a.status) - statusRank(b.status);
  if (st !== 0) return st;
  const ex = earliestExpiry(a.vehicles).localeCompare(earliestExpiry(b.vehicles));
  if (ex !== 0) return ex;
  return b.created_at.localeCompare(a.created_at); // received: newest first
}

const fmt = (d?: string | null) => (d ? new Date(d).toLocaleDateString('en-SG') : '');

/** Flattens enquiries to one export row per car (or one row if no cars). */
export function toEnquiryExportRows(rows: EnquiryListRow[]): EnquiryExportRow[] {
  const out: EnquiryExportRow[] = [];
  for (const e of rows) {
    const base = {
      unit: e.agent?.unit_name ?? '',
      agent: e.agent?.name ?? 'House',
      agentCode: e.agent?.agent_code ?? '',
      partner: e.merchant?.name ?? 'Unassigned',
      customer: e.customer_name ?? '',
      phone: e.customer_phone ?? '',
      email: e.customer_email ?? '',
      staffId: e.staff_id ?? '',
      enquiryStatus: e.status,
      received: fmt(e.created_at),
    };
    if (!e.vehicles?.length) {
      out.push({ ...base, carPlate: '', insuranceExpiry: '', roadTax: '', vehicleStatus: '' });
      continue;
    }
    for (const v of e.vehicles) {
      out.push({
        ...base,
        // per-car partner is authoritative once confirmed; fall back to the
        // enquiry-level suggestion before it is set.
        partner: v.merchant?.name ?? base.partner,
        carPlate: v.car_plate ?? '',
        insuranceExpiry: fmt(v.insurance_expiry_date),
        roadTax: v.road_tax_renewal ? 'Yes' : 'No',
        vehicleStatus: v.status,
      });
    }
  }
  return out;
}
