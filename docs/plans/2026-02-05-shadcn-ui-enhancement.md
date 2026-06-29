# ShadCN/UI Enhancement Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Systematically enhance all pages across the three apps (admin-portal, agent-portal, public-pages) with proper shadcn/ui components, replacing native browser dialogs and improving UX consistency.

**Architecture:** Install missing shadcn components (AlertDialog, Tooltip, DropdownMenu, Separator, ScrollArea, Tabs, Progress, Breadcrumb) into shared-ui package, then refactor each page to use these components following established patterns.

**Tech Stack:** React, shadcn/ui, Radix UI primitives, Tailwind CSS, Lucide React icons

---

## Phase 1: Install Missing ShadCN Components

### Task 1: Install AlertDialog Component

**Files:**
- Create: `packages/shared-ui/src/components/ui/alert-dialog.tsx`
- Modify: `packages/shared-ui/src/index.ts`

**Step 1: Create AlertDialog component**

```tsx
// packages/shared-ui/src/components/ui/alert-dialog.tsx
import * as React from "react"
import * as AlertDialogPrimitive from "@radix-ui/react-alert-dialog"

import { cn } from "../../lib/utils"
import { buttonVariants } from "./button"

const AlertDialog = AlertDialogPrimitive.Root

const AlertDialogTrigger = AlertDialogPrimitive.Trigger

const AlertDialogPortal = AlertDialogPrimitive.Portal

const AlertDialogOverlay = React.forwardRef<
  React.ElementRef<typeof AlertDialogPrimitive.Overlay>,
  React.ComponentPropsWithoutRef<typeof AlertDialogPrimitive.Overlay>
>(({ className, ...props }, ref) => (
  <AlertDialogPrimitive.Overlay
    className={cn(
      "fixed inset-0 z-50 bg-black/80 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0",
      className
    )}
    {...props}
    ref={ref}
  />
))
AlertDialogOverlay.displayName = AlertDialogPrimitive.Overlay.displayName

const AlertDialogContent = React.forwardRef<
  React.ElementRef<typeof AlertDialogPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof AlertDialogPrimitive.Content>
>(({ className, ...props }, ref) => (
  <AlertDialogPortal>
    <AlertDialogOverlay />
    <AlertDialogPrimitive.Content
      ref={ref}
      className={cn(
        "fixed left-[50%] top-[50%] z-50 grid w-full max-w-lg translate-x-[-50%] translate-y-[-50%] gap-4 border bg-background p-6 shadow-lg duration-200 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[state=closed]:slide-out-to-left-1/2 data-[state=closed]:slide-out-to-top-[48%] data-[state=open]:slide-in-from-left-1/2 data-[state=open]:slide-in-from-top-[48%] sm:rounded-lg",
        className
      )}
      {...props}
    />
  </AlertDialogPortal>
))
AlertDialogContent.displayName = AlertDialogPrimitive.Content.displayName

const AlertDialogHeader = ({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) => (
  <div
    className={cn(
      "flex flex-col space-y-2 text-center sm:text-left",
      className
    )}
    {...props}
  />
)
AlertDialogHeader.displayName = "AlertDialogHeader"

const AlertDialogFooter = ({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) => (
  <div
    className={cn(
      "flex flex-col-reverse sm:flex-row sm:justify-end sm:space-x-2",
      className
    )}
    {...props}
  />
)
AlertDialogFooter.displayName = "AlertDialogFooter"

const AlertDialogTitle = React.forwardRef<
  React.ElementRef<typeof AlertDialogPrimitive.Title>,
  React.ComponentPropsWithoutRef<typeof AlertDialogPrimitive.Title>
>(({ className, ...props }, ref) => (
  <AlertDialogPrimitive.Title
    ref={ref}
    className={cn("text-lg font-semibold", className)}
    {...props}
  />
))
AlertDialogTitle.displayName = AlertDialogPrimitive.Title.displayName

const AlertDialogDescription = React.forwardRef<
  React.ElementRef<typeof AlertDialogPrimitive.Description>,
  React.ComponentPropsWithoutRef<typeof AlertDialogPrimitive.Description>
>(({ className, ...props }, ref) => (
  <AlertDialogPrimitive.Description
    ref={ref}
    className={cn("text-sm text-muted-foreground", className)}
    {...props}
  />
))
AlertDialogDescription.displayName =
  AlertDialogPrimitive.Description.displayName

const AlertDialogAction = React.forwardRef<
  React.ElementRef<typeof AlertDialogPrimitive.Action>,
  React.ComponentPropsWithoutRef<typeof AlertDialogPrimitive.Action>
>(({ className, ...props }, ref) => (
  <AlertDialogPrimitive.Action
    ref={ref}
    className={cn(buttonVariants(), className)}
    {...props}
  />
))
AlertDialogAction.displayName = AlertDialogPrimitive.Action.displayName

const AlertDialogCancel = React.forwardRef<
  React.ElementRef<typeof AlertDialogPrimitive.Cancel>,
  React.ComponentPropsWithoutRef<typeof AlertDialogPrimitive.Cancel>
>(({ className, ...props }, ref) => (
  <AlertDialogPrimitive.Cancel
    ref={ref}
    className={cn(
      buttonVariants({ variant: "outline" }),
      "mt-2 sm:mt-0",
      className
    )}
    {...props}
  />
))
AlertDialogCancel.displayName = AlertDialogPrimitive.Cancel.displayName

export {
  AlertDialog,
  AlertDialogPortal,
  AlertDialogOverlay,
  AlertDialogTrigger,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogFooter,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogAction,
  AlertDialogCancel,
}
```

