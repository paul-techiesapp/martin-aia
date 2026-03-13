import jsPDF from 'jspdf';

interface InvitationCardData {
  inviteeName: string;
  campaignName: string;
  venue: string;
  dayOfWeek: string;
  slotDate: string;      // ISO datetime string e.g., "2026-03-15T09:00:00+00:00"
  startTime: string;
  endTime: string;
  uniqueToken: string;
  registrationUrl: string;
}

interface PinSheetData {
  campaignName: string;
  slotInfo: string;
  pinCodes: string[];
  checkinUrl: string;
  checkoutUrl: string;
}

/**
 * Draw a single Split Panel invitation card on the current jsPDF page.
 * Matches the RACC Agency brand: navy left panel with date, white right panel with details.
 */
function drawInvitationCard(doc: jsPDF, data: InvitationCardData): void {
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

  // --- Left Panel (solid navy — jsPDF can't render gradients) ---
  doc.setFillColor(15, 23, 42);
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
  const nameLines = doc.splitTextToSize(data.campaignName, rightW);
  doc.text(nameLines, rightX, 15);
  const nameEndY = 15 + nameLines.length * 6;

  // Venue
  doc.setTextColor(100, 116, 139);
  doc.setFontSize(9);
  doc.setFont('helvetica', 'normal');
  doc.text(data.venue, rightX, nameEndY + 4);

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
  doc.text('Register using your unique link:', rightX, dividerY + 24);

  // Registration URL
  doc.setTextColor(3, 105, 161); // Sky blue for links
  doc.setFontSize(7);
  const shortUrl =
    data.registrationUrl.length > 55
      ? data.registrationUrl.substring(0, 52) + '...'
      : data.registrationUrl;
  doc.text(shortUrl, rightX, dividerY + 30);

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

export function generateInvitationCard(data: InvitationCardData): jsPDF {
  const doc = new jsPDF({
    orientation: 'landscape',
    unit: 'mm',
    format: [148, 105], // A6 landscape
  });

  drawInvitationCard(doc, data);
  return doc;
}

export function generateBulkInvitationCards(invitations: InvitationCardData[]): jsPDF {
  const doc = new jsPDF({
    orientation: 'landscape',
    unit: 'mm',
    format: [148, 105],
  });

  invitations.forEach((invitation, index) => {
    if (index > 0) {
      doc.addPage([148, 105], 'landscape');
    }
    drawInvitationCard(doc, invitation);
  });

  return doc;
}

export function generatePinSheet(data: PinSheetData): jsPDF {
  const doc = new jsPDF({
    orientation: 'portrait',
    unit: 'mm',
    format: 'a4',
  });

  const pageWidth = 210;
  const pageHeight = 297;
  const margin = 15;
  let currentY = margin;

  // Header
  doc.setFillColor(59, 130, 246);
  doc.rect(0, 0, pageWidth, 30, 'F');

  doc.setTextColor(255, 255, 255);
  doc.setFontSize(18);
  doc.setFont('helvetica', 'bold');
  doc.text('PIN CODE SHEET', pageWidth / 2, 15, { align: 'center' });

  doc.setFontSize(10);
  doc.setFont('helvetica', 'normal');
  doc.text(`${data.campaignName} - ${data.slotInfo}`, pageWidth / 2, 24, { align: 'center' });

  currentY = 40;

  // Instructions
  doc.setTextColor(71, 85, 105);
  doc.setFontSize(10);
  doc.text('Instructions:', margin, currentY);
  currentY += 6;

  doc.setFontSize(9);
  doc.text('1. Each attendee receives ONE PIN code from this sheet', margin + 5, currentY);
  currentY += 5;
  doc.text('2. The PIN code is linked to their NRIC upon first check-in', margin + 5, currentY);
  currentY += 5;
  doc.text('3. The same PIN + NRIC combination is used for check-out', margin + 5, currentY);
  currentY += 10;

  // URLs
  doc.setFillColor(241, 245, 249);
  doc.roundedRect(margin, currentY, pageWidth - margin * 2, 20, 2, 2, 'F');
  currentY += 7;

  doc.setTextColor(30, 41, 59);
  doc.setFontSize(9);
  doc.setFont('helvetica', 'bold');
  doc.text('Check-in URL:', margin + 5, currentY);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(59, 130, 246);
  doc.text(data.checkinUrl, margin + 35, currentY);
  currentY += 7;

  doc.setTextColor(30, 41, 59);
  doc.setFont('helvetica', 'bold');
  doc.text('Check-out URL:', margin + 5, currentY);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(59, 130, 246);
  doc.text(data.checkoutUrl, margin + 35, currentY);
  currentY += 15;

  // PIN codes grid
  doc.setTextColor(30, 41, 59);
  doc.setFontSize(12);
  doc.setFont('helvetica', 'bold');
  doc.text('PIN Codes:', margin, currentY);
  currentY += 8;

  const cols = 5;
  const cellWidth = (pageWidth - margin * 2) / cols;
  const cellHeight = 15;

  data.pinCodes.forEach((pin, index) => {
    const col = index % cols;
    const row = Math.floor(index / cols);
    const x = margin + col * cellWidth;
    const y = currentY + row * cellHeight;

    // Check if we need a new page
    if (y + cellHeight > pageHeight - margin) {
      doc.addPage();
      currentY = margin;
      return;
    }

    // Cell background
    doc.setFillColor(index % 2 === 0 ? 248 : 241, 250, index % 2 === 0 ? 252 : 249);
    doc.rect(x, y, cellWidth - 2, cellHeight - 2, 'F');

    // Cell border
    doc.setDrawColor(226, 232, 240);
    doc.rect(x, y, cellWidth - 2, cellHeight - 2, 'S');

    // Index number
    doc.setTextColor(148, 163, 184);
    doc.setFontSize(7);
    doc.text(`#${index + 1}`, x + 2, y + 4);

    // PIN code
    doc.setTextColor(30, 41, 59);
    doc.setFontSize(14);
    doc.setFont('helvetica', 'bold');
    doc.text(pin, x + (cellWidth - 2) / 2, y + 10, { align: 'center' });
  });

  // Footer
  const lastPageY = pageHeight - 10;
  doc.setTextColor(148, 163, 184);
  doc.setFontSize(8);
  doc.setFont('helvetica', 'normal');
  doc.text(`Generated: ${new Date().toLocaleString()}`, margin, lastPageY);
  doc.text(`Total PINs: ${data.pinCodes.length}`, pageWidth - margin, lastPageY, { align: 'right' });

  return doc;
}

export function formatSlotDate(isoDatetime: string): string {
  const date = new Date(isoDatetime);
  return date.toLocaleDateString('en-SG', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
}

export function formatTime(timeString: string): string {
  return timeString.slice(0, 5);
}
