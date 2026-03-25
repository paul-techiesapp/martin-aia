import jsPDF from 'jspdf';
import QRCode from 'qrcode';

export interface InvitationCardData {
  inviteeName: string;
  campaignName: string;
  venue: string;
  dayOfWeek: string;
  slotDate: string;      // ISO datetime string e.g., "2026-03-15T09:00:00+00:00"
  startTime: string;
  endTime: string;
  uniqueToken: string;
  registrationId: string;
  registrationUrl: string;
  isAutoCard: boolean;
}

/**
 * Generate QR code as base64 data URL
 */
async function generateQrDataUrl(text: string): Promise<string> {
  return QRCode.toDataURL(text, {
    width: 200,
    margin: 1,
    color: { dark: '#0f172a', light: '#ffffff' },
  });
}

/**
 * Draw a single Split Panel invitation card on the current jsPDF page.
 * Matches the RACC Agency brand: navy left panel with date, white right panel with details.
 * Includes a QR code for admin check-in scanning.
 */
async function drawInvitationCard(doc: jsPDF, data: InvitationCardData): Promise<void> {
  const pageW = 148;
  const pageH = 105;
  const leftW = 40; // Left panel width in mm

  // Parse slot date for left panel display
  const slotDate = new Date(data.slotDate);
  const dayNum = slotDate.getDate().toString();
  const monthYear = slotDate.toLocaleString('en', { month: 'short' }).toUpperCase() + ' ' + slotDate.getFullYear();

  // --- Page background ---
  doc.setFillColor(248, 250, 252);
  doc.rect(0, 0, pageW, pageH, 'F');

  // --- Left Panel (color based on auto/manual card type) ---
  const panelColor = data.isAutoCard
    ? { r: 15, g: 23, b: 42 }    // Navy #0f172a (auto)
    : { r: 127, g: 29, b: 29 };  // Burgundy #7f1d1d (manual)
  doc.setFillColor(panelColor.r, panelColor.g, panelColor.b);
  doc.rect(0, 0, leftW, pageH, 'F');

  // RACC Agency label (gold)
  doc.setTextColor(218, 165, 32);
  doc.setFontSize(7);
  doc.setFont('helvetica', 'bold');
  doc.text('RACC AGENCY', leftW / 2, 12, { align: 'center' });

  // "Event Invitation" subtitle
  doc.setTextColor(255, 255, 255);
  doc.setFontSize(6);
  doc.setFont('helvetica', 'normal');
  doc.text('Event Invitation', leftW / 2, 18, { align: 'center' });

  // Date display — large day number (matches React component left panel)
  doc.setTextColor(255, 255, 255);
  doc.setFontSize(22);
  doc.setFont('helvetica', 'bold');
  doc.text(dayNum, leftW / 2, 55, { align: 'center' });

  // Month + Year
  doc.setFontSize(9);
  doc.setFont('helvetica', 'bold');
  doc.text(monthYear, leftW / 2, 63, { align: 'center' });

  // Time
  doc.setFontSize(8);
  doc.setFont('helvetica', 'normal');
  doc.text(`${data.startTime} - ${data.endTime}`, leftW / 2, 70, { align: 'center' });

  // --- Right Panel ---
  const rightX = leftW + 5;
  const rightW = pageW - leftW - 10;

  // Campaign name
  doc.setTextColor(15, 23, 42);
  doc.setFontSize(14);
  doc.setFont('helvetica', 'bold');
  const nameLines = doc.splitTextToSize(data.campaignName, rightW - 30); // Leave space for QR
  doc.text(nameLines, rightX, 15);
  const nameEndY = 15 + nameLines.length * 6;

  // Venue
  doc.setTextColor(100, 116, 139);
  doc.setFontSize(9);
  doc.setFont('helvetica', 'normal');
  doc.text(data.venue, rightX, nameEndY + 4);

  // --- QR Code (top right of right panel) ---
  const qrSize = 25; // mm
  const qrX = pageW - qrSize - 5;
  const qrY = 5;
  try {
    const qrDataUrl = await generateQrDataUrl(`CHECKIN:${data.registrationId}`);
    doc.addImage(qrDataUrl, 'PNG', qrX, qrY, qrSize, qrSize);
  } catch {
    // If QR generation fails, draw placeholder
    doc.setDrawColor(200, 200, 200);
    doc.rect(qrX, qrY, qrSize, qrSize, 'S');
    doc.setFontSize(6);
    doc.setTextColor(150, 150, 150);
    doc.text('QR', qrX + qrSize / 2, qrY + qrSize / 2, { align: 'center' });
  }

  // "Scan for check-in" label under QR
  doc.setTextColor(148, 163, 184);
  doc.setFontSize(5);
  doc.text('Scan for check-in', qrX + qrSize / 2, qrY + qrSize + 3, { align: 'center' });

  // Dashed divider
  const dividerY = nameEndY + 10;
  doc.setDrawColor(226, 232, 240);
  doc.setLineDashPattern([1, 1], 0);
  doc.line(rightX, dividerY, rightX + rightW, dividerY);
  doc.setLineDashPattern([], 0); // Reset dash

  // Invitee section
  doc.setTextColor(148, 163, 184);
  doc.setFontSize(7);
  doc.text('INVITEE', rightX, dividerY + 7);

  doc.setTextColor(15, 23, 42);
  doc.setFontSize(11);
  doc.setFont('helvetica', 'bold');
  doc.text(data.inviteeName, rightX, dividerY + 14);

  // Registration instructions
  doc.setTextColor(100, 116, 139);
  doc.setFontSize(8);
  doc.setFont('helvetica', 'normal');
  doc.text('Present this card at the event for check-in', rightX, dividerY + 24);

  // Token reference (bottom right)
  doc.setTextColor(148, 163, 184);
  doc.setFontSize(6);
  doc.text(
    `Ref: ${data.uniqueToken.substring(0, 8)}...`,
    pageW - 5,
    pageH - 5,
    { align: 'right' },
  );
}

export async function generateInvitationCard(data: InvitationCardData): Promise<jsPDF> {
  const doc = new jsPDF({
    orientation: 'landscape',
    unit: 'mm',
    format: [148, 105], // A6 landscape
  });

  await drawInvitationCard(doc, data);
  return doc;
}

export async function generateBulkInvitationCards(invitations: InvitationCardData[]): Promise<jsPDF> {
  const doc = new jsPDF({
    orientation: 'landscape',
    unit: 'mm',
    format: [148, 105],
  });

  for (let i = 0; i < invitations.length; i++) {
    if (i > 0) {
      doc.addPage([148, 105], 'landscape');
    }
    await drawInvitationCard(doc, invitations[i]);
  }

  return doc;
}

export function formatSlotDate(isoDatetime: string): string {
  const date = new Date(isoDatetime);
  return date.toLocaleDateString('en-SG', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
}

export function formatTime(timeString: string): string {
  return timeString.slice(0, 5);
}