**Step 2: Install Radix AlertDialog dependency**

Run: `cd packages/shared-ui && pnpm add @radix-ui/react-alert-dialog`

**Step 3: Export from shared-ui index**

Add to `packages/shared-ui/src/index.ts`:
```tsx
export * from './components/ui/alert-dialog';
```

**Step 4: Verify build**

Run: `pnpm --filter @agent-system/shared-ui build`
Expected: Build succeeds without errors

**Step 5: Commit**

```bash
git add packages/shared-ui/
git commit -m "feat(shared-ui): add AlertDialog component from shadcn/ui

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>"
```

---

### Task 2: Install Tooltip Component

**Files:**
- Create: `packages/shared-ui/src/components/ui/tooltip.tsx`
- Modify: `packages/shared-ui/src/index.ts`

**Step 1: Create Tooltip component**

```tsx
// packages/shared-ui/src/components/ui/tooltip.tsx
import * as React from "react"
import * as TooltipPrimitive from "@radix-ui/react-tooltip"

import { cn } from "../../lib/utils"

const TooltipProvider = TooltipPrimitive.Provider

const Tooltip = TooltipPrimitive.Root

const TooltipTrigger = TooltipPrimitive.Trigger

const TooltipContent = React.forwardRef<
  React.ElementRef<typeof TooltipPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof TooltipPrimitive.Content>
>(({ className, sideOffset = 4, ...props }, ref) => (
  <TooltipPrimitive.Portal>
    <TooltipPrimitive.Content
      ref={ref}
      sideOffset={sideOffset}
      className={cn(
        "z-50 overflow-hidden rounded-md bg-slate-900 px-3 py-1.5 text-xs text-slate-50 animate-in fade-in-0 zoom-in-95 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2",
        className
      )}
      {...props}
    />
  </TooltipPrimitive.Portal>
))
TooltipContent.displayName = TooltipPrimitive.Content.displayName

export { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider }
```

**Step 2: Install Radix Tooltip dependency**

Run: `cd packages/shared-ui && pnpm add @radix-ui/react-tooltip`

**Step 3: Export from shared-ui index**

Add to `packages/shared-ui/src/index.ts`:
```tsx
export * from './components/ui/tooltip';
```

**Step 4: Commit**

```bash
git add packages/shared-ui/
git commit -m "feat(shared-ui): add Tooltip component from shadcn/ui

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>"
```

---

### Task 3: Install DropdownMenu Component

**Files:**
- Create: `packages/shared-ui/src/components/ui/dropdown-menu.tsx`
- Modify: `packages/shared-ui/src/index.ts`

**Step 1: Create DropdownMenu component**

