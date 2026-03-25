# Invitation Card Admin Management

**Date:** 2026-03-26
**Status:** Draft

## Problem

Invitation card design is entirely hard-coded — colors, text, company name, and layout are baked into the PDF generator and React component. Admins cannot customize card appearance, upload a company logo for cards, or create campaign-specific variations. The "RACC Agency" branding is static text with no actual logo image on cards.

## Solution

A form-based card template editor in the admin portal that gives admins full control over card appearance. System-wide default template with per-campaign partial overrides. Separate Company Settings page for logo management (reusable across the system). Real-time PDF preview as settings change.

## Key Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Editor type | Form-based settings panel | Practical to build and maintain; avoids drag-and-drop complexity |
| Template scope | System-wide default + per-campaign partial overrides | Clean inheritance; campaigns only store deltas |
| Storage approach | Hybrid: `system_settings` JSONB + campaign `card_template_overrides` JSONB | Flexible schema; system changes propagate automatically |
| Logo management | Separate Company Settings page | Single source of truth; logo reusable across system (cards, UI, public pages) |
| Auto/manual differentiation | Shared template, separate color settings per type | Keeps things simple; only the panel color differs |
| Customization scope | PDF gets full template customization; React component inherits branding only | PDF is the print artifact; React component is a UI display card |
| Preview | Real-time PDF preview in editor | Best admin UX; immediate visual feedback |
| Fonts | Curated list of 10-15 web-safe/Google fonts | Avoids custom font upload complexity; pre-bundled as base64 TTF in shared-ui |
| Reference token display | Full string, no truncation | Current `substring(0, 8) + "..."` is unnecessary |

## Data Architecture

### `system_settings` Table (new)

Single-row table holding system-wide configuration.

```sql
CREATE TABLE system_settings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_branding JSONB NOT NULL DEFAULT '{}',
  card_template JSONB NOT NULL DEFAULT '{}',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Seed with defaults
INSERT INTO system_settings (company_branding, card_template) VALUES (
  '{"companyName": "RACC Agency", "logoUrl": null, "logoWidth": 20}',
  '{"autoCardColor": "#0f172a", "manualCardColor": "#7f1d1d", "panelTextColor": "#ffffff", "accentColor": "#daa520", "fontFamily": "helvetica", "titleFontSize": 14, "bodyFontSize": 9, "subtitle": "Event Invitation", "instructionText": "Present this card at the event for check-in", "visibleElements": ["logo","subtitle","date","campaign","venue","qr","invitee","instruction","reference"], "elementOrder": ["campaign","venue","qr","invitee","instruction","reference"], "qrColor": "#0f172a", "qrSize": 25}'
);
```

RLS: admin-only read/write via `is_admin()`.

### TypeScript Interfaces

```typescript
export interface CompanyBranding {
  companyName: string;
  logoUrl: string | null;
  logoWidth: number; // mm, for PDF sizing
}

export interface CardTemplate {
  // Colors
  autoCardColor: string;
  manualCardColor: string;
  panelTextColor: string;
  accentColor: string;

  // Typography
  fontFamily: string;
  titleFontSize: number;
  bodyFontSize: number;

  // Content
  subtitle: string;
  instructionText: string;

  // Layout
  visibleElements: string[];
  elementOrder: string[];

  // QR
  qrColor: string;
  qrSize: number;
}

export interface SystemSettings {
  id: string;
  company_branding: CompanyBranding;
  card_template: CardTemplate;
  updated_at: string;
}
```

### Campaign Override Column

```sql
ALTER TABLE campaigns ADD COLUMN card_template_overrides JSONB DEFAULT NULL;
```

When `NULL`, the campaign uses the system default. When set, contains only overridden fields. Deep-merged at render time:

```typescript
function getEffectiveTemplate(
  systemDefault: CardTemplate,
  campaignOverrides?: Partial<CardTemplate> | null
): CardTemplate {
  if (!campaignOverrides) return systemDefault;
  return { ...systemDefault, ...campaignOverrides };
}
```

