import jsPDF from 'jspdf';

const BUILTIN_FONTS = ['helvetica', 'courier', 'times'];

export const CURATED_FONTS = [
  { name: 'Helvetica', value: 'helvetica', style: 'Clean sans-serif' },
  { name: 'Courier', value: 'courier', style: 'Monospace' },
  { name: 'Times', value: 'times', style: 'Classic serif' },
] as const;

export function loadFont(doc: jsPDF, fontFamily: string): void {
  if (BUILTIN_FONTS.includes(fontFamily)) {
    doc.setFont(fontFamily);
    return;
  }
  // Fallback to helvetica for unloaded fonts
  doc.setFont('helvetica');
}

export function getFontDisplayName(value: string): string {
  const font = CURATED_FONTS.find((f) => f.value === value);
  return font?.name ?? value;
}
