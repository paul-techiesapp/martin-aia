import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "../../lib/utils";

const badgeVariants = cva(
  "inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium transition-colors",
  {
    variants: {
      variant: {
        // Default
        default: "bg-slate-100 text-slate-700 border border-slate-200",

        // Campaign status
        draft: "bg-slate-100 text-slate-700 border border-slate-200",
        active: "bg-emerald-100 text-emerald-700 border border-emerald-200",
        paused: "bg-amber-100 text-amber-700 border border-amber-200",
        completed: "bg-blue-100 text-blue-700 border border-blue-200",

        // Invitation status
        pending: "bg-slate-100 text-slate-700 border border-slate-200",
        registered: "bg-blue-100 text-blue-700 border border-blue-200",
        attended: "bg-emerald-100 text-emerald-700 border border-emerald-200",
        expired: "bg-red-100 text-red-700 border border-red-200",

        // Reward status
        approved: "bg-blue-100 text-blue-700 border border-blue-200",
        paid: "bg-emerald-100 text-emerald-700 border border-emerald-200",

        // Agent status
        inactive: "bg-slate-100 text-slate-700 border border-slate-200",
        suspended: "bg-red-100 text-red-700 border border-red-200",

        // Semantic variants
        success: "bg-emerald-100 text-emerald-700 border border-emerald-200",
        warning: "bg-amber-100 text-amber-700 border border-amber-200",
        error: "bg-red-100 text-red-700 border border-red-200",
        info: "bg-sky-100 text-sky-700 border border-sky-200",
        neutral: "bg-slate-100 text-slate-700 border border-slate-200",

        // Outline variants
        outline: "border border-current bg-transparent",
        "outline-success": "border-emerald-500 text-emerald-600 bg-transparent",
        "outline-warning": "border-amber-500 text-amber-600 bg-transparent",
        "outline-error": "border-red-500 text-red-600 bg-transparent",
      },
      size: {
        sm: "px-2 py-0.5 text-xs",
        md: "px-2.5 py-0.5 text-xs",
        lg: "px-3 py-1 text-sm",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "md",
    },
  }
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof badgeVariants> {}

const Badge = React.forwardRef<HTMLSpanElement, BadgeProps>(
  ({ className, variant, size, ...props }, ref) => {
    return (
      <span
        ref={ref}
        className={cn(badgeVariants({ variant, size }), className)}
        {...props}
      />
    );
  }
);
Badge.displayName = "Badge";

// Helper function to get badge variant from status string
export function getStatusVariant(
  status: string
): VariantProps<typeof badgeVariants>["variant"] {
  const statusMap: Record<string, VariantProps<typeof badgeVariants>["variant"]> = {
    // Campaign
    draft: "draft",
    active: "active",
    paused: "paused",
    completed: "completed",

    // Invitation
    pending: "pending",
    PENDING: "pending",
    registered: "registered",
    REGISTERED: "registered",
    attended: "attended",
    ATTENDED: "attended",
    expired: "expired",
    EXPIRED: "expired",

    // Reward
    approved: "approved",
    APPROVED: "approved",
    paid: "paid",
    PAID: "paid",

    // Agent
    inactive: "inactive",
    suspended: "suspended",
  };

  return statusMap[status] || "default";
}

export { Badge, badgeVariants };
