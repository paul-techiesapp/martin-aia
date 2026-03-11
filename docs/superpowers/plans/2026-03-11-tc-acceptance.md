# T&C Acceptance During Registration — Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a Terms & Conditions scrollable box + checkbox to the public registration form that must be accepted before submission.

**Architecture:** Frontend-only change. Add shadcn Checkbox to shared-ui, create a T&C constants file, then integrate into Register.tsx using the existing react-hook-form + zod pattern.

**Tech Stack:** React 18, shadcn/ui (Radix Checkbox), react-hook-form, zod, Tailwind CSS

**Spec:** `docs/superpowers/specs/2026-03-11-tc-acceptance-design.md`

---

## Chunk 1: Implementation

### Task 1: Add Checkbox component to shared-ui

**Files:**
- Create: `packages/shared-ui/src/components/ui/checkbox.tsx`
- Modify: `packages/shared-ui/src/index.ts`

- [ ] **Step 1: Install Radix Checkbox dependency**

```bash
cd /Users/paullee/Documents/project/martin/DATA
pnpm --filter @agent-system/shared-ui add @radix-ui/react-checkbox
```

- [ ] **Step 2: Create the Checkbox component**

Create `packages/shared-ui/src/components/ui/checkbox.tsx`:

```tsx
import * as React from "react"
import * as CheckboxPrimitive from "@radix-ui/react-checkbox"
import { Check } from "lucide-react"

import { cn } from "../../lib/utils"

const Checkbox = React.forwardRef<
  React.ComponentRef<typeof CheckboxPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof CheckboxPrimitive.Root>
>(({ className, ...props }, ref) => (
  <CheckboxPrimitive.Root
    ref={ref}
    className={cn(
      "peer h-4 w-4 shrink-0 rounded-sm border border-primary ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 data-[state=checked]:bg-primary data-[state=checked]:text-primary-foreground",
      className
    )}
    {...props}
  >
    <CheckboxPrimitive.Indicator
      className={cn("flex items-center justify-center text-current")}
    >
      <Check className="h-4 w-4" />
    </CheckboxPrimitive.Indicator>
  </CheckboxPrimitive.Root>
))
Checkbox.displayName = CheckboxPrimitive.Root.displayName

export { Checkbox }
```

- [ ] **Step 3: Export Checkbox from shared-ui index**

Add to `packages/shared-ui/src/index.ts` after the existing ScrollArea export (line 84):

```typescript
export { Checkbox } from './components/ui/checkbox';
```

- [ ] **Step 4: Verify shared-ui builds**

```bash
cd /Users/paullee/Documents/project/martin/DATA
pnpm --filter @agent-system/shared-ui build
```

Expected: Build succeeds with no errors.

- [ ] **Step 5: Commit**

```bash
git add packages/shared-ui/src/components/ui/checkbox.tsx packages/shared-ui/src/index.ts packages/shared-ui/package.json pnpm-lock.yaml
git commit -m "feat(shared-ui): add Checkbox component from shadcn/ui"
```

---

### Task 2: Create T&C constants file

**Files:**
- Create: `apps/public-pages/src/constants/terms.ts`

- [ ] **Step 1: Create the constants directory and terms file**

Create `apps/public-pages/src/constants/terms.ts`:

```typescript
export interface TermsSection {
  title: string;
  body: string;
}

export const TERMS_AND_CONDITIONS: TermsSection[] = [
  {
    title: "1. Event Attendance",
    body: "By registering for this event, you agree to attend at the scheduled date and time. If you are unable to attend, please inform your inviting agent as soon as possible.",
  },
  {
    title: "2. Personal Data Collection",
    body: "Your personal information (name, NRIC, phone number, email address, and occupation) will be collected for event management and verification purposes. This data will be handled in accordance with the Personal Data Protection Act (PDPA) of Singapore.",
  },
  {
    title: "3. Photography & Recording",
    body: "Photographs and videos may be taken during the event for promotional and documentation purposes. By attending, you consent to the use of your likeness in marketing materials.",
  },
  {
    title: "4. Liability",
    body: "The organizer shall not be held liable for any personal injury, loss, or damage to property during the event. Attendees are responsible for their own personal belongings.",
  },
  {
    title: "5. Code of Conduct",
    body: "All attendees are expected to conduct themselves in a professional and respectful manner. The organizer reserves the right to remove any attendee who behaves inappropriately.",
  },
];
```

- [ ] **Step 2: Commit**

```bash
git add apps/public-pages/src/constants/terms.ts
git commit -m "feat(public-pages): add T&C constants for registration form"
```

---

### Task 3: Integrate T&C into Registration form

**Files:**
- Modify: `apps/public-pages/src/pages/Register.tsx`

- [ ] **Step 1: Update imports**

Add to the existing imports in `Register.tsx`:

