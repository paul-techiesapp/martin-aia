# Feature: T&C Acceptance During Registration

**Date:** 2026-03-11
**Status:** Approved
**Scope:** Frontend-only (public-pages app)

## Overview

Add a Terms & Conditions acceptance step to the public registration form. Users must read (scrollable box) and agree (checkbox) to T&C before submitting their registration.

## Requirements

- Static T&C content, same for all campaigns
- Scrollable inline box on the registration form (after all 5 existing form fields)
- Checkbox: "I have read and agree to the Terms & Conditions"
- Submit button disabled until checkbox is checked
- T&C content hardcoded in frontend code
- No database changes — pure UI gate, no audit trail

## Design

### UI Layout

The T&C section is placed after the 5 existing form fields (name, NRIC, phone, email, occupation) and before the Submit button, separated by a subtle divider.

```
┌─────────────────────────────┐
│  Event Registration Header  │
├─────────────────────────────┤
│  Full Name          [_____] │
│  NRIC               [_____] │
│  Phone              [_____] │
│  Email              [_____] │
│  Occupation         [_____] │
│─────────────────────────────│
│  Terms & Conditions         │
│  ┌───────────────────────┐  │
│  │ 1. Event Attendance   │  │
│  │ By registering...     │  │
│  │ 2. Personal Data...   ↕  │
│  │ 3. Photography...     │  │
│  └───────────────────────┘  │
│  ☑ I have read and agree    │
│     to the Terms &          │
│     Conditions              │
│                             │
│  [  Complete Registration ] │
└─────────────────────────────┘
```

### T&C Box Specifications

- **Component:** Use `ScrollArea` from shared-ui for the scrollable container
- **Height:** ~160px fixed (`max-h-[160px]`)
- **Styling:** Matches existing form field style (dark background, border, rounded corners)
- **Font size:** Slightly smaller than form fields (`text-xs` / `text-sm`) for readability of legal text
- **Content:** Placeholder sections covering attendance, personal data (PDPA), photography consent, and liability. Actual content to be provided separately.

### Checkbox Component

The shared-ui package does not currently export a Checkbox component. Add the shadcn/ui Checkbox component to shared-ui before implementing this feature.

### Form Validation

Uses existing react-hook-form + zod setup. Add a boolean `acceptedTerms` field with default value `false`:

```typescript
const schema = z.object({
  // ...existing fields
  acceptedTerms: z.boolean().refine((val) => val === true, {
    message: "You must accept the Terms & Conditions",
  }),
});

// In defaultValues:
acceptedTerms: false,
```

Submit button disabled via `!form.formState.isValid || isSubmitting`.

### T&C Content Storage

A new constants file holds the T&C content as a structured array of sections (title + body):

```
apps/public-pages/src/constants/terms.ts
```

This keeps the content separate from the component for easy future updates.

## Files Changed

| File | Change |
|------|--------|
| `packages/shared-ui/src/components/ui/checkbox.tsx` | New — add shadcn/ui Checkbox component |
| `packages/shared-ui/src/index.ts` | Export Checkbox component |
| `apps/public-pages/src/pages/Register.tsx` | Add T&C scrollable box, checkbox field, update zod schema |
| `apps/public-pages/src/constants/terms.ts` | New file — hardcoded T&C content |

## Out of Scope

- Per-campaign T&C content
- Admin portal T&C management
- Database tracking of T&C acceptance timestamp
- T&C versioning