### Supabase Storage

New `company-assets` bucket for logo uploads. Public read access, admin-only write via RLS policy.

## Company Settings Page

**Location:** `apps/admin-portal/src/pages/Settings.tsx`
**Navigation:** New "Settings" item in admin sidebar, below existing menu items.

### UI Elements

- **Logo upload area:** Drag-and-drop zone with empty state and uploaded state (showing thumbnail, filename, upload date, Replace/Remove buttons)
- **Company name:** Text input, displayed on cards and portal headers
- **Logo size on cards:** Range slider (10-40mm), controls logo width in PDF rendering
- **Save button:** Persists to `system_settings.company_branding`

### Logo Upload Flow

1. Admin selects file (PNG, JPG, SVG)
2. File uploaded to Supabase Storage `company-assets` bucket
3. Public URL stored in `system_settings.company_branding.logoUrl`
4. Existing `<Logo />` component in shared-ui updated to read from `system_settings` instead of static asset, with static asset as fallback

### Validation

- File types: PNG, JPG, SVG only
- Max file size: 2MB
- Min dimensions: 200x200px recommended (advisory, not blocking)

## Card Template Editor

**Location:** `apps/admin-portal/src/pages/CardTemplateEditor.tsx`
**Navigation:** Settings > Card Template (same Settings section as Company Branding)

### Layout

Split-panel design:
- **Left panel (380px):** Settings form with 4 tabs
- **Right panel (flexible):** Live PDF preview

### Settings Tabs

**Colors Tab:**
- Auto card panel color (color picker + hex input)
- Manual card panel color (color picker + hex input)
- Panel text color (color picker + hex input)
- Accent color — company name highlight (color picker + hex input)
- QR code color (color picker + hex input)
- QR code size (range slider, 15-35mm)

**Typography Tab:**
- Font family (dropdown from curated list)
- Title font size — campaign name (number input, pt)
- Body font size — venue, instructions (number input, pt)

**Content Tab:**
- Subtitle text (text input, default: "Event Invitation")
- Instruction text (text input, default: "Present this card at the event for check-in")

**Layout Tab:**
- Show/hide toggles per element: logo, subtitle, date, campaign, venue, QR, invitee, instruction, reference
- Drag-to-reorder for right panel elements
- Elements: campaign name, venue, QR code, invitee, instruction text, reference token

### Live Preview

- Renders the card using jsPDF in an `<iframe>` or `<canvas>` as settings change
- Auto/Manual toggle to preview both color schemes with sample data
- Uses debounced re-render (300ms) to avoid excessive PDF generation
- Sample data: "Q1 Recruitment Drive", "Marina Bay Sands", "John Doe", etc.

### Actions

- **Save Template:** Persists to `system_settings.card_template`
- **Reset to Defaults:** Restores hard-coded default values
- **Download Sample PDF:** Generates and downloads a sample PDF with current settings

### Curated Font List

Pre-bundled as base64 TTF in `packages/shared-ui/src/assets/fonts/`:

| Font | jsPDF Name | Style |
|------|-----------|-------|
| Helvetica | helvetica | Clean sans-serif (default) |
| Courier | courier | Monospace |
| Times | times | Classic serif |
| Roboto | roboto | Modern sans-serif |
| Open Sans | opensans | Friendly sans-serif |
| Lato | lato | Warm sans-serif |
| Montserrat | montserrat | Geometric sans-serif |
| Playfair Display | playfair | Elegant serif |
| Source Sans Pro | sourcesanspro | Professional sans-serif |
| Inter | inter | UI-optimized sans-serif |
| Poppins | poppins | Geometric, modern |
| Raleway | raleway | Thin, elegant |

Fonts loaded via `doc.addFont()` at PDF generation time. Helvetica, Courier, and Times are built into jsPDF; others require bundled TTF files.

