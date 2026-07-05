import { format, parseISO } from 'date-fns';
import type { Column } from 'write-excel-file/browser';

/** A single registrant row as selected from the `registrations` table. */
export interface RegistrantRow {
  invitee_name: string | null;
  invitee_nric: string | null;
  invitee_phone: string | null;
  invitee_email: string | null;
  invitee_occupation: string | null;
  status: string | null;
  registered_at: string | null;
}

/** Event metadata used to build the download filename. */
export interface RegistrantsWorkbookMeta {
  /** Campaign/event name, e.g. "BOP - JUNE". */
  campaignName: string;
  /** Slot start as an ISO timestamp string. */
  slotDate: string;
}

function sanitizeFilePart(value: string): string {
  return value
    .trim()
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toUpperCase();
}

/**
 * Builds and triggers a browser download of an .xlsx file listing the given
 * registrants. `write-excel-file` is dynamic-imported so it is code-split out
 * of the app's main bundle.
 *
 * API note (v4.x): the package has no bare `write-excel-file` export.
 * The browser entry point is `write-excel-file/browser`.
 * Columns use `header` (Cell) and `cell` (function → Cell) — no `Schema` type,
 * no `type: String` shorthand, and no `headerStyle` option.
 * Bold headers are achieved via a CellObject `{ value, fontWeight }` on `header`.
 * The function returns `{ toFile(fileName), toBlob() }` — call `toFile()` to
 * trigger the download.
 */
export async function generateRegistrantsWorkbook(
  rows: RegistrantRow[],
  meta: RegistrantsWorkbookMeta,
): Promise<void> {
  const { default: writeXlsxFile } = await import('write-excel-file/browser');

  const columns: Column<RegistrantRow>[] = [
    {
      width: 24,
      header: { value: 'Name', fontWeight: 'bold' },
      cell: (r) => r.invitee_name ?? '',
    },
    {
      width: 16,
      header: { value: 'NRIC / MyKad', fontWeight: 'bold' },
      cell: (r) => r.invitee_nric ?? '',
    },
    {
      width: 16,
      header: { value: 'Phone', fontWeight: 'bold' },
      cell: (r) => r.invitee_phone ?? '',
    },
    {
      width: 28,
      header: { value: 'Email', fontWeight: 'bold' },
      cell: (r) => r.invitee_email ?? '',
    },
    {
      width: 20,
      header: { value: 'Occupation', fontWeight: 'bold' },
      cell: (r) => r.invitee_occupation ?? '',
    },
    {
      width: 14,
      header: { value: 'Status', fontWeight: 'bold' },
      cell: (r) => r.status ?? '',
    },
    {
      width: 20,
      header: { value: 'Registered At', fontWeight: 'bold' },
      cell: (r) =>
        r.registered_at ? format(parseISO(r.registered_at), 'd MMM yyyy, HH:mm') : '',
    },
  ];

  const datePart = meta.slotDate ? format(parseISO(meta.slotDate), 'yyyy-MM-dd') : '';
  const fileName =
    [sanitizeFilePart(meta.campaignName), datePart, 'registrants']
      .filter(Boolean)
      .join('-') + '.xlsx';

  // v4.x returns { toFile(fileName), toBlob() } — toFile() triggers the download.
  const result = await writeXlsxFile(rows, { columns });
  await result.toFile(fileName);
}

// ============================================================
// Enquiries report (admin + agent). One row per car.
// ============================================================
export interface EnquiryExportRow {
  unit: string;
  agent: string;
  agentCode: string;
  partner: string;
  customer: string;
  phone: string;
  email: string;
  /** Referring staff ID captured on branch (master-partner) enquiry forms; optional. */
  staffId?: string;
  carPlate: string;
  insuranceExpiry: string;
  roadTax: string;
  vehicleStatus: string;
  enquiryStatus: string;
  received: string;
}

