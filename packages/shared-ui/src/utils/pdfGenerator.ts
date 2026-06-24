import jsPDF from 'jspdf';
import QRCode from 'qrcode';
import JsBarcode from 'jsbarcode';
import type { CardTemplate, CompanyBranding } from '@agent-system/shared-types';
import { loadFont } from './fonts';
import bundledLogoSrc from '../assets/logo.png';

// All events are Singapore events. Slot start_at/end_at are stored as
// TIMESTAMPTZ (UTC instants), so any display must be pinned to the event's
// timezone rather than the viewer's device timezone — otherwise the same card
// renders different times on a UTC device (or the email's UTC edge runtime)
// than on an SGT device. See formatSlotTime / formatSlotDate below.
export const EVENT_TIME_ZONE = 'Asia/Singapore';

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

// Composites a (possibly transparent) logo onto an opaque background of the given color
// so it renders cleanly on dark panels in the PDF. jsPDF's PNG alpha handling can leave
// checker-pattern artifacts where the logo is transparent, so we flatten it first.
// Returns the data URL plus the natural image dimensions so callers can preserve
// the aspect ratio when placing the image.
async function compositeOnBackground(
  logoDataUrl: string,
  backgroundColor: string,
): Promise<{ dataUrl: string; width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const width = img.naturalWidth || img.width;
      const height = img.naturalHeight || img.height;
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        reject(new Error('Could not get canvas context'));
        return;
      }
      ctx.fillStyle = backgroundColor;
      ctx.fillRect(0, 0, width, height);
      ctx.drawImage(img, 0, 0);
      resolve({ dataUrl: canvas.toDataURL('image/png'), width, height });
    };
    img.onerror = () => reject(new Error('Failed to load logo image'));
    img.src = logoDataUrl;
  });
}