## Campaign Override UI

**Location:** Inside `apps/admin-portal/src/pages/campaigns/CampaignDetail.tsx`

### UI Design

- New collapsible card section: "Card Template Override"
- Default collapsed state shows: "Using system default template"
- "Override Template" button expands the same 4-tab editor pre-filled with system defaults
- Admin changes only the fields they want — unchanged fields remain linked to system defaults
- Small "Overridden" badges next to modified fields
- "Reset to System Default" button clears all overrides (sets `card_template_overrides` to `NULL`)
- Live preview shows the merged result (system default + campaign overrides)

### Data Flow

```typescript
// Only overridden fields stored
campaignOverrides = { subtitle: "VIP Invitation", autoCardColor: "#1e3a5f" }

// Merged at render time
effectiveTemplate = { ...systemDefault, ...campaignOverrides }
```

## PDF Generator Updates

**File:** `packages/shared-ui/src/utils/pdfGenerator.ts`

### Updated Function Signatures

```typescript
// Internal draw function
async function drawInvitationCard(
  doc: jsPDF,
  data: InvitationCardData,
  template: CardTemplate,
  branding: CompanyBranding,
  logoImageData?: string  // base64, pre-fetched once per batch
): Promise<void>

// Public API — single card
export async function generateInvitationCard(
  data: InvitationCardData,
  template: CardTemplate,
  branding: CompanyBranding
): Promise<jsPDF>

// Public API — bulk cards
export async function generateBulkInvitationCards(
  invitations: InvitationCardData[],
  template: CardTemplate,
  branding: CompanyBranding
): Promise<jsPDF>
```

Both public functions fetch the logo as base64 once (when `branding.logoUrl` is set), then pass it to each `drawInvitationCard` call.

### Changes

Every hard-coded value replaced with template config lookup:

| Current (hard-coded) | New (from config) |
|---|---|
| Navy `#0f172a` / Burgundy `#7f1d1d` | `template.autoCardColor` / `template.manualCardColor` |
| "RACC AGENCY" text | `branding.companyName` |
| No logo image | `branding.logoUrl` via `doc.addImage()` |
| Gold `#daa520` accent | `template.accentColor` |
| White `#ffffff` panel text | `template.panelTextColor` |
| "Event Invitation" | `template.subtitle` |
| "Present this card at..." | `template.instructionText` |
| Font sizes 14/9/8 etc. | `template.titleFontSize` / `template.bodyFontSize` |
| `helvetica` | `template.fontFamily` |
| QR navy, 25mm | `template.qrColor` / `template.qrSize` |
| Ref truncated to 8 chars + "..." | Full reference string |
| Fixed element order | `template.elementOrder` |
| All elements always shown | `template.visibleElements` controls show/hide |

### Logo Rendering in PDF

Logo image fetched once as base64 when generating a batch. Sized using `branding.logoWidth` (mm). Rendered on the left panel above the company name text. When `logoUrl` is null, only the company name text is shown (current behavior preserved).

### Font Loading

For non-built-in fonts (Roboto, Inter, etc.):
1. Import the base64 TTF from `shared-ui/src/assets/fonts/`
2. Register via `doc.addFont(base64Data, fontName, 'normal')`
3. Set via `doc.setFont(fontName)`

Built-in fonts (Helvetica, Courier, Times) require no loading.

## React InvitationCard Component Updates

**File:** `packages/shared-ui/src/components/ui/invitation-card.tsx`

### New Props

```typescript
interface InvitationCardProps {
  // ... existing props unchanged
  companyName?: string;    // falls back to "RACC Agency"
  logoUrl?: string | null; // falls back to static asset
}
```

### Changes

- Company name: hard-coded "RACC Agency" → reads from `companyName` prop
- Logo: adds `<img>` using `logoUrl` prop when available
- Accent color: gold highlight reads from branding
- All other layout, responsive behavior, status badges, and actions stay unchanged

