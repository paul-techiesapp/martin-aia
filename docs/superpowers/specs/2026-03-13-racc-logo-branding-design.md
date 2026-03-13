# RACC Agency Logo & Branding Integration

## Overview

Integrate the RACC Agency company logo across all three platforms (Admin Portal, Agent Portal, Public Pages) with a shared Logo component, replacing placeholder text/icon badges and fixing broken favicons.

## Source Asset

- **File:** `Gemini_Generated_Image_las6vnlas6vnlas6.png`
- **Description:** Gold/bronze stylized "R" with "RA" lettering on transparent background
- **Format:** PNG with transparency

## Approach: Shared Logo Component

Single reusable `<Logo />` component in `shared-ui` that all three apps import. Logo image stored once in `shared-ui`, bundled via Vite's asset pipeline (shared-ui is consumed as raw TypeScript source — no build step — so each app's Vite config resolves the PNG import at build time). Favicon copies placed in each app's `public/` folder.

## Asset Storage

The `packages/shared-ui/src/assets/` directory must be created (does not exist yet).

| File | Location | Purpose |
|------|----------|---------|
| `logo.png` | `packages/shared-ui/src/assets/` | Original full-resolution logo |
| `favicon.png` | Each app's `public/` folder | 32x32 browser favicon |

The transparent background works on both dark sidebars (navy `#0F172A`) and light public page cards.

## Logo Component

**Location:** `packages/shared-ui/src/components/logo.tsx`

**Props:**

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `size` | `"sm" \| "md" \| "lg"` | `"md"` | Controls image and text size |
| `showText` | `boolean` | `true` | Show "RACC Agency" text beside logo |
| `className` | `string` | `undefined` | Additional CSS classes for positioning/spacing |

**Size mappings:**

| Size | Image | Text | Use Case |
|------|-------|------|----------|
| `sm` | 32px | text-sm | Sidebar header (collapsed) |
| `md` | 36px | text-base | Sidebar header (expanded) |
| `lg` | 56px | text-xl | Public pages hero |

The logo `<img>` element must include `alt="RACC Agency"` for accessibility.

Exported from `shared-ui` index:
```typescript
import { Logo } from '@agent-system/shared-ui';
```

## Integration Points

### Admin Portal

**`Layout.tsx` — Desktop sidebar:**
- **Current:** Blue badge with letter "A" + "Admin Portal" text.
- **New:** `<Logo size="md" />` + "RACC Admin" text.

**`Layout.tsx` — Mobile sidebar:**
- The branding block is duplicated in the mobile Sheet sidebar. Both instances must be updated to use `<Logo />`.

**`Layout.tsx` — Mobile header:**
- The mobile top bar displays "Admin Portal" as plain text. Update to "RACC Admin".

**`Login.tsx`:**
- **Current:** Gradient badge with Shield icon + "Admin Portal" heading.
- **New:** `<Logo size="lg" />` replaces the Shield icon badge. Heading updated to "RACC Admin Portal".

### Agent Portal

**`Layout.tsx` — Sidebar:**
- **Current:** Blue badge with Users icon + "Unit Portal" / "Partner Portal" text (conditional on role).
- **New:** `<Logo size="md" />` + role-based text preserved ("RACC Unit Portal" or "RACC Partner Portal"). The existing `role` conditional logic must be kept — just prefix "RACC " to each variant.

**`Login.tsx`:**
- **Current:** Colored square with letter "A" + "Unit Portal" heading.
- **New:** `<Logo size="lg" />` replaces the letter badge. Heading updated to "RACC Portal".

### Public Pages (Register, CheckIn, CheckOut)

**Current:** Per-page gradient icon badges (LogIn, UserPlus, etc.).

**New:** `<Logo size="lg" />` replaces the icon badge at the top of each card. Page-specific icons remain below the logo for context so users know which flow they're in.

**Note:** `Display.tsx` is excluded — it is a full-screen dark QR display page with no card or icon badge pattern. No logo integration needed there.

### Favicons & HTML Titles

All three `index.html` files updated. The `<link>` tag changes from `type="image/svg+xml" href="/vite.svg"` to `type="image/png" href="/favicon.png"`.

| App | Favicon | New Title |
|-----|---------|-----------|
| Admin Portal | `favicon.png` | `RACC Admin Portal` |
| Agent Portal | `favicon.png` | `RACC Portal` |
| Public Pages | `favicon.png` | `RACC Agency` |

## Files Changed

| File | Action |
|------|--------|
| `packages/shared-ui/src/assets/logo.png` | Add original logo (new directory) |
| `packages/shared-ui/src/components/logo.tsx` | New shared Logo component |
| `packages/shared-ui/src/index.ts` | Export Logo component |
| `apps/admin-portal/public/favicon.png` | Add favicon |
| `apps/admin-portal/src/components/Layout.tsx` | Replace branding in desktop sidebar, mobile sidebar, and mobile header |
| `apps/admin-portal/src/pages/Login.tsx` | Replace Shield icon badge with `<Logo />` |
| `apps/admin-portal/index.html` | Update favicon ref + title |
| `apps/agent-portal/public/favicon.png` | Add favicon |
| `apps/agent-portal/src/components/Layout.tsx` | Replace Users icon with `<Logo />`, keep role conditional |
| `apps/agent-portal/src/pages/Login.tsx` | Replace letter badge with `<Logo />` |
| `apps/agent-portal/index.html` | Update favicon ref + title |
| `apps/public-pages/public/favicon.png` | Add favicon |
| `apps/public-pages/src/pages/Register.tsx` | Replace icon badge with `<Logo size="lg" />` |
| `apps/public-pages/src/pages/CheckIn.tsx` | Replace icon badge with `<Logo size="lg" />` |
| `apps/public-pages/src/pages/CheckOut.tsx` | Replace icon badge with `<Logo size="lg" />` |
| `apps/public-pages/index.html` | Update favicon ref + title |

## Non-Goals

- No changes to navigation structure, routing, or functionality
- No color scheme changes (existing navy + sky palette complements the gold logo)
- No new dependencies required
- No changes to `Display.tsx` (full-screen QR page, different layout pattern)