function generateBarcodeDataUrl(value: string, displayText: string, color: string): string {
  const canvas = document.createElement('canvas');
  JsBarcode(canvas, value, {
    format: 'CODE128',
    width: 2,
    height: 60,
    displayValue: true,
    text: displayText,
    fontSize: 14,
    textMargin: 2,
    margin: 4,
    lineColor: color,
    background: '#ffffff',
  });
  return canvas.toDataURL('image/png');
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
  const dayNum = slotDate.toLocaleString('en', { day: 'numeric', timeZone: EVENT_TIME_ZONE });
  const monthYear =
    slotDate.toLocaleString('en', { month: 'short', timeZone: EVENT_TIME_ZONE }).toUpperCase() +
    ' ' +
    slotDate.toLocaleString('en', { year: 'numeric', timeZone: EVENT_TIME_ZONE });

  // --- Page background ---
  doc.setFillColor(248, 250, 252);
  doc.rect(0, 0, pageW, pageH, 'F');

  // --- Left Panel ---
  const panelColor = hexToRgb(template.panelColor);
  doc.setFillColor(panelColor.r, panelColor.g, panelColor.b);
  doc.rect(0, 0, leftW, pageH, 'F');

  const hasLogo = logoImageData && template.visibleElements.includes('logo');

  // Logo — composite onto the panel color first so transparent PNGs render
  // cleanly without checker-pattern artifacts. Preserve the natural aspect
  // ratio by deriving the rendered height from the source image dimensions.
  let logoBottomY = 5;
  if (hasLogo) {
    try {
      const { dataUrl, width, height } = await compositeOnBackground(
        logoImageData!,
        template.panelColor,
      );
      const imgW = branding.logoWidth;
      const imgH = imgW * (height / width);
      const imgX = (leftW - imgW) / 2;
      const imgY = 5;
      doc.addImage(dataUrl, 'PNG', imgX, imgY, imgW, imgH);
      logoBottomY = imgY + imgH;
    } catch { /* proceed without logo */ }
  }

  // Subtitle (positioned below the logo if present, otherwise near the top)
  if (template.visibleElements.includes('subtitle')) {
    const panelText = hexToRgb(template.panelTextColor);
    doc.setTextColor(panelText.r, panelText.g, panelText.b);
    doc.setFontSize(6);
    doc.setFont(template.fontFamily, 'normal');
    const subtitleY = hasLogo ? logoBottomY + 4 : 12;
    doc.text(template.subtitle, leftW / 2, subtitleY, { align: 'center' });
  }

  // Date display
  if (template.visibleElements.includes('date')) {
    const panelText = hexToRgb(template.panelTextColor);
    const accent = hexToRgb(template.accentColor);

    // The large day number uses the accent color so the template's accent
    // choice is actually visible on the card. Month/year and time stay in the
    // panel text color for legibility on the dark panel.
    doc.setTextColor(accent.r, accent.g, accent.b);
    doc.setFontSize(22);
    doc.setFont(template.fontFamily, 'bold');
    doc.text(dayNum, leftW / 2, 55, { align: 'center' });

    doc.setTextColor(panelText.r, panelText.g, panelText.b);
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

  // Dashed divider — drawn in the accent color so the template accent is
  // reflected on the right (light) side of the card as well.
  const dividerY = nameEndY + 10;
  const dividerAccent = hexToRgb(template.accentColor);
  doc.setDrawColor(dividerAccent.r, dividerAccent.g, dividerAccent.b);
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

  // Barcode (bottom of right panel) — encodes the same CHECKIN: payload as the QR
  // Always rendered; the human-readable text below the bars serves as the visible reference.
  try {
    const barcodeDataUrl = generateBarcodeDataUrl(
      `CHECKIN:${data.registrationId}`,
      data.uniqueToken,
      template.qrColor,
    );
    const barcodeW = 70;
    const barcodeH = 12;
    const barcodeX = rightX + (rightW - barcodeW) / 2;
    const barcodeY = pageH - barcodeH - 4;
    doc.addImage(barcodeDataUrl, 'PNG', barcodeX, barcodeY, barcodeW, barcodeH);
  } catch {
    // If barcode generation fails, fall back to the original ref text so the card is still useful
    doc.setTextColor(148, 163, 184);
    doc.setFontSize(6);
    doc.text(`Ref: ${data.uniqueToken}`, pageW - 5, pageH - 5, { align: 'right' });
  }
}

export async function generateInvitationCard(
  data: InvitationCardData,
  template: CardTemplate,
  branding: CompanyBranding
): Promise<jsPDF> {
  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: [148, 105] });
  let logoImageData: string | undefined;
  // Always use the bundled logo asset for invitation cards, regardless of
  // whatever URL is set in company branding. The Settings-uploaded logo path
  // produced rendering artifacts on dark panels; the bundled asset is known good.
  try {
    const response = await fetch(bundledLogoSrc);
    const blob = await response.blob();
    logoImageData = await blobToBase64(blob);
  } catch { /* proceed without logo */ }
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
  // Always use the bundled logo asset for invitation cards, regardless of
  // whatever URL is set in company branding. The Settings-uploaded logo path
  // produced rendering artifacts on dark panels; the bundled asset is known good.
  try {
    const response = await fetch(bundledLogoSrc);
    const blob = await response.blob();
    logoImageData = await blobToBase64(blob);
  } catch { /* proceed without logo */ }
  for (let i = 0; i < invitations.length; i++) {
    if (i > 0) doc.addPage([148, 105], 'landscape');
    await drawInvitationCard(doc, invitations[i], template, branding, logoImageData);
  }
  return doc;
}

export function formatSlotDate(isoDatetime: string): string {
  const date = new Date(isoDatetime);
  return date.toLocaleDateString('en-MY', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: EVENT_TIME_ZONE,
  });
}

export function formatTime(timeString: string): string {
  return timeString.slice(0, 5);
}

/**
 * Format a slot's ISO timestamp (TIMESTAMPTZ / UTC instant) as HH:mm in the
 * event timezone (Asia/Singapore), independent of the viewer's device
 * timezone. Use this everywhere a slot start/end time is displayed — passing
 * the raw ISO string, NOT a date-fns format() result (which renders in device
 * local time and shows UTC on non-SGT devices / the email's UTC runtime).
 */
export function formatSlotTime(isoDatetime: string): string {
  return new Date(isoDatetime).toLocaleTimeString('en-GB', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone: EVENT_TIME_ZONE,
  });
}
