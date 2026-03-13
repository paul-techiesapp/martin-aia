# RACC Agency Logo & Branding Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Integrate the RACC Agency logo across all three apps (Admin Portal, Agent Portal, Public Pages) with a shared Logo component, favicons, and updated titles.

**Architecture:** Single `<Logo />` component in `shared-ui` imported by all apps. Logo PNG stored once in `shared-ui/src/assets/`, favicon PNGs in each app's `public/` folder. No new dependencies.

**Tech Stack:** React, TypeScript, Vite (asset pipeline), Tailwind CSS

**Spec:** `docs/superpowers/specs/2026-03-13-racc-logo-branding-design.md`

---

## Chunk 1: Assets & Shared Logo Component

### Task 1: Copy logo assets into the codebase

**Files:**
- Create: `packages/shared-ui/src/assets/logo.png`
- Create: `apps/admin-portal/public/favicon.png`
- Create: `apps/agent-portal/public/favicon.png`
- Create: `apps/public-pages/public/favicon.png`

- [ ] **Step 1: Create assets directory and copy logo**

```bash
mkdir -p packages/shared-ui/src/assets
cp /Users/paullee/Downloads/Gemini_Generated_Image_las6vnlas6vnlas6.png packages/shared-ui/src/assets/logo.png
```

- [ ] **Step 2: Optimize logo for web (source is 1.4 MB, too large for a 56px logo)**

```bash
sips -z 200 200 packages/shared-ui/src/assets/logo.png --out packages/shared-ui/src/assets/logo-optimized.png
mv packages/shared-ui/src/assets/logo-optimized.png packages/shared-ui/src/assets/logo.png
```

This resizes the logo to 200x200 which is more than enough for the largest display size (56px) while supporting 2x/3x retina displays.

- [ ] **Step 3: Create 32x32 favicon from the optimized logo using sips (macOS built-in)**

```bash
sips -z 32 32 packages/shared-ui/src/assets/logo.png --out apps/admin-portal/public/favicon.png
cp apps/admin-portal/public/favicon.png apps/agent-portal/public/favicon.png
cp apps/admin-portal/public/favicon.png apps/public-pages/public/favicon.png
```

- [ ] **Step 4: Verify files exist**

```bash
ls -la packages/shared-ui/src/assets/logo.png
ls -la apps/admin-portal/public/favicon.png
ls -la apps/agent-portal/public/favicon.png
ls -la apps/public-pages/public/favicon.png
```

Expected: All four files exist with non-zero sizes.

- [ ] **Step 5: Commit**

```bash
git add packages/shared-ui/src/assets/logo.png apps/admin-portal/public/favicon.png apps/agent-portal/public/favicon.png apps/public-pages/public/favicon.png
git commit -m "feat: add RACC Agency logo and favicon assets"
```

---

### Task 2: Create shared Logo component

**Files:**
- Create: `packages/shared-ui/src/components/logo.tsx`
- Modify: `packages/shared-ui/src/index.ts`

- [ ] **Step 1: Create the Logo component**

Create `packages/shared-ui/src/components/logo.tsx`:

```tsx
import logoSrc from '../assets/logo.png';
import { cn } from '../lib/utils';

const sizeMap = {
  sm: { image: 32, text: 'text-sm' },
  md: { image: 36, text: 'text-base' },
  lg: { image: 56, text: 'text-xl' },
} as const;

interface LogoProps {
  size?: 'sm' | 'md' | 'lg';
  showText?: boolean;
  className?: string;
}

export function Logo({ size = 'md', showText = true, className }: LogoProps) {
  const { image, text } = sizeMap[size];

  return (
    <div className={cn('flex items-center gap-2', className)}>
      <img
        src={logoSrc}
        alt="RACC Agency"
        width={image}
        height={image}
        className="object-contain"
      />
      {showText && (
        <span className={cn('font-semibold', text)}>RACC Agency</span>
      )}
    </div>
  );
}
```

