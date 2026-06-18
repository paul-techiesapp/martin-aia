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