```tsx
// packages/shared-ui/src/components/ui/dropdown-menu.tsx
import * as React from "react"
import * as DropdownMenuPrimitive from "@radix-ui/react-dropdown-menu"
import { Check, ChevronRight, Circle } from "lucide-react"

import { cn } from "../../lib/utils"

const DropdownMenu = DropdownMenuPrimitive.Root

const DropdownMenuTrigger = DropdownMenuPrimitive.Trigger

const DropdownMenuGroup = DropdownMenuPrimitive.Group

const DropdownMenuPortal = DropdownMenuPrimitive.Portal

const DropdownMenuSub = DropdownMenuPrimitive.Sub

const DropdownMenuRadioGroup = DropdownMenuPrimitive.RadioGroup

const DropdownMenuSubTrigger = React.forwardRef<
  React.ElementRef<typeof DropdownMenuPrimitive.SubTrigger>,
  React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.SubTrigger> & {
    inset?: boolean
  }
>(({ className, inset, children, ...props }, ref) => (
  <DropdownMenuPrimitive.SubTrigger
    ref={ref}
    className={cn(
      "flex cursor-default select-none items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-none focus:bg-accent data-[state=open]:bg-accent [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0",
      inset && "pl-8",
      className
    )}
    {...props}
  >
    {children}
    <ChevronRight className="ml-auto" />
  </DropdownMenuPrimitive.SubTrigger>
))
DropdownMenuSubTrigger.displayName =
  DropdownMenuPrimitive.SubTrigger.displayName

const DropdownMenuSubContent = React.forwardRef<
  React.ElementRef<typeof DropdownMenuPrimitive.SubContent>,
  React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.SubContent>
>(({ className, ...props }, ref) => (
  <DropdownMenuPrimitive.SubContent
    ref={ref}
    className={cn(
      "z-50 min-w-[8rem] overflow-hidden rounded-md border bg-popover p-1 text-popover-foreground shadow-lg data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2",
      className
    )}
    {...props}
  />
))
DropdownMenuSubContent.displayName =
  DropdownMenuPrimitive.SubContent.displayName

const DropdownMenuContent = React.forwardRef<
  React.ElementRef<typeof DropdownMenuPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.Content>
>(({ className, sideOffset = 4, ...props }, ref) => (
  <DropdownMenuPrimitive.Portal>
    <DropdownMenuPrimitive.Content
      ref={ref}
      sideOffset={sideOffset}
      className={cn(
        "z-50 min-w-[8rem] overflow-hidden rounded-md border bg-popover p-1 text-popover-foreground shadow-md",
        "data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2",
        className
      )}
      {...props}
    />
  </DropdownMenuPrimitive.Portal>
))
DropdownMenuContent.displayName = DropdownMenuPrimitive.Content.displayName

const DropdownMenuItem = React.forwardRef<
  React.ElementRef<typeof DropdownMenuPrimitive.Item>,
  React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.Item> & {
    inset?: boolean
  }
>(({ className, inset, ...props }, ref) => (
  <DropdownMenuPrimitive.Item
    ref={ref}
    className={cn(
      "relative flex cursor-default select-none items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-none transition-colors focus:bg-accent focus:text-accent-foreground data-[disabled]:pointer-events-none data-[disabled]:opacity-50 [&>svg]:size-4 [&>svg]:shrink-0",
      inset && "pl-8",
      className
    )}
    {...props}
  />
))
DropdownMenuItem.displayName = DropdownMenuPrimitive.Item.displayName

const DropdownMenuCheckboxItem = React.forwardRef<
  React.ElementRef<typeof DropdownMenuPrimitive.CheckboxItem>,
  React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.CheckboxItem>
>(({ className, children, checked, ...props }, ref) => (
  <DropdownMenuPrimitive.CheckboxItem
    ref={ref}
    className={cn(
      "relative flex cursor-default select-none items-center rounded-sm py-1.5 pl-8 pr-2 text-sm outline-none transition-colors focus:bg-accent focus:text-accent-foreground data-[disabled]:pointer-events-none data-[disabled]:opacity-50",
      className
    )}
    checked={checked}
    {...props}
  >
    <span className="absolute left-2 flex h-3.5 w-3.5 items-center justify-center">
      <DropdownMenuPrimitive.ItemIndicator>
        <Check className="h-4 w-4" />
      </DropdownMenuPrimitive.ItemIndicator>
    </span>
    {children}
  </DropdownMenuPrimitive.CheckboxItem>
))
DropdownMenuCheckboxItem.displayName =
  DropdownMenuPrimitive.CheckboxItem.displayName

const DropdownMenuRadioItem = React.forwardRef<
  React.ElementRef<typeof DropdownMenuPrimitive.RadioItem>,
  React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.RadioItem>
>(({ className, children, ...props }, ref) => (
  <DropdownMenuPrimitive.RadioItem
    ref={ref}
    className={cn(
      "relative flex cursor-default select-none items-center rounded-sm py-1.5 pl-8 pr-2 text-sm outline-none transition-colors focus:bg-accent focus:text-accent-foreground data-[disabled]:pointer-events-none data-[disabled]:opacity-50",
      className
    )}
    {...props}
  >
    <span className="absolute left-2 flex h-3.5 w-3.5 items-center justify-center">
      <DropdownMenuPrimitive.ItemIndicator>
        <Circle className="h-2 w-2 fill-current" />
      </DropdownMenuPrimitive.ItemIndicator>
    </span>
    {children}
  </DropdownMenuPrimitive.RadioItem>
))
DropdownMenuRadioItem.displayName = DropdownMenuPrimitive.RadioItem.displayName

const DropdownMenuLabel = React.forwardRef<
  React.ElementRef<typeof DropdownMenuPrimitive.Label>,
  React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.Label> & {
    inset?: boolean
  }
>(({ className, inset, ...props }, ref) => (
  <DropdownMenuPrimitive.Label
    ref={ref}
    className={cn(
      "px-2 py-1.5 text-sm font-semibold",
      inset && "pl-8",
      className
    )}
    {...props}
  />
))
DropdownMenuLabel.displayName = DropdownMenuPrimitive.Label.displayName

const DropdownMenuSeparator = React.forwardRef<
  React.ElementRef<typeof DropdownMenuPrimitive.Separator>,
  React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.Separator>
>(({ className, ...props }, ref) => (
  <DropdownMenuPrimitive.Separator
    ref={ref}
    className={cn("-mx-1 my-1 h-px bg-muted", className)}
    {...props}
  />
))
DropdownMenuSeparator.displayName = DropdownMenuPrimitive.Separator.displayName

const DropdownMenuShortcut = ({
  className,
  ...props
}: React.HTMLAttributes<HTMLSpanElement>) => {
  return (
    <span
      className={cn("ml-auto text-xs tracking-widest opacity-60", className)}
      {...props}
    />
  )
}
DropdownMenuShortcut.displayName = "DropdownMenuShortcut"

export {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuCheckboxItem,
  DropdownMenuRadioItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuGroup,
  DropdownMenuPortal,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuRadioGroup,
}
```

