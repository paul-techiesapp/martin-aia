# Invitation Card Admin Management Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give admins full control over invitation card design through a form-based template editor with live PDF preview, company logo management, and per-campaign overrides.

**Architecture:** System-wide defaults in a `system_settings` JSONB table, with per-campaign partial overrides via `card_template_overrides` JSONB column on campaigns. Company logo stored in Supabase Storage `company-assets` bucket. PDF generator reads template config instead of hard-coded values. React InvitationCard inherits branding props only.

**Tech Stack:** Supabase (PostgreSQL, Storage, RLS), React 18, TanStack Query, TanStack Router, jsPDF, Tailwind CSS, shadcn/ui, Zod validation, react-hook-form

**Spec:** `docs/superpowers/specs/2026-03-26-invitation-card-admin-management-design.md`

---

### Task 1: Database Migrations

**Files:**
- Create: `supabase/migrations/20260326000002_system_settings.sql`
- Create: `supabase/migrations/20260326000003_campaign_card_overrides.sql`
- Create: `supabase/migrations/20260326000004_company_assets_bucket.sql`

- [ ] **Step 1: Create system_settings table migration**

Create `supabase/migrations/20260326000002_system_settings.sql`:

```sql
-- System-wide settings (single-row table)
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

-- RLS
ALTER TABLE system_settings ENABLE ROW LEVEL SECURITY;

-- Admin can read and write
CREATE POLICY "Admins can manage system settings"
  ON system_settings FOR ALL
  USING (is_admin())
  WITH CHECK (is_admin());

-- Agents can read (for branding in their portal)
CREATE POLICY "Authenticated users can read system settings"
  ON system_settings FOR SELECT
  USING (auth.role() = 'authenticated');

-- Anon can read (for public pages branding)
CREATE POLICY "Anon can read system settings"
  ON system_settings FOR SELECT
  USING (true);
```

- [ ] **Step 2: Create campaign card overrides migration**

Create `supabase/migrations/20260326000003_campaign_card_overrides.sql`:

```sql
ALTER TABLE campaigns ADD COLUMN card_template_overrides JSONB DEFAULT NULL;
```

- [ ] **Step 3: Create company-assets storage bucket migration**

Create `supabase/migrations/20260326000004_company_assets_bucket.sql`:

```sql
-- Create company-assets bucket (public read)
INSERT INTO storage.buckets (id, name, public)
VALUES ('company-assets', 'company-assets', true);

-- Admin can upload/update/delete
CREATE POLICY "Admins can manage company assets"
  ON storage.objects FOR ALL
  USING (bucket_id = 'company-assets' AND is_admin())
  WITH CHECK (bucket_id = 'company-assets' AND is_admin());

-- Anyone can read (public bucket)
CREATE POLICY "Public read access for company assets"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'company-assets');
```

- [ ] **Step 4: Deploy migrations to production**

Run: `npx supabase db push --linked`

Verify: Check Supabase dashboard that `system_settings` table exists with one seeded row, `campaigns` has `card_template_overrides` column, and `company-assets` bucket exists.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260326000002_system_settings.sql supabase/migrations/20260326000003_campaign_card_overrides.sql supabase/migrations/20260326000004_company_assets_bucket.sql
git commit -m "feat(db): add system_settings table, campaign card overrides, and company-assets bucket"
```

---

### Task 2: Shared Types

**Files:**
- Modify: `packages/shared-types/src/database.ts:12-31` (after CheckoutConfig, before Campaign)

- [ ] **Step 1: Add new interfaces to shared-types**

Add these interfaces to `packages/shared-types/src/database.ts` after the `CheckoutConfig` interface (after line 18):

```typescript
export interface CompanyBranding {
  companyName: string;
  logoUrl: string | null;
  logoWidth: number;
}

export interface CardTemplate {
  autoCardColor: string;
  manualCardColor: string;
  panelTextColor: string;
  accentColor: string;
  fontFamily: string;
  titleFontSize: number;
  bodyFontSize: number;
  subtitle: string;
  instructionText: string;
  visibleElements: string[];
  elementOrder: string[];
  qrColor: string;
  qrSize: number;
}