**Key details:**
- `logoSrc` is imported as a module — Vite resolves the PNG to a URL (base64-inlined for small files, or hashed filename for larger ones). This works because shared-ui is consumed as raw TypeScript source by each app's Vite build.
- `cn()` is the existing Tailwind merge utility from shared-ui.
- `className` prop follows the same pattern as all other shared-ui components (Button, Card, etc.).

- [ ] **Step 2: Export Logo from shared-ui index**

In `packages/shared-ui/src/index.ts`, add after the last component export (after the `DropdownMenu` block, before `AppSidebar`):

```typescript
export { Logo } from './components/logo';
export type { LogoProps } from './components/logo';
```

Wait — `LogoProps` is not exported from the component file. Update the component to export the interface:

In `packages/shared-ui/src/components/logo.tsx`, change:
```typescript
interface LogoProps {
```
to:
```typescript
export interface LogoProps {
```

Then in `packages/shared-ui/src/index.ts`, add this line after the DropdownMenu exports block (line 109) and before the AppSidebar exports (line 110):

```typescript
export { Logo } from './components/logo';
export type { LogoProps } from './components/logo';
```

- [ ] **Step 3: Verify the build compiles**

```bash
pnpm -r typecheck
```

Expected: No TypeScript errors. If there's a missing type declaration for `.png` imports, create `packages/shared-ui/src/assets.d.ts`:

```typescript
declare module '*.png' {
  const src: string;
  export default src;
}
```

- [ ] **Step 4: Commit**

```bash
git add packages/shared-ui/src/components/logo.tsx packages/shared-ui/src/index.ts
# Also add assets.d.ts if it was created:
# git add packages/shared-ui/src/assets.d.ts
git commit -m "feat: add shared Logo component to shared-ui"
```

---

## Chunk 2: Admin Portal Integration

### Task 3: Update Admin Portal Layout

**Files:**
- Modify: `apps/admin-portal/src/components/Layout.tsx:1-5,51-56,100-106,174-176`

- [ ] **Step 1: Add Logo import**

In `apps/admin-portal/src/components/Layout.tsx`, add `Logo` to the shared-ui import on line 3:

```typescript
import { Button, cn, Logo } from '@agent-system/shared-ui';
```

- [ ] **Step 2: Replace desktop sidebar branding block**

Replace lines 51-56 (the desktop sidebar branding):

Current:
```tsx
        <div className="flex h-16 items-center gap-3 px-6 border-b border-slate-800">
          <div className="h-9 w-9 rounded-xl bg-sky-600 flex items-center justify-center">
            <span className="text-white font-bold text-lg">A</span>
          </div>
          <span className="font-semibold text-lg">Admin Portal</span>
        </div>
```

New:
```tsx
        <div className="flex h-16 items-center gap-3 px-6 border-b border-slate-800">
          <Logo size="md" showText={false} />
          <span className="font-semibold text-lg">RACC Admin</span>
        </div>
```

- [ ] **Step 3: Replace mobile sidebar branding block**

Replace lines 100-106 (the mobile sidebar branding, inside the `justify-between` div):

Current:
```tsx
          <div className="flex items-center gap-3">
            <div className="h-9 w-9 rounded-xl bg-sky-600 flex items-center justify-center">
              <span className="text-white font-bold text-lg">A</span>
            </div>
            <span className="font-semibold text-lg">Admin Portal</span>
          </div>
```

New:
```tsx
          <div className="flex items-center gap-3">
            <Logo size="md" showText={false} />
            <span className="font-semibold text-lg">RACC Admin</span>
          </div>
```

- [ ] **Step 4: Replace mobile header text**

Replace line 175:

Current:
```tsx
            <span className="font-semibold text-slate-900">Admin Portal</span>
```

New:
```tsx
            <span className="font-semibold text-slate-900">RACC Admin</span>
```

- [ ] **Step 5: Remove unused Shield import if present**