**Step 2: Install Radix DropdownMenu dependency**

Run: `cd packages/shared-ui && pnpm add @radix-ui/react-dropdown-menu`

**Step 3: Export from shared-ui index**

Add to `packages/shared-ui/src/index.ts`:
```tsx
export * from './components/ui/dropdown-menu';
```

**Step 4: Commit**

```bash
git add packages/shared-ui/
git commit -m "feat(shared-ui): add DropdownMenu component from shadcn/ui

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>"
```

---

### Task 4: Install Separator Component

**Files:**
- Create: `packages/shared-ui/src/components/ui/separator.tsx`
- Modify: `packages/shared-ui/src/index.ts`

**Step 1: Create Separator component**

```tsx
// packages/shared-ui/src/components/ui/separator.tsx
import * as React from "react"
import * as SeparatorPrimitive from "@radix-ui/react-separator"

import { cn } from "../../lib/utils"

const Separator = React.forwardRef<
  React.ElementRef<typeof SeparatorPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof SeparatorPrimitive.Root>
>(
  (
    { className, orientation = "horizontal", decorative = true, ...props },
    ref
  ) => (
    <SeparatorPrimitive.Root
      ref={ref}
      decorative={decorative}
      orientation={orientation}
      className={cn(
        "shrink-0 bg-border",
        orientation === "horizontal" ? "h-[1px] w-full" : "h-full w-[1px]",
        className
      )}
      {...props}
    />
  )
)
Separator.displayName = SeparatorPrimitive.Root.displayName

export { Separator }
```

**Step 2: Install Radix Separator dependency**

Run: `cd packages/shared-ui && pnpm add @radix-ui/react-separator`

**Step 3: Export from shared-ui index**

Add to `packages/shared-ui/src/index.ts`:
```tsx
export * from './components/ui/separator';
```

**Step 4: Commit**

```bash
git add packages/shared-ui/
git commit -m "feat(shared-ui): add Separator component from shadcn/ui

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>"
```

---

### Task 5: Install ScrollArea Component

**Files:**
- Create: `packages/shared-ui/src/components/ui/scroll-area.tsx`
- Modify: `packages/shared-ui/src/index.ts`

**Step 1: Create ScrollArea component**

