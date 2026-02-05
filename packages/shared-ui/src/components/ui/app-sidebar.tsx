import * as React from "react";
import { Menu, X } from "lucide-react";
import { cn } from "../../lib/utils";
import { Button } from "./button";

export interface SidebarItem {
  label: string;
  href: string;
  icon?: React.ReactNode;
  active?: boolean;
}

export interface AppSidebarProps {
  items: SidebarItem[];
  logo?: React.ReactNode;
  footer?: React.ReactNode;
  onNavigate?: (href: string) => void;
  className?: string;
}

// Context for sidebar state
interface SidebarContextValue {
  isOpen: boolean;
  setIsOpen: (open: boolean) => void;
}

const SidebarContext = React.createContext<SidebarContextValue | null>(null);

export function useSidebar() {
  const context = React.useContext(SidebarContext);
  if (!context) {
    throw new Error("useSidebar must be used within a SidebarProvider");
  }
  return context;
}

// Provider component
export function SidebarProvider({ children }: { children: React.ReactNode }) {
  const [isOpen, setIsOpen] = React.useState(false);

  return (
    <SidebarContext.Provider value={{ isOpen, setIsOpen }}>
      {children}
    </SidebarContext.Provider>
  );
}

// Mobile trigger button
export function SidebarTrigger({ className }: { className?: string }) {
  const { isOpen, setIsOpen } = useSidebar();

  return (
    <Button
      variant="ghost"
      size="icon"
      className={cn("lg:hidden", className)}
      onClick={() => setIsOpen(!isOpen)}
      aria-label={isOpen ? "Close menu" : "Open menu"}
    >
      {isOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
    </Button>
  );
}

// Mobile overlay
function SidebarOverlay() {
  const { isOpen, setIsOpen } = useSidebar();

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-40 bg-slate-900/60 backdrop-blur-sm lg:hidden"
      onClick={() => setIsOpen(false)}
    />
  );
}

// Main sidebar component
export function AppSidebar({
  items,
  logo,
  footer,
  onNavigate,
  className,
}: AppSidebarProps) {
  const { isOpen, setIsOpen } = useSidebar();

  const handleNavigate = (href: string) => {
    onNavigate?.(href);
    setIsOpen(false);
  };

  return (
    <>
      <SidebarOverlay />

      {/* Desktop sidebar */}
      <aside
        className={cn(
          "hidden lg:flex lg:flex-col lg:w-64 lg:fixed lg:inset-y-0 lg:z-30",
          "bg-slate-900 text-white",
          className
        )}
      >
        <SidebarContent
          items={items}
          logo={logo}
          footer={footer}
          onNavigate={handleNavigate}
        />
      </aside>

      {/* Mobile sidebar */}
      <aside
        className={cn(
          "fixed inset-y-0 left-0 z-50 w-64 lg:hidden",
          "bg-slate-900 text-white",
          "transform transition-transform duration-200 ease-out",
          isOpen ? "translate-x-0" : "-translate-x-full"
        )}
      >
        <SidebarContent
          items={items}
          logo={logo}
          footer={footer}
          onNavigate={handleNavigate}
        />
      </aside>
    </>
  );
}

// Sidebar content (shared between mobile and desktop)
function SidebarContent({
  items,
  logo,
  footer,
  onNavigate,
}: Omit<AppSidebarProps, "className">) {
  return (
    <div className="flex flex-col h-full">
      {/* Logo area */}
      {logo && (
        <div className="flex items-center h-16 px-6 border-b border-slate-800">
          {logo}
        </div>
      )}

      {/* Navigation */}
      <nav className="flex-1 px-4 py-4 space-y-1 overflow-y-auto">
        {items.map((item, index) => (
          <button
            key={index}
            onClick={() => onNavigate?.(item.href)}
            className={cn(
              "flex items-center w-full gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all duration-150",
              item.active
                ? "bg-white/10 text-white"
                : "text-slate-300 hover:bg-white/5 hover:text-white"
            )}
          >
            {item.icon && (
              <span className="flex-shrink-0 w-5 h-5">{item.icon}</span>
            )}
            <span>{item.label}</span>
          </button>
        ))}
      </nav>

      {/* Footer area */}
      {footer && (
        <div className="px-4 py-4 border-t border-slate-800">{footer}</div>
      )}
    </div>
  );
}

// Layout wrapper that includes sidebar
export interface SidebarLayoutProps {
  children: React.ReactNode;
  sidebar: React.ReactNode;
  header?: React.ReactNode;
}

export function SidebarLayout({ children, sidebar, header }: SidebarLayoutProps) {
  return (
    <SidebarProvider>
      <div className="min-h-screen bg-slate-50">
        {sidebar}

        <div className="lg:pl-64">
          {/* Mobile header */}
          {header && (
            <header className="sticky top-0 z-30 flex items-center h-16 px-4 bg-white/80 backdrop-blur-sm border-b border-slate-200 lg:hidden">
              <SidebarTrigger />
              <div className="flex-1 ml-4">{header}</div>
            </header>
          )}

          {/* Main content */}
          <main className="min-h-screen">{children}</main>
        </div>
      </div>
    </SidebarProvider>
  );
}