Check if `Shield` is imported from lucide-react in this file. It is NOT used in Layout.tsx (only in Login.tsx), so no change needed here.

- [ ] **Step 6: Verify build**

```bash
pnpm -r typecheck
```

Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add apps/admin-portal/src/components/Layout.tsx
git commit -m "feat(admin): replace sidebar branding with RACC Agency logo"
```

---

### Task 4: Update Admin Portal Login

**Files:**
- Modify: `apps/admin-portal/src/pages/Login.tsx:6-21,74-77`

- [ ] **Step 1: Add Logo import and remove Shield**

In `apps/admin-portal/src/pages/Login.tsx`, add `Logo` to the shared-ui import block (lines 6-20):

```typescript
import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Input,
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
  Logo,
} from '@agent-system/shared-ui';
```

Remove the Shield import on line 21:
```typescript
// DELETE: import { Shield } from 'lucide-react';
```

- [ ] **Step 2: Replace the icon badge and title**

Replace lines 74-77:

Current:
```tsx
          <div className="h-14 w-14 rounded-2xl bg-gradient-to-br from-sky-500 to-sky-700 flex items-center justify-center mx-auto mb-4 shadow-lg">
            <Shield className="h-7 w-7 text-white" />
          </div>
          <CardTitle className="text-2xl font-bold text-slate-900">Admin Portal</CardTitle>
```

New:
```tsx
          <Logo size="lg" showText={false} className="mx-auto mb-4" />
          <CardTitle className="text-2xl font-bold text-slate-900">RACC Admin Portal</CardTitle>
```

- [ ] **Step 3: Verify build**

```bash
pnpm -r typecheck
```

Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add apps/admin-portal/src/pages/Login.tsx
git commit -m "feat(admin): replace login page branding with RACC Agency logo"
```

---

### Task 5: Update Admin Portal HTML

**Files:**
- Modify: `apps/admin-portal/index.html:5,7`

- [ ] **Step 1: Update favicon and title**

In `apps/admin-portal/index.html`:

Replace line 5:
```html
    <link rel="icon" type="image/svg+xml" href="/vite.svg" />
```
With:
```html
    <link rel="icon" type="image/png" href="/favicon.png" />
```

Replace line 7:
```html
    <title>Admin Portal - Unit Onboarding System</title>
```
With:
```html
    <title>RACC Admin Portal</title>
```

- [ ] **Step 2: Commit**

```bash
git add apps/admin-portal/index.html
git commit -m "feat(admin): update favicon and page title to RACC branding"
```

---

## Chunk 3: Agent Portal Integration

### Task 6: Update Agent Portal Layout

**Files:**
- Modify: `apps/agent-portal/src/components/Layout.tsx:3-4,32-41`

- [ ] **Step 1: Add Logo import**

In `apps/agent-portal/src/components/Layout.tsx`, add `Logo` to the shared-ui import (line 3):

```typescript
import { cn, Button, Sheet, SheetContent, SheetTrigger, Logo } from '@agent-system/shared-ui';
```

- [ ] **Step 2: Replace SidebarContent branding block**

The agent portal uses a `SidebarContent` inner component (line 32) that renders once but is used by both desktop and mobile sidebars. Replace lines 34-41:

Current:
```tsx
      <div className="flex h-16 items-center gap-3 px-6 border-b border-white/10">
        <div className="h-9 w-9 rounded-xl bg-sky-600 flex items-center justify-center shadow-lg">
          <Users className="h-5 w-5 text-white" />
        </div>
        <span className="font-semibold text-lg text-white">
          {role === 'partner' ? 'Partner Portal' : 'Unit Portal'}
        </span>
      </div>
```

New:
```tsx
      <div className="flex h-16 items-center gap-3 px-6 border-b border-white/10">
        <Logo size="md" showText={false} />
        <span className="font-semibold text-lg text-white">
          {role === 'partner' ? 'RACC Partner Portal' : 'RACC Unit Portal'}
        </span>
      </div>
```