```typescript
// Add Checkbox and ScrollArea to the shared-ui import block (line 6-22):
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
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
  Skeleton,
  ScrollArea,
  Checkbox,
} from '@agent-system/shared-ui';

// Add after the existing imports (around line 25):
import { TERMS_AND_CONDITIONS } from '../constants/terms';
```

- [ ] **Step 2: Update the zod schema**

Replace the schema definition (lines 29-35) with:

```typescript
const registrationSchema = z.object({
  invitee_name: z.string().min(2, 'Name must be at least 2 characters'),
  invitee_nric: z.string().min(9, 'NRIC must be at least 9 characters'),
  invitee_phone: z.string().min(8, 'Phone number must be at least 8 characters'),
  invitee_email: z.string().email('Invalid email address'),
  invitee_occupation: z.string().min(2, 'Occupation is required'),
  acceptedTerms: z.boolean().refine((val) => val === true, {
    message: 'You must accept the Terms & Conditions',
  }),
});
```

- [ ] **Step 3: Update defaultValues**

Add `mode: 'onChange'` and `acceptedTerms: false` to useForm (line 62-70). The `mode: 'onChange'` is required so that `form.formState.isValid` updates in real time as the user checks the checkbox (the default `mode: 'onSubmit'` only recalculates validity after a submit attempt):

```typescript
const form = useForm<RegistrationFormData>({
  resolver: zodResolver(registrationSchema),
  mode: 'onChange',
  defaultValues: {
    invitee_name: '',
    invitee_nric: '',
    invitee_phone: '',
    invitee_email: '',
    invitee_occupation: '',
    acceptedTerms: false,
  },
});
```

- [ ] **Step 4: Update onSubmit to exclude acceptedTerms**

The `onSubmit` function spreads `formData` into the Supabase update (line 155). We need to exclude `acceptedTerms` since it's not a database column. Update the update call (lines 153-160):

```typescript
const { acceptedTerms, ...registrationData } = formData;

const { error: updateError } = await supabase
  .from('invitations')
  .update({
    ...registrationData,
    status: InvitationStatus.REGISTERED,
    registered_at: new Date().toISOString(),
  })
  .eq('id', invitation.id);
```

- [ ] **Step 5: Add T&C section before the submit button**

Insert after the occupation FormField (after line 352) and before the Button (line 354):

```tsx
{/* Terms & Conditions */}
<div className="border-t border-slate-200 pt-4 mt-2">
  <FormLabel className="text-slate-700">Terms & Conditions</FormLabel>
  <ScrollArea className="h-[160px] mt-2 rounded-lg border border-slate-200 bg-slate-50 p-4">
    <div className="space-y-3 text-xs text-slate-600 leading-relaxed pr-4">
      {TERMS_AND_CONDITIONS.map((section, index) => (
        <div key={index}>
          <p className="font-semibold text-slate-700">{section.title}</p>
          <p>{section.body}</p>
        </div>
      ))}
    </div>
  </ScrollArea>

  <FormField
    control={form.control}
    name="acceptedTerms"
    render={({ field }) => (
      <FormItem className="flex flex-row items-start space-x-3 space-y-0 mt-3">
        <FormControl>
          <Checkbox
            checked={field.value}
            onCheckedChange={field.onChange}
          />
        </FormControl>
        <div className="space-y-1 leading-none">
          <FormLabel className="text-sm text-slate-700 font-normal cursor-pointer">
            I have read and agree to the Terms & Conditions
          </FormLabel>
          <FormMessage />
        </div>
      </FormItem>
    )}
  />
</div>
```

- [ ] **Step 6: Update submit button disabled condition**

Replace the Button (line 354-360):

```tsx
<Button
  type="submit"
  className="w-full h-11 bg-slate-900 hover:bg-slate-800 text-white font-medium mt-2"
  disabled={isSubmitting || !form.formState.isValid}
>
  {isSubmitting ? 'Registering...' : 'Complete Registration'}
</Button>
```

- [ ] **Step 7: Verify the build**

```bash
cd /Users/paullee/Documents/project/martin/DATA
pnpm --filter public-pages build
```

Expected: Build succeeds with no errors.

- [ ] **Step 8: Manual test**

```bash
pnpm dev:public
```

1. Navigate to a valid registration link (e.g., `http://localhost:3002/public/register/{token}`)
2. Verify T&C scrollable box appears after the 5 form fields
3. Verify checkbox is unchecked by default
4. Fill all fields, leave checkbox unchecked → Submit button should be disabled
5. Check the checkbox → Submit button enables
6. Submit → registration completes successfully

- [ ] **Step 9: Commit**

```bash
git add apps/public-pages/src/pages/Register.tsx
git commit -m "feat(public-pages): add T&C acceptance to registration form"
```