export interface SystemSettings {
  id: string;
  company_branding: CompanyBranding;
  card_template: CardTemplate;
  updated_at: string;
}

export const DEFAULT_CARD_TEMPLATE: CardTemplate = {
  autoCardColor: '#0f172a',
  manualCardColor: '#7f1d1d',
  panelTextColor: '#ffffff',
  accentColor: '#daa520',
  fontFamily: 'helvetica',
  titleFontSize: 14,
  bodyFontSize: 9,
  subtitle: 'Event Invitation',
  instructionText: 'Present this card at the event for check-in',
  visibleElements: ['logo', 'subtitle', 'date', 'campaign', 'venue', 'qr', 'invitee', 'instruction', 'reference'],
  elementOrder: ['campaign', 'venue', 'qr', 'invitee', 'instruction', 'reference'],
  qrColor: '#0f172a',
  qrSize: 25,
};

export const DEFAULT_COMPANY_BRANDING: CompanyBranding = {
  companyName: 'RACC Agency',
  logoUrl: null,
  logoWidth: 20,
};

export function getEffectiveTemplate(
  systemDefault: CardTemplate,
  campaignOverrides?: Partial<CardTemplate> | null
): CardTemplate {
  if (!campaignOverrides) return systemDefault;
  return { ...systemDefault, ...campaignOverrides };
}
```

- [ ] **Step 2: Add card_template_overrides to Campaign interface**

In the `Campaign` interface (`packages/shared-types/src/database.ts`), add after `checkout_config`:

```typescript
  card_template_overrides?: Partial<CardTemplate> | null;