```tsx
// packages/shared-ui/src/components/ui/scroll-area.tsx
import * as React from "react"
import * as ScrollAreaPrimitive from "@radix-ui/react-scroll-area"

import { cn } from "../../lib/utils"

const ScrollArea = React.forwardRef<
  React.ElementRef<typeof ScrollAreaPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof ScrollAreaPrimitive.Root>
>(({ className, children, ...props }, ref) => (
  <ScrollAreaPrimitive.Root
    ref={ref}
    className={cn("relative overflow-hidden", className)}
    {...props}
  >
    <ScrollAreaPrimitive.Viewport className="h-full w-full rounded-[inherit]">
      {children}
    </ScrollAreaPrimitive.Viewport>
    <ScrollBar />
    <ScrollAreaPrimitive.Corner />
  </ScrollAreaPrimitive.Root>
))
ScrollArea.displayName = ScrollAreaPrimitive.Root.displayName

const ScrollBar = React.forwardRef<
  React.ElementRef<typeof ScrollAreaPrimitive.ScrollAreaScrollbar>,
  React.ComponentPropsWithoutRef<typeof ScrollAreaPrimitive.ScrollAreaScrollbar>
>(({ className, orientation = "vertical", ...props }, ref) => (
  <ScrollAreaPrimitive.ScrollAreaScrollbar
    ref={ref}
    orientation={orientation}
    className={cn(
      "flex touch-none select-none transition-colors",
      orientation === "vertical" &&
        "h-full w-2.5 border-l border-l-transparent p-[1px]",
      orientation === "horizontal" &&
        "h-2.5 flex-col border-t border-t-transparent p-[1px]",
      className
    )}
    {...props}
  >
    <ScrollAreaPrimitive.ScrollAreaThumb className="relative flex-1 rounded-full bg-border" />
  </ScrollAreaPrimitive.ScrollAreaScrollbar>
))
ScrollBar.displayName = ScrollAreaPrimitive.ScrollAreaScrollbar.displayName

export { ScrollArea, ScrollBar }
```

**Step 2: Install Radix ScrollArea dependency**

Run: `cd packages/shared-ui && pnpm add @radix-ui/react-scroll-area`

**Step 3: Export from shared-ui index**

Add to `packages/shared-ui/src/index.ts`:
```tsx
export * from './components/ui/scroll-area';
```

**Step 4: Commit**

```bash
git add packages/shared-ui/
git commit -m "feat(shared-ui): add ScrollArea component from shadcn/ui

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>"
```

---

### Task 6: Install Tabs Component

**Files:**
- Create: `packages/shared-ui/src/components/ui/tabs.tsx`
- Modify: `packages/shared-ui/src/index.ts`

**Step 1: Create Tabs component**

```tsx
// packages/shared-ui/src/components/ui/tabs.tsx
import * as React from "react"
import * as TabsPrimitive from "@radix-ui/react-tabs"

import { cn } from "../../lib/utils"

const Tabs = TabsPrimitive.Root

const TabsList = React.forwardRef<
  React.ElementRef<typeof TabsPrimitive.List>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.List>
>(({ className, ...props }, ref) => (
  <TabsPrimitive.List
    ref={ref}
    className={cn(
      "inline-flex h-9 items-center justify-center rounded-lg bg-muted p-1 text-muted-foreground",
      className
    )}
    {...props}
  />
))
TabsList.displayName = TabsPrimitive.List.displayName

const TabsTrigger = React.forwardRef<
  React.ElementRef<typeof TabsPrimitive.Trigger>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.Trigger>
>(({ className, ...props }, ref) => (
  <TabsPrimitive.Trigger
    ref={ref}
    className={cn(
      "inline-flex items-center justify-center whitespace-nowrap rounded-md px-3 py-1 text-sm font-medium ring-offset-background transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 data-[state=active]:bg-background data-[state=active]:text-foreground data-[state=active]:shadow",
      className
    )}
    {...props}
  />
))
TabsTrigger.displayName = TabsPrimitive.Trigger.displayName

const TabsContent = React.forwardRef<
  React.ElementRef<typeof TabsPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.Content>
>(({ className, ...props }, ref) => (
  <TabsPrimitive.Content
    ref={ref}
    className={cn(
      "mt-2 ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
      className
    )}
    {...props}
  />
))
TabsContent.displayName = TabsPrimitive.Content.displayName

export { Tabs, TabsList, TabsTrigger, TabsContent }
```

**Step 2: Install Radix Tabs dependency**

Run: `cd packages/shared-ui && pnpm add @radix-ui/react-tabs`

**Step 3: Export from shared-ui index**

Add to `packages/shared-ui/src/index.ts`:
```tsx
export * from './components/ui/tabs';
```

