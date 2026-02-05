import * as React from "react";
import { LucideIcon } from "lucide-react";
import { cn } from "../../lib/utils";
import { Skeleton } from "./skeleton";

// Color mapping for semantic icon colors
const iconColorMap: Record<string, { text: string; bg: string }> = {
  sky: { text: "text-sky-600", bg: "bg-sky-100" },
  emerald: { text: "text-emerald-600", bg: "bg-emerald-100" },
  amber: { text: "text-amber-600", bg: "bg-amber-100" },
  violet: { text: "text-violet-600", bg: "bg-violet-100" },
  rose: { text: "text-rose-600", bg: "bg-rose-100" },
  slate: { text: "text-slate-600", bg: "bg-slate-100" },
  primary: { text: "text-primary", bg: "bg-primary/10" },
};

export interface StatCardProps {
  title: string;
  value: string | number;
  subtitle?: string;
  description?: string; // Alias for subtitle
  icon?: LucideIcon;
  iconColor?: string;
  iconBgColor?: string;
  trend?: {
    value: number;
    label?: string;
    isPositive?: boolean;
  };
  loading?: boolean;
  className?: string;
}

const StatCard = React.forwardRef<HTMLDivElement, StatCardProps>(
  (
    {
      title,
      value,
      subtitle,
      description, // Support both subtitle and description
      icon: Icon,
      iconColor = "primary",
      iconBgColor,
      trend,
      loading = false,
      className,
    },
    ref
  ) => {
    // Use description if subtitle is not provided
    const displaySubtitle = subtitle || description;

    // Resolve semantic color names to Tailwind classes
    const colorConfig = iconColorMap[iconColor] || {
      text: iconColor.startsWith("text-") ? iconColor : `text-${iconColor}-600`,
      bg: iconBgColor || (iconColor.startsWith("bg-") ? iconColor.replace("text-", "bg-").replace("-600", "-100") : `bg-${iconColor}-100`)
    };

    const resolvedIconColor = colorConfig.text;
    const resolvedIconBgColor = iconBgColor || colorConfig.bg;

    if (loading) {
      return (
        <div
          ref={ref}
          className={cn(
            "p-6 rounded-xl bg-white/80 backdrop-blur-sm border border-slate-200/50 shadow-sm",
            className
          )}
        >
          <div className="flex items-start justify-between">
            <div className="space-y-3 flex-1">
              <Skeleton className="h-4 w-24" />
              <Skeleton className="h-8 w-20" />
              {displaySubtitle && <Skeleton className="h-3 w-32" />}
            </div>
            <Skeleton variant="circular" className="h-12 w-12" />
          </div>
        </div>
      );
    }

    return (
      <div
        ref={ref}
        className={cn(
          "p-6 rounded-xl bg-white/80 backdrop-blur-sm border border-slate-200/50 shadow-sm hover:shadow-md transition-all duration-200",
          className
        )}
      >
        <div className="flex items-start justify-between">
          <div className="space-y-1">
            <p className="text-sm font-medium text-slate-500">{title}</p>
            <p className="text-3xl font-bold text-slate-900 tracking-tight">
              {value}
            </p>
            {displaySubtitle && (
              <p className="text-sm text-slate-500">{displaySubtitle}</p>
            )}
            {trend && (
              <div className="flex items-center gap-1 mt-2">
                <span
                  className={cn(
                    "text-sm font-medium",
                    trend.isPositive ? "text-emerald-600" : "text-red-600"
                  )}
                >
                  {trend.isPositive ? "+" : ""}
                  {trend.value}%
                </span>
                {trend.label && (
                  <span className="text-sm text-slate-500">{trend.label}</span>
                )}
              </div>
            )}
          </div>
          {Icon && (
            <div
              className={cn(
                "p-3 rounded-xl",
                resolvedIconBgColor
              )}
            >
              <Icon className={cn("h-6 w-6", resolvedIconColor)} />
            </div>
          )}
        </div>
      </div>
    );
  }
);
StatCard.displayName = "StatCard";

// Grid wrapper for stat cards
export interface StatCardGridProps {
  children: React.ReactNode;
  columns?: 2 | 3 | 4;
  className?: string;
}

const StatCardGrid: React.FC<StatCardGridProps> = ({
  children,
  columns = 4,
  className,
}) => {
  const gridCols = {
    2: "grid-cols-1 sm:grid-cols-2",
    3: "grid-cols-1 sm:grid-cols-2 lg:grid-cols-3",
    4: "grid-cols-1 sm:grid-cols-2 lg:grid-cols-4",
  };

  return (
    <div className={cn("grid gap-4", gridCols[columns], className)}>
      {children}
    </div>
  );
};

export { StatCard, StatCardGrid };
