import type { CardTemplate } from '@agent-system/shared-types';
import { getEffectiveTemplate } from '@agent-system/shared-types';

// Item 9 (round 4): visually distinguish different events' on-screen link
// cards ("Can we change the colour/style for different events' link? Same
// colour very confusing"). If the campaign has its own card template color
// overrides, mirror those on the printed card (panelColor/accentColor);
// otherwise pick deterministically from a curated palette keyed by campaign
// id so the SAME event always renders the SAME color and different events
// look visibly different. We deliberately do NOT fall back to the system
// default template's colors for campaigns without a color override — that
// would put every such campaign back on one shared color.
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

/**
 * Resolve the left-panel gradient for a link's InvitationCard.
 *
 * @param campaignId - the campaign this link belongs to
 * @param cardTemplateOverrides - `campaign.card_template_overrides` (null/undefined when unset)
 * @param systemTemplate - current system default template, used to fill in any
 *   fields the campaign override doesn't specify (matches `getEffectiveTemplate`
 *   usage elsewhere for PDF generation)
 */
export function resolveCardGradient(
  campaignId: string | undefined,
  cardTemplateOverrides: Partial<CardTemplate> | null | undefined,
  systemTemplate: CardTemplate,
): [string, string] {
  const hasColorOverride = !!(
    cardTemplateOverrides &&
    (cardTemplateOverrides.panelColor || cardTemplateOverrides.accentColor)
  );

  if (hasColorOverride) {
    const template = getEffectiveTemplate(systemTemplate, cardTemplateOverrides);
    if (template.panelColor && template.accentColor && template.panelColor !== template.accentColor) {
      return [template.panelColor, template.accentColor];
    }
  }

  return campaignGradient(campaignId);
}