**Step 4: Commit**

```bash
git add packages/shared-ui/
git commit -m "feat(shared-ui): add Tabs component from shadcn/ui

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>"
```

---

### Task 7: Install Progress Component

**Files:**
- Create: `packages/shared-ui/src/components/ui/progress.tsx`
- Modify: `packages/shared-ui/src/index.ts`

**Step 1: Create Progress component**

```tsx
// packages/shared-ui/src/components/ui/progress.tsx
import * as React from "react"
import * as ProgressPrimitive from "@radix-ui/react-progress"

import { cn } from "../../lib/utils"

const Progress = React.forwardRef<
  React.ElementRef<typeof ProgressPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof ProgressPrimitive.Root>
>(({ className, value, ...props }, ref) => (
  <ProgressPrimitive.Root
    ref={ref}
    className={cn(
      "relative h-2 w-full overflow-hidden rounded-full bg-primary/20",
      className
    )}
    {...props}
  >
    <ProgressPrimitive.Indicator
      className="h-full w-full flex-1 bg-primary transition-all"
      style={{ transform: `translateX(-${100 - (value || 0)}%)` }}
    />
  </ProgressPrimitive.Root>
))
Progress.displayName = ProgressPrimitive.Root.displayName

export { Progress }
```

**Step 2: Install Radix Progress dependency**

Run: `cd packages/shared-ui && pnpm add @radix-ui/react-progress`

**Step 3: Export from shared-ui index**

Add to `packages/shared-ui/src/index.ts`:
```tsx
export * from './components/ui/progress';
```

**Step 4: Commit**

```bash
git add packages/shared-ui/
git commit -m "feat(shared-ui): add Progress component from shadcn/ui

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>"
```

---

## Phase 2: Replace Native Browser Dialogs with AlertDialog

### Task 8: Admin Portal - CampaignList AlertDialog

**Files:**
- Modify: `apps/admin-portal/src/pages/campaigns/CampaignList.tsx`

**Step 1: Replace confirm() with AlertDialog**

Replace the native `confirm()` dialog with a proper AlertDialog component:

```tsx
// Add to imports
import {
  // ... existing imports
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@agent-system/shared-ui';

// Add state for delete confirmation
const [deleteId, setDeleteId] = useState<string | null>(null);

// Replace handleDelete function
const handleDelete = (id: string) => {
  setDeleteId(id);
};

const confirmDelete = () => {
  if (deleteId) {
    deleteCampaign.mutate(deleteId);
    setDeleteId(null);
  }
};

// Replace the delete button with AlertDialog
<AlertDialog open={!!deleteId} onOpenChange={(open) => !open && setDeleteId(null)}>
  <AlertDialogTrigger asChild>
    <Button
      variant="ghost"
      size="sm"
      className="h-8 w-8 p-0"
      onClick={() => handleDelete(campaign.id)}
    >
      <Trash2 className="h-4 w-4 text-red-500" />
    </Button>
  </AlertDialogTrigger>
  <AlertDialogContent>
    <AlertDialogHeader>
      <AlertDialogTitle>Delete Campaign</AlertDialogTitle>
      <AlertDialogDescription>
        Are you sure you want to delete this campaign? This action cannot be undone.
      </AlertDialogDescription>
    </AlertDialogHeader>
    <AlertDialogFooter>
      <AlertDialogCancel>Cancel</AlertDialogCancel>
      <AlertDialogAction
        onClick={confirmDelete}
        className="bg-red-600 hover:bg-red-700"
      >
        Delete
      </AlertDialogAction>
    </AlertDialogFooter>
  </AlertDialogContent>
</AlertDialog>
```

**Step 2: Test the delete confirmation**

Run: `pnpm dev:admin`
Navigate to Campaigns page and click delete on a campaign.
Expected: AlertDialog appears instead of native browser confirm.

**Step 3: Commit**

```bash
git add apps/admin-portal/src/pages/campaigns/CampaignList.tsx
git commit -m "refactor(admin): replace native confirm with AlertDialog in CampaignList

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>"
```

---

### Task 9: Admin Portal - AgentList AlertDialog

**Files:**
- Modify: `apps/admin-portal/src/pages/agents/AgentList.tsx`

**Step 1: Replace confirm() with AlertDialog**

Same pattern as CampaignList - add AlertDialog for delete confirmation.

**Step 2: Test the delete confirmation**

Run: `pnpm dev:admin`
Navigate to Agents page and test delete.
Expected: AlertDialog appears.

