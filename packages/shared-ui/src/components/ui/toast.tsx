import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { X, CheckCircle2, XCircle, AlertTriangle, Info } from "lucide-react";
import { cn } from "../../lib/utils";

const toastVariants = cva(
  "group pointer-events-auto relative flex w-full items-center justify-between space-x-4 overflow-hidden rounded-lg border p-4 shadow-lg transition-all data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-80 data-[state=closed]:slide-out-to-right-full data-[state=open]:slide-in-from-top-full",
  {
    variants: {
      variant: {
        default: "border-slate-200 bg-white text-slate-900",
        success: "border-emerald-200 bg-emerald-50 text-emerald-900",
        error: "border-red-200 bg-red-50 text-red-900",
        warning: "border-amber-200 bg-amber-50 text-amber-900",
        info: "border-sky-200 bg-sky-50 text-sky-900",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
);

const iconMap = {
  default: null,
  success: CheckCircle2,
  error: XCircle,
  warning: AlertTriangle,
  info: Info,
};

const iconColorMap = {
  default: "text-slate-500",
  success: "text-emerald-500",
  error: "text-red-500",
  warning: "text-amber-500",
  info: "text-sky-500",
};

export interface ToastProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof toastVariants> {
  title?: string;
  description?: string;
  onDismiss?: () => void;
}

const Toast = React.forwardRef<HTMLDivElement, ToastProps>(
  ({ className, variant = "default", title, description, onDismiss, ...props }, ref) => {
    const Icon = iconMap[variant || "default"];
    const iconColor = iconColorMap[variant || "default"];

    return (
      <div
        ref={ref}
        className={cn(toastVariants({ variant }), className)}
        {...props}
      >
        <div className="flex items-start gap-3">
          {Icon && <Icon className={cn("h-5 w-5 flex-shrink-0", iconColor)} />}
          <div className="flex-1 space-y-1">
            {title && (
              <p className="text-sm font-semibold leading-none">{title}</p>
            )}
            {description && (
              <p className="text-sm opacity-90">{description}</p>
            )}
          </div>
        </div>
        {onDismiss && (
          <button
            onClick={onDismiss}
            className="absolute right-2 top-2 rounded-md p-1 opacity-0 transition-opacity hover:bg-slate-100 focus:opacity-100 focus:outline-none group-hover:opacity-100"
          >
            <X className="h-4 w-4" />
          </button>
        )}
      </div>
    );
  }
);
Toast.displayName = "Toast";

export { Toast, toastVariants };
