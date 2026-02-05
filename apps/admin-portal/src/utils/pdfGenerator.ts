import jsPDF from 'jspdf';

interface InvitationCardData {
  inviteeName: string;
  campaignName: string;
  venue: string;
  dayOfWeek: string;
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

const DAYS_OF_WEEK = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

export function generateInvitationCard(data: InvitationCardData): jsPDF {
  const doc = new jsPDF({
    orientation: 'landscape',
    unit: 'mm',
    format: [148, 105], // A6 landscape
  });

  // Background
  doc.setFillColor(248, 250, 252);
  doc.rect(0, 0, 148, 105, 'F');

  // Header bar
  doc.setFillColor(59, 130, 246);
  doc.rect(0, 0, 148, 20, 'F');

  // Title
  doc.setTextColor(255, 255, 255);
  doc.setFontSize(14);
  doc.setFont('helvetica', 'bold');
  doc.text('EVENT INVITATION', 74, 13, { align: 'center' });

  // Campaign name
  doc.setTextColor(30, 41, 59);
  doc.setFontSize(16);
  doc.setFont('helvetica', 'bold');
  doc.text(data.campaignName, 74, 32, { align: 'center' });

  // Invitee name
  doc.setFontSize(12);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(71, 85, 105);
  doc.text(`Dear ${data.inviteeName},`, 10, 45);

  doc.setFontSize(10);
  doc.text('You are cordially invited to attend:', 10, 52);

  // Event details box
  doc.setFillColor(241, 245, 249);
  doc.roundedRect(10, 56, 128, 25, 3, 3, 'F');

  doc.setTextColor(30, 41, 59);
  doc.setFontSize(10);
  doc.setFont('helvetica', 'bold');
  doc.text('Date & Time:', 15, 64);
  doc.setFont('helvetica', 'normal');
  doc.text(`${data.dayOfWeek}, ${data.startTime} - ${data.endTime}`, 50, 64);

  doc.setFont('helvetica', 'bold');
  doc.text('Venue:', 15, 72);
  doc.setFont('helvetica', 'normal');
  doc.text(data.venue, 50, 72);

  // Registration instructions
  doc.setFontSize(9);
  doc.setTextColor(71, 85, 105);
  doc.text('Please register using your unique link:', 10, 88);

  doc.setTextColor(59, 130, 246);
  doc.setFontSize(8);
  const shortUrl = data.registrationUrl.length > 60
    ? data.registrationUrl.substring(0, 57) + '...'
    : data.registrationUrl;
  doc.text(shortUrl, 10, 93);

  // Token reference
  doc.setTextColor(148, 163, 184);
  doc.setFontSize(7);
  doc.text(`Ref: ${data.uniqueToken.substring(0, 8)}...`, 128, 100, { align: 'right' });

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

    // Background
    doc.setFillColor(248, 250, 252);
    doc.rect(0, 0, 148, 105, 'F');

    // Header bar
    doc.setFillColor(59, 130, 246);
    doc.rect(0, 0, 148, 20, 'F');

    // Title
    doc.setTextColor(255, 255, 255);
    doc.setFontSize(14);
    doc.setFont('helvetica', 'bold');
    doc.text('EVENT INVITATION', 74, 13, { align: 'center' });

    // Campaign name
    doc.setTextColor(30, 41, 59);
    doc.setFontSize(16);
    doc.setFont('helvetica', 'bold');
    doc.text(invitation.campaignName, 74, 32, { align: 'center' });

    // Invitee name
    doc.setFontSize(12);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(71, 85, 105);
    doc.text(`Dear ${invitation.inviteeName},`, 10, 45);

    doc.setFontSize(10);
    doc.text('You are cordially invited to attend:', 10, 52);

    // Event details box
    doc.setFillColor(241, 245, 249);
    doc.roundedRect(10, 56, 128, 25, 3, 3, 'F');

    doc.setTextColor(30, 41, 59);
    doc.setFontSize(10);
    doc.setFont('helvetica', 'bold');
    doc.text('Date & Time:', 15, 64);
    doc.setFont('helvetica', 'normal');
    doc.text(`${invitation.dayOfWeek}, ${invitation.startTime} - ${invitation.endTime}`, 50, 64);

    doc.setFont('helvetica', 'bold');
    doc.text('Venue:', 15, 72);
    doc.setFont('helvetica', 'normal');
    doc.text(invitation.venue, 50, 72);

    // Registration instructions
    doc.setFontSize(9);
    doc.setTextColor(71, 85, 105);
    doc.text('Please register using your unique link:', 10, 88);

    doc.setTextColor(59, 130, 246);
    doc.setFontSize(8);
    const shortUrl = invitation.registrationUrl.length > 60
      ? invitation.registrationUrl.substring(0, 57) + '...'
      : invitation.registrationUrl;
    doc.text(shortUrl, 10, 93);

    // Token reference
    doc.setTextColor(148, 163, 184);
    doc.setFontSize(7);
    doc.text(`Ref: ${invitation.uniqueToken.substring(0, 8)}...`, 128, 100, { align: 'right' });
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

export function formatDayOfWeek(dayNumber: number): string {
  return DAYS_OF_WEEK[dayNumber] || 'Unknown';
}

export function formatTime(timeString: string): string {
  return timeString.slice(0, 5);
}