**Important:** The `role` conditional is preserved — only prefixing "RACC " to each variant.

- [ ] **Step 3: Check if Users icon is still used elsewhere**

The `Users` icon from lucide-react (line 4) is used in:
- The old sidebar branding block (being replaced)
- The `agentNavigation` array (line 12, Partners nav item)

Since `Users` is still used in navigation, keep the import.

- [ ] **Step 4: Verify build**

```bash
pnpm -r typecheck
```

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/agent-portal/src/components/Layout.tsx
git commit -m "feat(agent): replace sidebar branding with RACC Agency logo"
```

---

### Task 7: Update Agent Portal Login

**Files:**
- Modify: `apps/agent-portal/src/pages/Login.tsx:3-12,42-45`

- [ ] **Step 1: Add Logo import**

In `apps/agent-portal/src/pages/Login.tsx`, add `Logo` to the shared-ui import block (lines 3-12):

```typescript
import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Input,
  Label,
  Logo,
} from '@agent-system/shared-ui';
```

- [ ] **Step 2: Replace the icon badge and title**

Replace lines 42-45:

Current:
```tsx
          <div className="mx-auto h-12 w-12 rounded-lg bg-primary flex items-center justify-center mb-4">
            <span className="text-primary-foreground font-bold text-xl">A</span>
          </div>
          <CardTitle className="text-2xl">Unit Portal</CardTitle>
```

New:
```tsx
          <Logo size="lg" showText={false} className="mx-auto mb-4" />
          <CardTitle className="text-2xl">RACC Portal</CardTitle>
```

- [ ] **Step 3: Verify build**

```bash
pnpm -r typecheck
```

Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add apps/agent-portal/src/pages/Login.tsx
git commit -m "feat(agent): replace login page branding with RACC Agency logo"
```

---

### Task 8: Update Agent Portal HTML

**Files:**
- Modify: `apps/agent-portal/index.html:5,7`

- [ ] **Step 1: Update favicon and title**

In `apps/agent-portal/index.html`:

Replace line 5:
```html
    <link rel="icon" type="image/svg+xml" href="/vite.svg" />
```
With:
```html
    <link rel="icon" type="image/png" href="/favicon.png" />
```

Replace line 7:
```html
    <title>Unit Portal - Unit Onboarding System</title>
```
With:
```html
    <title>RACC Portal</title>
```

- [ ] **Step 2: Commit**

```bash
git add apps/agent-portal/index.html
git commit -m "feat(agent): update favicon and page title to RACC branding"
```

---

## Chunk 4: Public Pages Integration

### Task 9: Update Register page

**Files:**
- Modify: `apps/public-pages/src/pages/Register.tsx:250-252`

- [ ] **Step 1: Add Logo import**

Add to the shared-ui import block at the top of the file:

```typescript
import { ..., Logo } from '@agent-system/shared-ui';
```

- [ ] **Step 2: Replace the icon badge**

Replace lines 250-252:

Current:
```tsx
          <div className="h-14 w-14 rounded-2xl bg-gradient-to-br from-sky-500 to-sky-700 flex items-center justify-center mx-auto mb-4 shadow-lg">
            <UserPlus className="h-7 w-7 text-white" />
          </div>
```

New:
```tsx
          <Logo size="lg" showText={false} className="mx-auto mb-4" />
```

- [ ] **Step 3: Remove unused UserPlus import**

`UserPlus` is only used at line 251 (being replaced). Remove it from the lucide-react import on line 25. Keep the other icons (`Calendar`, `MapPin`, `Clock`, `CheckCircle`) as they are still used.

- [ ] **Step 4: Commit**

```bash
git add apps/public-pages/src/pages/Register.tsx
git commit -m "feat(public): replace Register page icon with RACC Agency logo"
```

---

### Task 10: Update CheckIn page

**Files:**
- Modify: `apps/public-pages/src/pages/CheckIn.tsx:223-225`