**Step 3: Commit**

```bash
git add apps/admin-portal/src/pages/agents/AgentList.tsx
git commit -m "refactor(admin): replace native confirm with AlertDialog in AgentList

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>"
```

---

### Task 10: Admin Portal - TierList AlertDialog

**Files:**
- Modify: `apps/admin-portal/src/pages/tiers/TierList.tsx`

**Step 1: Replace confirm() with AlertDialog**

Same pattern - add AlertDialog for delete confirmation.

**Step 2: Test the delete confirmation**

**Step 3: Commit**

```bash
git add apps/admin-portal/src/pages/tiers/TierList.tsx
git commit -m "refactor(admin): replace native confirm with AlertDialog in TierList

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>"
```

---

### Task 11: Admin Portal - PinCodes AlertDialog

**Files:**
- Modify: `apps/admin-portal/src/pages/PinCodes.tsx`

**Step 1: Replace confirm() with AlertDialog**

Replace the confirm() for "Delete Unused" with AlertDialog.

**Step 2: Commit**

```bash
git add apps/admin-portal/src/pages/PinCodes.tsx
git commit -m "refactor(admin): replace native confirm with AlertDialog in PinCodes

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>"
```

---

## Phase 3: Add Tooltips to Action Buttons

### Task 12: Add Tooltips to CampaignList Actions

**Files:**
- Modify: `apps/admin-portal/src/pages/campaigns/CampaignList.tsx`

**Step 1: Wrap action buttons with Tooltip**

```tsx
// Add TooltipProvider at the top level of the component
<TooltipProvider>
  {/* existing content */}

  {/* Wrap each action button */}
  <Tooltip>
    <TooltipTrigger asChild>
      <Link to="/campaigns/$campaignId" params={{ campaignId: campaign.id }}>
        <Button variant="ghost" size="sm" className="h-8 w-8 p-0">
          <Eye className="h-4 w-4" />
        </Button>
      </Link>
    </TooltipTrigger>
    <TooltipContent>View details</TooltipContent>
  </Tooltip>

  {/* Similar for Edit, Pause/Play, Delete */}
</TooltipProvider>
```

**Step 2: Commit**

```bash
git add apps/admin-portal/src/pages/campaigns/CampaignList.tsx
git commit -m "feat(admin): add tooltips to CampaignList action buttons

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>"
```

---

### Task 13: Add Tooltips to AgentList Actions

**Files:**
- Modify: `apps/admin-portal/src/pages/agents/AgentList.tsx`

**Step 1: Wrap action buttons with Tooltip**

Same pattern as CampaignList.

**Step 2: Commit**

```bash
git add apps/admin-portal/src/pages/agents/AgentList.tsx
git commit -m "feat(admin): add tooltips to AgentList action buttons

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>"
```

---

### Task 14: Add Tooltips to Agent Portal Invitations

**Files:**
- Modify: `apps/agent-portal/src/pages/Invitations.tsx`

**Step 1: Add tooltips for copy button**

```tsx
<Tooltip>
  <TooltipTrigger asChild>
    <Button
      variant="ghost"
      size="sm"
      className="h-8 w-8 p-0"
      onClick={() => handleCopy(invitation.unique_token, invitation.id)}
    >
      {copiedId === invitation.id ? (
        <Check className="h-4 w-4 text-emerald-600" />
      ) : (
        <Copy className="h-4 w-4" />
      )}
    </Button>
  </TooltipTrigger>
  <TooltipContent>
    {copiedId === invitation.id ? 'Copied!' : 'Copy invitation link'}
  </TooltipContent>
</Tooltip>
```

**Step 2: Commit**

```bash
git add apps/agent-portal/src/pages/Invitations.tsx
git commit -m "feat(agent): add tooltips to Invitations action buttons

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>"
```

---

## Phase 4: Improve Table Styling with Consistent Patterns

### Task 15: Add glass-card styling consistency to TierList

**Files:**
- Modify: `apps/admin-portal/src/pages/tiers/TierList.tsx`

**Step 1: Add glass-card class and consistent styling**

Add `glass-card` class to Card components and ensure consistent text colors matching other pages.

**Step 2: Add TableSkeleton for loading state**

Replace the simple text loading indicator with TableSkeleton.

**Step 3: Commit**

```bash
git add apps/admin-portal/src/pages/tiers/TierList.tsx
git commit -m "style(admin): improve TierList styling consistency with glass-card and TableSkeleton

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>"
```

