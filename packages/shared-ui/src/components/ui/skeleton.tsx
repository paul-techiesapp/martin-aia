import * as React from "react";
import { cn } from "../../lib/utils";

export interface SkeletonProps extends React.HTMLAttributes<HTMLDivElement> {
  variant?: "default" | "circular" | "text" | "card" | "stat-card" | "table-row";
}

const Skeleton = React.forwardRef<HTMLDivElement, SkeletonProps>(
  ({ className, variant = "default", ...props }, ref) => {
    const variantStyles = {
      default: "h-4 w-full rounded-md",
      circular: "h-10 w-10 rounded-full",
      text: "h-4 w-3/4 rounded",
      card: "h-32 w-full rounded-lg",
      "stat-card": "h-24 w-full rounded-xl",
      "table-row": "h-12 w-full rounded",
    };

    return (
      <div
        ref={ref}
        className={cn(
          "animate-pulse bg-slate-200/80",
          variantStyles[variant],
          className
        )}
        {...props}
      />
    );
  }
);
Skeleton.displayName = "Skeleton";

// Skeleton group for multiple loading items
export interface SkeletonGroupProps {
  count?: number;
  variant?: SkeletonProps["variant"];
  className?: string;
  gap?: "sm" | "md" | "lg";
}

const SkeletonGroup: React.FC<SkeletonGroupProps> = ({
  count = 3,
  variant = "default",
  className,
  gap = "md",
}) => {
  const gapStyles = {
    sm: "space-y-2",
    md: "space-y-3",
    lg: "space-y-4",
  };

  return (
    <div className={cn(gapStyles[gap], className)}>
      {Array.from({ length: count }).map((_, i) => (
        <Skeleton key={i} variant={variant} />
      ))}
    </div>
  );
};

// Stat card skeleton
const StatCardSkeleton: React.FC<{ className?: string }> = ({ className }) => {
  return (
    <div
      className={cn(
        "p-6 rounded-xl bg-white/80 backdrop-blur-sm border border-slate-200/50",
        className
      )}
    >
      <div className="flex items-start justify-between">
        <div className="space-y-3 flex-1">
          <Skeleton className="h-4 w-24" />
          <Skeleton className="h-8 w-20" />
          <Skeleton className="h-3 w-32" />
        </div>
        <Skeleton variant="circular" className="h-12 w-12" />
      </div>
    </div>
  );
};

// Table skeleton
const TableSkeleton: React.FC<{
  rows?: number;
  columns?: number;
  className?: string;
}> = ({ rows = 5, columns = 4, className }) => {
  return (
    <div className={cn("space-y-3", className)}>
      {/* Header */}
      <div className="flex gap-4 p-4 bg-slate-100/50 rounded-t-lg">
        {Array.from({ length: columns }).map((_, i) => (
          <Skeleton key={i} className="h-4 flex-1" />
        ))}
      </div>
      {/* Rows */}
      {Array.from({ length: rows }).map((_, rowIndex) => (
        <div key={rowIndex} className="flex gap-4 p-4 border-b border-slate-100">
          {Array.from({ length: columns }).map((_, colIndex) => (
            <Skeleton
              key={colIndex}
              className={cn("h-4 flex-1", colIndex === 0 && "w-1/3")}
            />
          ))}
        </div>
      ))}
    </div>
  );
};

export { Skeleton, SkeletonGroup, StatCardSkeleton, TableSkeleton };