### Data Flow

New `useSystemSettings()` hook in admin and agent portals:
- Fetches `system_settings` row once
- Cached via React Query with long stale time (branding changes rarely)
- Parent components pass `companyName` and `logoUrl` to `InvitationCard`

## New Hooks

### `useSystemSettings`

**Location:** `apps/admin-portal/src/hooks/useSystemSettings.ts` (and agent-portal equivalent)

```typescript
function useSystemSettings() {
  return useQuery({
    queryKey: ['system-settings'],
    queryFn: async () => {
      const { data } = await supabase
        .from('system_settings')
        .select('*')
        .single();
      return data as SystemSettings;
    },
    staleTime: 5 * 60 * 1000, // 5 min — branding changes rarely
  });
}
```

### `useUpdateSystemSettings`

**Location:** `apps/admin-portal/src/hooks/useSystemSettings.ts`

Mutation hook for saving company branding and card template. Invalidates `['system-settings']` on success.

## Files Changed

| File | Action | Description |
|------|--------|-------------|
| `supabase/migrations/YYYYMMDD_system_settings.sql` | Create | New `system_settings` table + seed + RLS |
| `supabase/migrations/YYYYMMDD_campaign_card_overrides.sql` | Create | Add `card_template_overrides` column to campaigns |
| `supabase/migrations/YYYYMMDD_company_assets_bucket.sql` | Create | Create `company-assets` storage bucket + policies |
| `packages/shared-types/src/database.ts` | Modify | Add `CompanyBranding`, `CardTemplate`, `SystemSettings` interfaces; add `card_template_overrides` to `Campaign` |
| `packages/shared-ui/src/utils/pdfGenerator.ts` | Modify | Replace all hard-coded values with template/branding config; add logo rendering; show full ref token |
| `packages/shared-ui/src/assets/fonts/` | Create | Bundled TTF files for curated Google Fonts |
| `packages/shared-ui/src/utils/fonts.ts` | Create | Font loading utilities for jsPDF |
| `packages/shared-ui/src/components/ui/invitation-card.tsx` | Modify | Add `companyName` and `logoUrl` props with fallbacks |
| `packages/shared-ui/src/index.ts` | Modify | Export new types and font utilities |
| `apps/admin-portal/src/pages/Settings.tsx` | Create | Company Settings page with logo upload |
| `apps/admin-portal/src/pages/CardTemplateEditor.tsx` | Create | Card template editor with 4-tab form + live preview |
| `apps/admin-portal/src/hooks/useSystemSettings.ts` | Create | Query + mutation hooks for system_settings |
| `apps/admin-portal/src/hooks/useCompanyAssets.ts` | Create | Logo upload/delete hooks for Supabase Storage |
| `apps/admin-portal/src/components/Layout.tsx` | Modify | Add "Settings" nav item to sidebar |
| `apps/admin-portal/src/pages/campaigns/CampaignDetail.tsx` | Modify | Add card template override section |
| `apps/admin-portal/src/pages/PdfExport.tsx` | Modify | Fetch system settings + campaign overrides; pass to PDF generator |
| `apps/agent-portal/src/hooks/useSystemSettings.ts` | Create | Query hook for system_settings (read-only) |
| `apps/agent-portal/src/pages/MyLinks.tsx` | Modify | Pass branding to InvitationCard; pass template to PDF generation |
| `apps/agent-portal/src/pages/PartnerLinks.tsx` | Modify | Same as MyLinks |

## Out of Scope

- Public pages: no card template changes (check-in/out/register flows unaffected)
- Drag-and-drop canvas editor: form-based approach chosen instead
- Custom font uploads: curated list only
- Email/WhatsApp card sharing: not part of this feature
- Card template versioning/history: not needed for current requirements
- Multiple named templates: one system default + per-campaign overrides is sufficient