- [ ] **Step 1: Add Logo import**

Add to the shared-ui import block at the top of the file:

```typescript
import { ..., Logo } from '@agent-system/shared-ui';
```

- [ ] **Step 2: Replace the icon badge**

Replace lines 223-225:

Current:
```tsx
          <div className="h-14 w-14 rounded-2xl bg-gradient-to-br from-sky-500 to-sky-700 flex items-center justify-center mx-auto mb-4 shadow-lg">
            <LogIn className="h-7 w-7 text-white" />
          </div>
```

New:
```tsx
          <Logo size="lg" showText={false} className="mx-auto mb-4" />
```

- [ ] **Step 3: Remove unused LogIn import**

`LogIn` is only used at line 224 (being replaced). Remove it from the lucide-react import. Keep `CheckCircle` as it is still used.

- [ ] **Step 4: Commit**

```bash
git add apps/public-pages/src/pages/CheckIn.tsx
git commit -m "feat(public): replace CheckIn page icon with RACC Agency logo"
```

---

### Task 11: Update CheckOut page

**Files:**
- Modify: `apps/public-pages/src/pages/CheckOut.tsx:301-303`

- [ ] **Step 1: Add Logo import**

Add to the shared-ui import block at the top of the file:

```typescript
import { ..., Logo } from '@agent-system/shared-ui';
```

- [ ] **Step 2: Replace the icon badge**

Replace lines 301-303:

Current:
```tsx
          <div className="h-14 w-14 rounded-2xl bg-gradient-to-br from-violet-500 to-violet-700 flex items-center justify-center mx-auto mb-4 shadow-lg">
            <LogOut className="h-7 w-7 text-white" />
          </div>
```

New:
```tsx
          <Logo size="lg" showText={false} className="mx-auto mb-4" />
```

- [ ] **Step 3: Remove unused LogOut import**

`LogOut` is only used at line 302 (being replaced). Remove it from the lucide-react import. Keep `CheckCircle`, `MessageSquare`, `ArrowRight` as they are still used.

- [ ] **Step 4: Commit**

```bash
git add apps/public-pages/src/pages/CheckOut.tsx
git commit -m "feat(public): replace CheckOut page icon with RACC Agency logo"
```

---

### Task 12: Update Public Pages HTML

**Files:**
- Modify: `apps/public-pages/index.html:5,7`

- [ ] **Step 1: Update favicon and title**

In `apps/public-pages/index.html`:

Replace line 5:
```html
    <link rel="icon" type="image/svg+xml" href="/vite.svg" />
```
With:
```html
    <link rel="icon" type="image/png" href="/favicon.png" />
```

Replace line 7:
```html
    <title>Unit Onboarding System</title>
```
With:
```html
    <title>RACC Agency</title>
```

- [ ] **Step 2: Commit**

```bash
git add apps/public-pages/index.html
git commit -m "feat(public): update favicon and page title to RACC branding"
```

---

## Chunk 5: Final Verification

### Task 13: Full build verification and visual check

- [ ] **Step 1: Run typecheck across all packages**

```bash
pnpm -r typecheck
```

Expected: PASS with no errors.

- [ ] **Step 2: Run lint across all packages**

```bash
pnpm lint
```

Expected: PASS (or only pre-existing warnings unrelated to this change).

- [ ] **Step 3: Verify dev servers load correctly**

Tell the user to check these manually:
- `pnpm dev:admin` → http://localhost:3000 — verify logo in sidebar and login page
- `pnpm dev:agent` → http://localhost:3001 — verify logo in sidebar and login page
- `pnpm dev:public` → http://localhost:3002 — verify logo on Register/CheckIn/CheckOut pages
- Check browser tabs for favicon in all three apps

- [ ] **Step 4: Final commit if any cleanup was needed**

If any unused imports were cleaned up or minor fixes were needed during verification:

```bash
git add -A
git commit -m "chore: clean up unused imports after logo branding integration"
```
