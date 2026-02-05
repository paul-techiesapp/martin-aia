import { useToast } from "../../hooks/use-toast";
import { Toast } from "./toast";
import { cn } from "../../lib/utils";

export interface ToasterProps {
  position?: "top-right" | "top-left" | "bottom-right" | "bottom-left" | "top-center" | "bottom-center";
  className?: string;
}

const positionStyles = {
  "top-right": "top-4 right-4",
  "top-left": "top-4 left-4",
  "bottom-right": "bottom-4 right-4",
  "bottom-left": "bottom-4 left-4",
  "top-center": "top-4 left-1/2 -translate-x-1/2",
  "bottom-center": "bottom-4 left-1/2 -translate-x-1/2",
};

export function Toaster({ position = "top-right", className }: ToasterProps) {
  const { toasts, dismiss } = useToast();

  return (
    <div
      className={cn(
        "fixed z-50 flex flex-col gap-2 w-full max-w-sm pointer-events-none",
        positionStyles[position],
        className
      )}
    >
      {toasts.map((toast) => (
        <Toast
          key={toast.id}
          variant={toast.variant}
          title={toast.title}
          description={toast.description}
          onDismiss={() => dismiss(toast.id)}
          className="pointer-events-auto animate-in slide-in-from-right-full duration-200"
        />
      ))}
    </div>
  );
}