```

- [ ] **Step 3: Verify typecheck passes**

Run: `pnpm -r typecheck`

- [ ] **Step 4: Commit**

```bash
git add packages/shared-types/src/database.ts
git commit -m "feat(types): add CompanyBranding, CardTemplate, SystemSettings interfaces and defaults"
```

---

### Task 3: PDF Generator -- Template-Driven Rendering

**Files:**
- Modify: `packages/shared-ui/src/utils/pdfGenerator.ts`

- [ ] **Step 1: Add helper functions and update imports**

At the top of `packages/shared-ui/src/utils/pdfGenerator.ts`, add the import and helpers:

```typescript
import type { CardTemplate, CompanyBranding } from '@agent-system/shared-types';

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
```

- [ ] **Step 2: Update generateQrDataUrl to accept color**

Replace the existing `generateQrDataUrl` function:

```typescript
async function generateQrDataUrl(text: string, color: string): Promise<string> {
  return QRCode.toDataURL(text, {
    width: 200,
    margin: 1,
    color: { dark: color, light: '#ffffff' },
  });
}
```

- [ ] **Step 3: Rewrite drawInvitationCard with template-driven rendering**

Replace the entire `drawInvitationCard` function with a version that reads all values from `template` and `branding` parameters instead of hard-coded constants. Key changes:

- Signature: `async function drawInvitationCard(doc: jsPDF, data: InvitationCardData, template: CardTemplate, branding: CompanyBranding, logoImageData?: string): Promise<void>`
- Panel color: `hexToRgb(data.isAutoCard ? template.autoCardColor : template.manualCardColor)`
- Company name: `branding.companyName.toUpperCase()`
- Accent color: `hexToRgb(template.accentColor)`
- Panel text: `hexToRgb(template.panelTextColor)`
- Logo: `if (logoImageData && template.visibleElements.includes('logo')) { doc.addImage(...) }`
- Subtitle: `template.subtitle`
- Font: `template.fontFamily` in all `doc.setFont()` calls
- Title size: `template.titleFontSize`
- Body size: `template.bodyFontSize`
- QR: `generateQrDataUrl(\`CHECKIN:${data.registrationId}\`, template.qrColor)` and `template.qrSize` for dimensions
- Instruction: `template.instructionText`
- Ref token: show full `data.uniqueToken` (no substring/truncation)
- Check `template.visibleElements` before rendering each section

- [ ] **Step 4: Update public API functions**

Replace `generateInvitationCard`:

```typescript
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
```

Replace `generateBulkInvitationCards`:

```typescript
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
```

- [ ] **Step 5: Verify typecheck passes**

Run: `pnpm -r typecheck`

- [ ] **Step 6: Commit**

```bash
git add packages/shared-ui/src/utils/pdfGenerator.ts
git commit -m "feat(pdf): make PDF generator template-driven with branding and logo support"
```

---

### Task 4: React InvitationCard -- Branding Props

**Files:**
- Modify: `packages/shared-ui/src/components/ui/invitation-card.tsx`

- [ ] **Step 1: Add branding props to InvitationCardProps**

In `packages/shared-ui/src/components/ui/invitation-card.tsx`, add to the `InvitationCardProps` interface (before `actions` on line 28):

```typescript
  /** Company name displayed on card. Falls back to "RACC Agency". */
  companyName?: string;
  /** Company logo URL. Falls back to no image. */
  logoUrl?: string | null;
```

- [ ] **Step 2: Accept props in component and update rendering**

Add `companyName` and `logoUrl` to the destructured props in the function signature.

Replace the hard-coded "RACC Agency" section in the left panel (lines 69-75) with:

```tsx
{logoUrl && (
  <img src={logoUrl} alt={companyName || 'RACC Agency'} className="w-8 h-8 object-contain mb-1" />
)}
<div
  className="text-[8px] font-semibold uppercase tracking-[1px]"
  style={{ color: '#DAA520' }}
>
  {companyName || 'RACC Agency'}
</div>
```

- [ ] **Step 3: Verify typecheck passes**

Run: `pnpm -r typecheck`

- [ ] **Step 4: Commit**

```bash
git add packages/shared-ui/src/components/ui/invitation-card.tsx
git commit -m "feat(ui): add companyName and logoUrl props to InvitationCard"
```

---

### Task 5: Font Loading Utility

**Files:**
- Create: `packages/shared-ui/src/utils/fonts.ts`
- Modify: `packages/shared-ui/src/index.ts`

- [ ] **Step 1: Create font utility**

Create `packages/shared-ui/src/utils/fonts.ts`:

```typescript
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
```

Start with 3 built-in jsPDF fonts. Google Fonts can be added later by downloading TTF files and converting to base64.

- [ ] **Step 2: Export from shared-ui index**

In `packages/shared-ui/src/index.ts`, add after the PDF Generation exports (after line 126):

```typescript
export { CURATED_FONTS, loadFont, getFontDisplayName } from './utils/fonts';
```

- [ ] **Step 3: Use loadFont in pdfGenerator**

In `packages/shared-ui/src/utils/pdfGenerator.ts`, add import:

```typescript
import { loadFont } from './fonts';
```

In `drawInvitationCard`, call `loadFont(doc, template.fontFamily)` before the first `doc.setFont()` call. This ensures graceful fallback.

- [ ] **Step 4: Commit**

```bash
git add packages/shared-ui/src/utils/fonts.ts packages/shared-ui/src/index.ts packages/shared-ui/src/utils/pdfGenerator.ts
git commit -m "feat(fonts): add font loading utility with built-in fonts and extensible design"
```

---

### Task 6: Admin Portal -- useSystemSettings Hook

**Files:**
- Create: `apps/admin-portal/src/hooks/useSystemSettings.ts`

- [ ] **Step 1: Create the hook file**

Create `apps/admin-portal/src/hooks/useSystemSettings.ts`:

```typescript
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import type { SystemSettings, CompanyBranding, CardTemplate } from '@agent-system/shared-types';

export function useSystemSettings() {
  return useQuery({
    queryKey: ['system-settings'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('system_settings')
        .select('*')
        .single();
      if (error) throw error;
      return data as SystemSettings;
    },
    staleTime: 5 * 60 * 1000,
  });
}

export function useUpdateCompanyBranding() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (branding: CompanyBranding) => {
      const { data: existing } = await supabase
        .from('system_settings')
        .select('id')
        .single();
      if (!existing) throw new Error('System settings not found');
      const { error } = await supabase
        .from('system_settings')
        .update({ company_branding: branding, updated_at: new Date().toISOString() })
        .eq('id', existing.id);
      if (error) throw error;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['system-settings'] }),
  });
}

export function useUpdateCardTemplate() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (template: CardTemplate) => {
      const { data: existing } = await supabase
        .from('system_settings')
        .select('id')
        .single();
      if (!existing) throw new Error('System settings not found');
      const { error } = await supabase
        .from('system_settings')
        .update({ card_template: template, updated_at: new Date().toISOString() })
        .eq('id', existing.id);
      if (error) throw error;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['system-settings'] }),
  });
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/admin-portal/src/hooks/useSystemSettings.ts
git commit -m "feat(admin): add useSystemSettings query and mutation hooks"
```

---

### Task 7: Admin Portal -- Company Assets Upload Hook

**Files:**
- Create: `apps/admin-portal/src/hooks/useCompanyAssets.ts`

- [ ] **Step 1: Create the upload hook**

Create `apps/admin-portal/src/hooks/useCompanyAssets.ts`:

```typescript
import { useMutation } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';

export function useUploadLogo() {
  return useMutation({
    mutationFn: async (file: File) => {
      const ext = file.name.split('.').pop();
      const fileName = `logo.${ext}`;
      await supabase.storage.from('company-assets').remove([fileName]);
      const { error } = await supabase.storage
        .from('company-assets')
        .upload(fileName, file, { upsert: true });
      if (error) throw error;
      const { data: urlData } = supabase.storage
        .from('company-assets')
        .getPublicUrl(fileName);
      return urlData.publicUrl;
    },
  });
}

export function useDeleteLogo() {
  return useMutation({
    mutationFn: async (fileName: string) => {
      const { error } = await supabase.storage
        .from('company-assets')
        .remove([fileName]);
      if (error) throw error;
    },
  });
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/admin-portal/src/hooks/useCompanyAssets.ts
git commit -m "feat(admin): add company logo upload/delete hooks for Supabase Storage"
```

---

### Task 8: Admin Portal -- Company Settings Page

**Files:**
- Create: `apps/admin-portal/src/pages/Settings.tsx`

- [ ] **Step 1: Create the Settings page**

Create `apps/admin-portal/src/pages/Settings.tsx` with:

- Page header: "Company Settings" with description
- Card section: "Company Branding"
- Logo upload area with file input (accept `image/png,image/jpeg,image/svg+xml`, max 2MB)
- Two visual states: empty (dashed border upload zone) and uploaded (thumbnail + Replace/Remove)
- Company name text input bound to `company_branding.companyName`
- Logo size range slider (10-40mm) bound to `company_branding.logoWidth`
- Save button calling `useUpdateCompanyBranding` mutation
- Toast on success/error
- Link to Card Template Editor at bottom: "Customize card design" pointing to `/settings/card-template`

Use: `Card`, `CardHeader`, `CardTitle`, `CardDescription`, `CardContent`, `Input`, `Button`, `Label`, `useToast` from shared-ui.

Hooks: `useSystemSettings`, `useUpdateCompanyBranding` from `../hooks/useSystemSettings`, `useUploadLogo`, `useDeleteLogo` from `../hooks/useCompanyAssets`.

Logo upload flow:
1. File selected via input
2. Validate type and size client-side
3. Call `uploadLogo.mutateAsync(file)` to get public URL
4. Set local state `logoUrl` to returned URL
5. On "Save Changes", persist full `CompanyBranding` object

- [ ] **Step 2: Verify rendering**

Run: `pnpm dev:admin`, navigate to `/settings`. Verify page renders correctly.

- [ ] **Step 3: Commit**

```bash
git add apps/admin-portal/src/pages/Settings.tsx
git commit -m "feat(admin): add Company Settings page with logo upload and branding management"
```

---

### Task 9: Admin Portal -- Card Template Editor Page

**Files:**
- Create: `apps/admin-portal/src/pages/CardTemplateEditor.tsx`

- [ ] **Step 1: Create the CardTemplateEditor page**

Create `apps/admin-portal/src/pages/CardTemplateEditor.tsx` with split-panel layout:

**Left panel (380px fixed, scrollable):**

4 tabs using shadcn `Tabs`, `TabsList`, `TabsTrigger`, `TabsContent`:

- **Colors Tab:** Color picker (`<input type="color">`) + hex text input for: `autoCardColor`, `manualCardColor`, `panelTextColor`, `accentColor`, `qrColor`. Range slider for `qrSize` (15-35mm).
- **Typography Tab:** Select dropdown for `fontFamily` using `CURATED_FONTS` from shared-ui. Number inputs for `titleFontSize` and `bodyFontSize`.
- **Content Tab:** Text inputs for `subtitle` and `instructionText`.
- **Layout Tab:** Checkbox toggles for each value in `visibleElements`. Up/down arrow buttons to reorder `elementOrder` items.

**Right panel (flexible):**

- Preview header with Auto/Manual toggle buttons
- `<iframe>` showing live PDF preview
- Debounced (300ms) re-render on form state change
- Sample data for preview:
  ```typescript
  const SAMPLE_DATA: InvitationCardData = {
    inviteeName: 'John Doe',
    campaignName: 'Q1 Recruitment Drive',
    venue: 'Marina Bay Sands Convention Centre',
    dayOfWeek: 'Sat',
    slotDate: '2026-03-15T09:00:00+08:00',
    startTime: '09:00',
    endTime: '12:00',
    uniqueToken: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
    registrationId: 'sample-reg-001',
    registrationUrl: 'https://example.com/register/sample',
    isAutoCard: true,
  };
  ```

**Bottom bar:**
- "Reset to Defaults" (resets to `DEFAULT_CARD_TEMPLATE`)
- "Download Sample PDF" (generates and triggers download)
- "Save Template" (calls `useUpdateCardTemplate`)

Preview rendering approach:
```typescript
const renderPreview = useCallback(async () => {
  const effectiveData = { ...SAMPLE_DATA, isAutoCard: previewMode === 'auto' };
  const doc = await generateInvitationCard(effectiveData, formState, branding);
  const pdfBlob = doc.output('blob');
  const url = URL.createObjectURL(pdfBlob);
  setPreviewUrl((prev) => { if (prev) URL.revokeObjectURL(prev); return url; });
}, [formState, branding, previewMode]);
```

- [ ] **Step 2: Verify editor works**

Run: `pnpm dev:admin`, navigate to `/settings/card-template`. Check all 4 tabs, preview updates, save/reset/download.

- [ ] **Step 3: Commit**

```bash
git add apps/admin-portal/src/pages/CardTemplateEditor.tsx
git commit -m "feat(admin): add Card Template Editor with 4-tab form and live PDF preview"
```

---

### Task 10: Admin Portal -- Router and Navigation

**Files:**
- Modify: `apps/admin-portal/src/router.tsx`
- Modify: `apps/admin-portal/src/components/Layout.tsx:4,14,18-26`

- [ ] **Step 1: Add routes**

In `apps/admin-portal/src/router.tsx`:

Add imports:
```typescript
import { Settings } from './pages/Settings';
import { CardTemplateEditor } from './pages/CardTemplateEditor';
```

Add route definitions after `checkInScannerRoute` (after line 124):
```typescript
const settingsRoute = createRoute({
  getParentRoute: () => protectedLayoutRoute,
  path: '/settings',
  component: Settings,
});

const cardTemplateRoute = createRoute({
  getParentRoute: () => protectedLayoutRoute,
  path: '/settings/card-template',
  component: CardTemplateEditor,
});
```

Add to routeTree children (inside `protectedLayoutRoute.addChildren([...])`, after `checkInScannerRoute`):
```typescript
    settingsRoute,
    cardTemplateRoute,
```

- [ ] **Step 2: Add Settings nav item**

In `apps/admin-portal/src/components/Layout.tsx`:

Add `Settings as SettingsIcon` to the lucide-react import (line 14).

Add to the `navigation` array (after Check-In on line 25):
```typescript
  { name: 'Settings', href: '/settings', icon: SettingsIcon },
```

- [ ] **Step 3: Verify navigation**

Run: `pnpm dev:admin`. Verify Settings appears in sidebar, routes work, active state highlights correctly.

- [ ] **Step 4: Commit**

```bash
git add apps/admin-portal/src/router.tsx apps/admin-portal/src/components/Layout.tsx
git commit -m "feat(admin): add Settings and Card Template routes and sidebar navigation"
```

---

### Task 11: Update PdfExport Page

**Files:**
- Modify: `apps/admin-portal/src/pages/PdfExport.tsx`

- [ ] **Step 1: Integrate system settings into PDF generation**

In `apps/admin-portal/src/pages/PdfExport.tsx`:

Add imports:
```typescript
import { useSystemSettings } from '../hooks/useSystemSettings';
import { getEffectiveTemplate, DEFAULT_CARD_TEMPLATE, DEFAULT_COMPANY_BRANDING } from '@agent-system/shared-types';
import type { CardTemplate } from '@agent-system/shared-types';
```

Inside the component, add: `const { data: systemSettings } = useSystemSettings();`

Update the `Registration` interface's campaign type to include `card_template_overrides`:
```typescript
campaign: {
  name: string;
  venue: string;
  card_template_overrides: Record<string, unknown> | null;
};
```

Update the Supabase query slot select (line 96-101) to fetch campaign overrides:
```
slot:slots(start_at, end_at, is_auto_card, campaign:campaigns(name, venue, card_template_overrides))
```

Update `handleGenerateInvitationCards` to use template config:
```typescript
const branding = systemSettings?.company_branding ?? DEFAULT_COMPANY_BRANDING;
const campaignOverrides = registrations[0]?.slot?.campaign?.card_template_overrides as Partial<CardTemplate> | null;
const template = getEffectiveTemplate(
  systemSettings?.card_template ?? DEFAULT_CARD_TEMPLATE,
  campaignOverrides
);
const doc = await generateBulkInvitationCards(invitationData, template, branding);
```

- [ ] **Step 2: Verify PDF export works**

Run: `pnpm dev:admin`, go to PDF Export, generate cards. Verify template settings are applied.

- [ ] **Step 3: Commit**

```bash
git add apps/admin-portal/src/pages/PdfExport.tsx
git commit -m "feat(admin): update PdfExport to use system settings and campaign overrides"
```

---

### Task 12: Campaign Detail -- Card Template Override Section

**Files:**
- Modify: `apps/admin-portal/src/pages/campaigns/CampaignDetail.tsx`

- [ ] **Step 1: Add card template override UI**

Add imports:
```typescript
import { useSystemSettings } from '../../hooks/useSystemSettings';
import { getEffectiveTemplate, DEFAULT_CARD_TEMPLATE } from '@agent-system/shared-types';
import type { CardTemplate } from '@agent-system/shared-types';
```

Add state and hooks:
```typescript
const { data: systemSettings } = useSystemSettings();
const [showOverrideEditor, setShowOverrideEditor] = useState(false);
const [templateOverrides, setTemplateOverrides] = useState<Partial<CardTemplate> | null>(null);
```

Initialize from campaign data:
```typescript
useEffect(() => {
  if (campaign?.card_template_overrides) {
    setTemplateOverrides(campaign.card_template_overrides as Partial<CardTemplate>);
  }
}, [campaign]);
```

Add a new `Card` section in JSX for "Card Template":
- Collapsed: "Using system default template" or "N fields overridden" with "Customize" button
- Expanded: Simplified 4-tab editor pre-filled with merged values, "Overridden" badges on changed fields
- "Reset to System Default" and "Save Overrides" buttons
- Save uses existing `useUpdateCampaign` hook with `{ card_template_overrides: templateOverrides }`
- Reset sets `card_template_overrides` to `null`

- [ ] **Step 2: Verify override flow**

Run: `pnpm dev:admin`, go to a campaign detail. Override a field, save, verify it persists. Reset, verify it clears.

- [ ] **Step 3: Commit**

```bash
git add apps/admin-portal/src/pages/campaigns/CampaignDetail.tsx
git commit -m "feat(admin): add per-campaign card template override section"
```

---

### Task 13: Agent Portal -- System Settings Integration

**Files:**
- Create: `apps/agent-portal/src/hooks/useSystemSettings.ts`
- Modify: `apps/agent-portal/src/pages/MyLinks.tsx`
- Modify: `apps/agent-portal/src/pages/PartnerLinks.tsx`

- [ ] **Step 1: Create agent portal useSystemSettings hook**

Create `apps/agent-portal/src/hooks/useSystemSettings.ts`:

```typescript
import { useQuery } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import type { SystemSettings } from '@agent-system/shared-types';

export function useSystemSettings() {
  return useQuery({
    queryKey: ['system-settings'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('system_settings')
        .select('*')
        .single();
      if (error) throw error;
      return data as SystemSettings;
    },
    staleTime: 5 * 60 * 1000,
  });
}
```

- [ ] **Step 2: Update MyLinks.tsx**

In `apps/agent-portal/src/pages/MyLinks.tsx`:

Add imports:
```typescript
import { useSystemSettings } from '../hooks/useSystemSettings';
import { DEFAULT_CARD_TEMPLATE, DEFAULT_COMPANY_BRANDING } from '@agent-system/shared-types';
```

Add hook call inside component: `const { data: systemSettings } = useSystemSettings();`

Where `InvitationCard` is rendered, add branding props:
```tsx
companyName={systemSettings?.company_branding?.companyName}
logoUrl={systemSettings?.company_branding?.logoUrl}
```

Where `generateBulkInvitationCards` is called (in the PDF download handler), pass template and branding:
```typescript
const branding = systemSettings?.company_branding ?? DEFAULT_COMPANY_BRANDING;
const template = systemSettings?.card_template ?? DEFAULT_CARD_TEMPLATE;
// Note: Agent portal does not have access to campaign-level overrides in this context.
// Cards will use the system default template. This is acceptable because campaign overrides
// are an admin feature — agents always see the system default.
const doc = await generateBulkInvitationCards(invitationData, template, branding);
```

- [ ] **Step 3: Update PartnerLinks.tsx**

Apply the same changes as MyLinks.tsx in `apps/agent-portal/src/pages/PartnerLinks.tsx`:
- Import `useSystemSettings`, `DEFAULT_CARD_TEMPLATE`, `DEFAULT_COMPANY_BRANDING`
- Add `useSystemSettings()` hook call
- Pass `companyName` and `logoUrl` to `InvitationCard`
- Pass `template` and `branding` to `generateBulkInvitationCards`

- [ ] **Step 4: Verify agent portal works**

Run: `pnpm dev:agent`. Check InvitationCard shows branding, PDF download uses template.

- [ ] **Step 5: Commit**

```bash
git add apps/agent-portal/src/hooks/useSystemSettings.ts apps/agent-portal/src/pages/MyLinks.tsx apps/agent-portal/src/pages/PartnerLinks.tsx
git commit -m "feat(agent): integrate system branding into InvitationCard and PDF generation"
```

---

### Task 14: Final Verification

- [ ] **Step 1: Run full typecheck**

Run: `pnpm -r typecheck` -- fix any errors.

- [ ] **Step 2: Run lint**

Run: `pnpm lint` -- fix any errors.

- [ ] **Step 3: Manual end-to-end verification**

1. **Company Settings:** Upload logo, change name, save, refresh, verify persistence
2. **Card Template Editor:** Change colors/fonts/content, verify live preview, save, verify persistence
3. **PDF Export:** Generate cards, verify template + logo applied
4. **Campaign Override:** Override a field, generate PDF, verify override applied, reset, verify default restored
5. **Agent Portal MyLinks:** Verify branding on InvitationCard, verify PDF download uses template
6. **Agent Portal PartnerLinks:** Same as MyLinks

- [ ] **Step 4: Commit any fixes**

```bash
git add -A
git commit -m "fix: resolve integration issues from invitation card admin management feature"
```
