import jsPDF from 'jspdf';
import QRCode from 'qrcode';
import type { CardTemplate, CompanyBranding } from '@agent-system/shared-types';
import { loadFont } from './fonts';

function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  return result
    ? { r: parseInt(result[1], 16), g: parseInt(result[2], 16), b: parseInt(result[3], 16) }
    : { r: 0, g: 0, b: 0 };
}

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

export interface InvitationCardData {
  inviteeName: string;
  campaignName: string;
  venue: string;
  dayOfWeek: string;
  slotDate: string;
  startTime: string;
  endTime: string;
  uniqueToken: string;
  registrationId: string;
  registrationUrl: string;
}

async function generateQrDataUrl(text: string, color: string): Promise<string> {
  return QRCode.toDataURL(text, {
    width: 200,
    margin: 1,
    color: { dark: color, light: '#ffffff' },
  });
}

async function drawInvitationCard(
  doc: jsPDF,
  data: InvitationCardData,
  template: CardTemplate,
  branding: CompanyBranding,
  logoImageData?: string
): Promise<void> {
  const pageW = 148;
  const pageH = 105;
  const leftW = 40;

  loadFont(doc, template.fontFamily);

  const slotDate = new Date(data.slotDate);
  const dayNum = slotDate.getDate().toString();
  const monthYear = slotDate.toLocaleString('en', { month: 'short' }).toUpperCase() + ' ' + slotDate.getFullYear();

  // --- Page background ---
  doc.setFillColor(248, 250, 252);
  doc.rect(0, 0, pageW, pageH, 'F');

  // --- Left Panel ---
  const panelColor = hexToRgb(template.panelColor);
  doc.setFillColor(panelColor.r, panelColor.g, panelColor.b);
  doc.rect(0, 0, leftW, pageH, 'F');

  const hasLogo = logoImageData && template.visibleElements.includes('logo');

  // Logo
  if (hasLogo) {
    try {
      doc.addImage(logoImageData, 'PNG', (leftW - branding.logoWidth) / 2, 5, branding.logoWidth, branding.logoWidth * 0.6);
    } catch { /* proceed without logo */ }
  }

  // Company name label (accent color)
  const accent = hexToRgb(template.accentColor);
  doc.setTextColor(accent.r, accent.g, accent.b);
  doc.setFontSize(7);
  doc.setFont(template.fontFamily, 'bold');
  doc.text(branding.companyName.toUpperCase(), leftW / 2, hasLogo ? 18 : 12, { align: 'center' });

  // Subtitle
  if (template.visibleElements.includes('subtitle')) {
    const panelText = hexToRgb(template.panelTextColor);
    doc.setTextColor(panelText.r, panelText.g, panelText.b);
    doc.setFontSize(6);
    doc.setFont(template.fontFamily, 'normal');
    doc.text(template.subtitle, leftW / 2, hasLogo ? 24 : 18, { align: 'center' });
  }

  // Date display
  if (template.visibleElements.includes('date')) {
    const panelText = hexToRgb(template.panelTextColor);
    doc.setTextColor(panelText.r, panelText.g, panelText.b);
    doc.setFontSize(22);
    doc.setFont(template.fontFamily, 'bold');
    doc.text(dayNum, leftW / 2, 55, { align: 'center' });

    doc.setFontSize(9);
    doc.setFont(template.fontFamily, 'bold');
    doc.text(monthYear, leftW / 2, 63, { align: 'center' });

    doc.setFontSize(8);
    doc.setFont(template.fontFamily, 'normal');
    doc.text(`${data.startTime} - ${data.endTime}`, leftW / 2, 70, { align: 'center' });
  }

  // --- Right Panel ---
  const rightX = leftW + 5;
  const rightW = pageW - leftW - 10;

  // Campaign name
  if (template.visibleElements.includes('campaign')) {
    doc.setTextColor(15, 23, 42);
    doc.setFontSize(template.titleFontSize);
    doc.setFont(template.fontFamily, 'bold');
    const campLines = doc.splitTextToSize(data.campaignName, rightW - 30);
    doc.text(campLines, rightX, 15);
  }
  const nameLines = doc.splitTextToSize(data.campaignName, rightW - 30);
  const nameEndY = 15 + nameLines.length * 6;

  // Venue
  if (template.visibleElements.includes('venue')) {
    doc.setTextColor(100, 116, 139);
    doc.setFontSize(template.bodyFontSize);
    doc.setFont(template.fontFamily, 'normal');
    doc.text(data.venue, rightX, nameEndY + 4);
  }

  // --- QR Code ---
  if (template.visibleElements.includes('qr')) {
    const qrX = pageW - template.qrSize - 5;
    const qrY = 5;
    try {
      const qrDataUrl = await generateQrDataUrl(`CHECKIN:${data.registrationId}`, template.qrColor);
      doc.addImage(qrDataUrl, 'PNG', qrX, qrY, template.qrSize, template.qrSize);
    } catch {
      doc.setDrawColor(200, 200, 200);
      doc.rect(qrX, qrY, template.qrSize, template.qrSize, 'S');
      doc.setFontSize(6);
      doc.setTextColor(150, 150, 150);
      doc.text('QR', qrX + template.qrSize / 2, qrY + template.qrSize / 2, { align: 'center' });
    }

    doc.setTextColor(148, 163, 184);
    doc.setFontSize(5);
    doc.text('Scan for check-in', qrX + template.qrSize / 2, qrY + template.qrSize + 3, { align: 'center' });
  }

  // Dashed divider
  const dividerY = nameEndY + 10;
  doc.setDrawColor(226, 232, 240);
  doc.setLineDashPattern([1, 1], 0);
  doc.line(rightX, dividerY, rightX + rightW, dividerY);
  doc.setLineDashPattern([], 0);

  // Invitee section
  if (template.visibleElements.includes('invitee')) {
    doc.setTextColor(148, 163, 184);
    doc.setFontSize(7);
    doc.text('INVITEE', rightX, dividerY + 7);

    doc.setTextColor(15, 23, 42);
    doc.setFontSize(11);
    doc.setFont(template.fontFamily, 'bold');
    doc.text(data.inviteeName, rightX, dividerY + 14);
  }

  // Instruction text
  if (template.visibleElements.includes('instruction')) {
    doc.setTextColor(100, 116, 139);
    doc.setFontSize(8);
    doc.setFont(template.fontFamily, 'normal');
    doc.text(template.instructionText, rightX, dividerY + 24);
  }

  // Token reference (bottom right)
  if (template.visibleElements.includes('reference')) {
    doc.setTextColor(148, 163, 184);
    doc.setFontSize(6);
    doc.text(
      `Ref: ${data.uniqueToken}`,
      pageW - 5,
      pageH - 5,
      { align: 'right' },
    );
  }
}

export async function generateInvitationCard(
  data: InvitationCardData,
  template: CardTemplate,
  branding: CompanyBranding
): Promise<jsPDF> {
  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: [148, 105] });
  let logoImageData: string | undefined;
  if (branding.logoUrl) {
    try {
      const response = await fetch(branding.logoUrl);
      const blob = await response.blob();
      logoImageData = await blobToBase64(blob);
    } catch { /* proceed without logo */ }
  }
  await drawInvitationCard(doc, data, template, branding, logoImageData);
  return doc;
}

export async function generateBulkInvitationCards(
  invitations: InvitationCardData[],
  template: CardTemplate,
  branding: CompanyBranding
): Promise<jsPDF> {
  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: [148, 105] });
  let logoImageData: string | undefined;
  if (branding.logoUrl) {
    try {
      const response = await fetch(branding.logoUrl);
      const blob = await response.blob();
      logoImageData = await blobToBase64(blob);
    } catch { /* proceed without logo */ }
  }
  for (let i = 0; i < invitations.length; i++) {
    if (i > 0) doc.addPage([148, 105], 'landscape');
    await drawInvitationCard(doc, invitations[i], template, branding, logoImageData);
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
