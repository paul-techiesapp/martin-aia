import type { CardTemplate } from '@agent-system/shared-types';

// Item 9 (round 4): visually distinguish different events' on-screen link
// cards ("Can we change the colour/style for different events' link? Same
// colour very confusing"). If the campaign overrides its printed card's
// panelColor, derive the on-screen gradient from that color; otherwise pick
// deterministically from a curated palette keyed by campaign id so the SAME
// event always renders the SAME color and different events look visibly
// different. We deliberately do NOT fall back to the system default
// template's colors for campaigns without an override — that would put every
// such campaign back on one shared color.
const CARD_GRADIENTS: [string, string][] = [
  ['#0F172A', '#0369A1'], ['#7C2D12', '#EA580C'], ['#14532D', '#16A34A'],
  ['#581C87', '#9333EA'], ['#831843', '#DB2777'], ['#713F12', '#CA8A04'],
  ['#134E4A', '#0D9488'], ['#312E81', '#4F46E5'],
];

function campaignGradient(campaignId: string | undefined): [string, string] {
  if (!campaignId) return CARD_GRADIENTS[0];
  let h = 0;
  for (let i = 0; i < campaignId.length; i++) h = (h * 31 + campaignId.charCodeAt(i)) >>> 0;
  return CARD_GRADIENTS[h % CARD_GRADIENTS.length];
}

/** Parse #rgb/#rrggbb into [r, g, b] 0-255, or null when not valid hex. */
function parseHex(hex: string): [number, number, number] | null {
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return null;
  let s = m[1];
  if (s.length === 3) s = s.split('').map((c) => c + c).join('');
  return [
    parseInt(s.slice(0, 2), 16),
    parseInt(s.slice(2, 4), 16),
    parseInt(s.slice(4, 6), 16),
  ];
}

/** Darken by scaling each channel toward black. amount 0..1. */
function darken(rgb: [number, number, number], amount: number): string {
  return `#${rgb
    .map((c) => Math.round(Math.max(0, Math.min(255, c * (1 - amount)))).toString(16).padStart(2, '0'))
    .join('')}`;
}

/** WCAG relative luminance (0 = black, 1 = white). */
function relativeLuminance([r, g, b]: [number, number, number]): number {
  const [lr, lg, lb] = [r, g, b].map((c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * lr + 0.7152 * lg + 0.0722 * lb;
}

/** WCAG contrast ratio of a color against white text. */
function contrastVsWhite(rgb: [number, number, number]): number {
  return 1.05 / (relativeLuminance(rgb) + 0.05);
}

/**
 * Resolve the left-panel gradient for a link's InvitationCard.
 *
 * The card renders white text over this gradient, so both stops must stay
 * dark. `accentColor` is a FOREGROUND accent on the printed card (default
 * gold #daa520, ~2.2:1 vs white) and is never used as a background stop.
 * When the campaign overrides `panelColor`, the gradient is
 * `[darken(panelColor, 25%), panelColor]` — dark → lighter along the
 * existing 135° layout, matching the default card's #0F172A → #0369A1 feel.
 * If the overridden panelColor is itself too light for white text
 * (contrast vs white < 3:1) the override is ignored and the deterministic
 * palette is used instead.
 *
 * @param campaignId - the campaign this link belongs to
 * @param cardTemplateOverrides - `campaign.card_template_overrides` (null/undefined when unset)
 * @param _systemTemplate - kept for call-site signature compatibility; the
 *   system default's colors are intentionally never used here (every
 *   campaign sharing the default color would defeat per-event distinction)
 */
export function resolveCardGradient(
  campaignId: string | undefined,
  cardTemplateOverrides: Partial<CardTemplate> | null | undefined,
  _systemTemplate: CardTemplate,
): [string, string] {
  const overridePanel = cardTemplateOverrides?.panelColor;
  if (overridePanel) {
    const rgb = parseHex(overridePanel);
    // Luminance guard: only honor overrides dark enough for white text.
    if (rgb && contrastVsWhite(rgb) >= 3) {
      return [darken(rgb, 0.25), overridePanel];
    }
  }

  return campaignGradient(campaignId);
}

/**
 * Round 5 item 5: assign every campaign in a rendered list a DISTINCT palette
 * gradient. The hash in campaignGradient() can collide (8 slots), which put
 * two different events on the same color. Campaigns whose gradient derives
 * from an explicit panelColor override keep it (admin's choice, collisions
 * intentional). Palette-derived campaigns probe forward (ids processed in
 * sorted order for determinism) to the next free slot; after 8 palette
 * campaigns the slots cycle.
 */
export function assignCampaignGradients(
  campaigns: Array<
    { id: string; card_template_overrides?: Partial<CardTemplate> | null } | null | undefined
  >,
  systemTemplate: CardTemplate,
): Map<string, [string, string]> {
  const unique = new Map<string, Partial<CardTemplate> | null | undefined>();
  for (const c of campaigns) {
    if (c?.id && !unique.has(c.id)) unique.set(c.id, c.card_template_overrides);
  }
  const result = new Map<string, [string, string]>();
  const usedSlots = new Set<number>();
  for (const id of Array.from(unique.keys()).sort()) {
    const resolved = resolveCardGradient(id, unique.get(id), systemTemplate);
    const paletteIdx = CARD_GRADIENTS.findIndex(([f, t]) => f === resolved[0] && t === resolved[1]);
    if (paletteIdx === -1) {
      result.set(id, resolved); // override-derived — keep as-is
      continue;
    }
    let idx = paletteIdx;
    if (usedSlots.size < CARD_GRADIENTS.length) {
      while (usedSlots.has(idx)) idx = (idx + 1) % CARD_GRADIENTS.length;
    }
    usedSlots.add(idx);
    result.set(id, CARD_GRADIENTS[idx]);
  }
  return result;
}