export async function buildEnquiriesWorkbook(
  rows: EnquiryExportRow[],
  meta?: { generatedAt?: string },
): Promise<void> {
  const { default: writeXlsxFile } = await import('write-excel-file/browser');
  const columns: Column<EnquiryExportRow>[] = [
    { width: 18, header: { value: 'Unit', fontWeight: 'bold' }, cell: (r) => r.unit },
    { width: 20, header: { value: 'Agent', fontWeight: 'bold' }, cell: (r) => r.agent },
    { width: 12, header: { value: 'Agent Code', fontWeight: 'bold' }, cell: (r) => r.agentCode },
    { width: 18, header: { value: 'Partner', fontWeight: 'bold' }, cell: (r) => r.partner },
    { width: 22, header: { value: 'Customer', fontWeight: 'bold' }, cell: (r) => r.customer },
    { width: 16, header: { value: 'Phone', fontWeight: 'bold' }, cell: (r) => r.phone },
    { width: 26, header: { value: 'Email', fontWeight: 'bold' }, cell: (r) => r.email },
    { width: 14, header: { value: 'Staff ID', fontWeight: 'bold' }, cell: (r) => r.staffId ?? '' },
    { width: 14, header: { value: 'Car Plate', fontWeight: 'bold' }, cell: (r) => r.carPlate },
    { width: 16, header: { value: 'Insurance Expiry', fontWeight: 'bold' }, cell: (r) => r.insuranceExpiry },
    { width: 10, header: { value: 'Road Tax', fontWeight: 'bold' }, cell: (r) => r.roadTax },
    { width: 14, header: { value: 'Vehicle Status', fontWeight: 'bold' }, cell: (r) => r.vehicleStatus },
    { width: 14, header: { value: 'Enquiry Status', fontWeight: 'bold' }, cell: (r) => r.enquiryStatus },
    { width: 18, header: { value: 'Received', fontWeight: 'bold' }, cell: (r) => r.received },
  ];
  const fileName = `enquiries-${meta?.generatedAt ?? 'export'}.xlsx`;
  const result = await writeXlsxFile(rows, { columns });
  await result.toFile(fileName);
}

// ============================================================
// Successful renewals report (admin). One row per renewed car.
// ============================================================
export interface RenewalExportRow {
  partner: string;
  unit: string;
  agent: string;
  customer: string;
  carPlate: string;
  renewedAt: string;
  premium: number;
  giftValue: number;
}

export async function buildRenewalsWorkbook(
  rows: RenewalExportRow[],
  meta?: { generatedAt?: string },
): Promise<void> {
  const { default: writeXlsxFile } = await import('write-excel-file/browser');
  const columns: Column<RenewalExportRow>[] = [
    { width: 18, header: { value: 'Partner', fontWeight: 'bold' }, cell: (r) => r.partner },
    { width: 18, header: { value: 'Unit', fontWeight: 'bold' }, cell: (r) => r.unit },
    { width: 20, header: { value: 'Agent', fontWeight: 'bold' }, cell: (r) => r.agent },
    { width: 22, header: { value: 'Customer', fontWeight: 'bold' }, cell: (r) => r.customer },
    { width: 14, header: { value: 'Car Plate', fontWeight: 'bold' }, cell: (r) => r.carPlate },
    { width: 18, header: { value: 'Renewed At', fontWeight: 'bold' }, cell: (r) => r.renewedAt },
    { width: 18, header: { value: 'Renewal Premium (RM)', fontWeight: 'bold' }, cell: (r) => r.premium.toFixed(2) },
    { width: 20, header: { value: 'Gift / Settlement (RM)', fontWeight: 'bold' }, cell: (r) => r.giftValue.toFixed(2) },
  ];
  const fileName = `renewals-${meta?.generatedAt ?? 'export'}.xlsx`;
  const result = await writeXlsxFile(rows, { columns });
  await result.toFile(fileName);
}