---

### Task 16: Add glass-card styling to PinCodes

**Files:**
- Modify: `apps/admin-portal/src/pages/PinCodes.tsx`

**Step 1: Add glass-card class and consistent text colors**

Update Card components with `glass-card` class and fix muted-foreground to slate-500.

**Step 2: Add TableSkeleton**

Replace text loading indicator with TableSkeleton.

**Step 3: Commit**

```bash
git add apps/admin-portal/src/pages/PinCodes.tsx
git commit -m "style(admin): improve PinCodes styling consistency

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>"
```

---

## Phase 5: Add DropdownMenu for Row Actions

### Task 17: Replace inline buttons with DropdownMenu in CampaignList

**Files:**
- Modify: `apps/admin-portal/src/pages/campaigns/CampaignList.tsx`

**Step 1: Add DropdownMenu for actions**

```tsx
import { MoreHorizontal } from 'lucide-react';

// Replace action buttons with DropdownMenu
<DropdownMenu>
  <DropdownMenuTrigger asChild>
    <Button variant="ghost" size="sm" className="h-8 w-8 p-0">
      <MoreHorizontal className="h-4 w-4" />
    </Button>
  </DropdownMenuTrigger>
  <DropdownMenuContent align="end">
    <DropdownMenuLabel>Actions</DropdownMenuLabel>
    <DropdownMenuSeparator />
    <Link to="/campaigns/$campaignId" params={{ campaignId: campaign.id }}>
      <DropdownMenuItem>
        <Eye className="h-4 w-4 mr-2" />
        View Details
      </DropdownMenuItem>
    </Link>
    <Link to="/campaigns/$campaignId/edit" params={{ campaignId: campaign.id }}>
      <DropdownMenuItem>
        <Edit className="h-4 w-4 mr-2" />
        Edit
      </DropdownMenuItem>
    </Link>
    {(campaign.status === CampaignStatus.ACTIVE || campaign.status === CampaignStatus.PAUSED) && (
      <DropdownMenuItem onClick={() => handleToggleStatus(campaign.id, campaign.status)}>
        {campaign.status === CampaignStatus.ACTIVE ? (
          <>
            <Pause className="h-4 w-4 mr-2" />
            Pause Campaign
          </>
        ) : (
          <>
            <Play className="h-4 w-4 mr-2" />
            Activate Campaign
          </>
        )}
      </DropdownMenuItem>
    )}
    <DropdownMenuSeparator />
    <DropdownMenuItem
      className="text-red-600 focus:text-red-600"
      onClick={() => handleDelete(campaign.id)}
    >
      <Trash2 className="h-4 w-4 mr-2" />
      Delete
    </DropdownMenuItem>
  </DropdownMenuContent>
</DropdownMenu>
```

**Step 2: Commit**

```bash
git add apps/admin-portal/src/pages/campaigns/CampaignList.tsx
git commit -m "feat(admin): add DropdownMenu for CampaignList row actions

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>"
```

---

### Task 18: Add DropdownMenu to AgentList

**Files:**
- Modify: `apps/admin-portal/src/pages/agents/AgentList.tsx`

**Step 1: Replace inline buttons with DropdownMenu**

Same pattern as CampaignList.

**Step 2: Commit**

```bash
git add apps/admin-portal/src/pages/agents/AgentList.tsx
git commit -m "feat(admin): add DropdownMenu for AgentList row actions

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>"
```

---

## Phase 6: Final Build Verification

### Task 19: Run full build and type check

**Step 1: Run typecheck**

Run: `pnpm -r typecheck`
Expected: No TypeScript errors

**Step 2: Run lint**

Run: `pnpm lint`
Expected: No linting errors

**Step 3: Build all apps**

Run: `pnpm build`
Expected: All 3 apps build successfully

**Step 4: Final commit**

```bash
git add .
git commit -m "chore: verify all builds pass after shadcn/ui enhancements

Co-Authored-By: Claude Opus 4.5 <noreply@anthropic.com>"
```

---

## Summary

This plan covers:
1. **7 new shadcn/ui components** installed in shared-ui package
2. **4 pages** updated to use AlertDialog instead of native confirm()
3. **3 pages** enhanced with Tooltips on action buttons
4. **2 pages** updated with DropdownMenu for cleaner row actions
5. **2 pages** improved with consistent glass-card styling and TableSkeleton
6. **Full build verification** at the end

Total: ~19 tasks, each taking 2-5 minutes
