import { useState } from 'react';
import { Link, useLocation, useNavigate } from '@tanstack/react-router';
import { Button, cn, Logo } from '@agent-system/shared-ui';
import {
  LayoutDashboard,
  Calendar,
  Users,
  BadgeCheck,
  BarChart3,
  Award,
  FileText,
  ScanLine,
  Settings as SettingsIcon,
  LogOut,
  Menu,
  X,
  Store,
  Inbox,
  Gift,
  Landmark,
} from 'lucide-react';
import { useAuth } from '../hooks/useAuth';
import { usePendingTierRequestCount } from '../hooks/useTierRequests';

type NavItem = { name: string; href: string; icon: typeof LayoutDashboard };
type NavGroup = { label?: string; items: NavItem[] };

const navGroups: NavGroup[] = [
  { items: [{ name: 'Dashboard', href: '/', icon: LayoutDashboard }] },
  {
    label: 'Events',
    items: [
      { name: 'Events', href: '/campaigns', icon: Calendar },
      { name: 'Units', href: '/agents', icon: Users },
      { name: 'Tiers', href: '/tiers', icon: BadgeCheck },
      { name: 'Reports', href: '/reports', icon: BarChart3 },
      { name: 'Rewards', href: '/rewards', icon: Award },
      { name: 'PDF Export', href: '/pdf-export', icon: FileText },
      { name: 'Check-In', href: '/check-in', icon: ScanLine },
    ],
  },
  {
    label: 'Partnership',
    items: [
      { name: 'Partnerships', href: '/merchants', icon: Store },
      { name: 'Enquiries', href: '/enquiries', icon: Inbox },
      { name: 'Gifts', href: '/gifts', icon: Gift },
      { name: 'Settlements', href: '/settlements', icon: Landmark },
    ],
  },
  { items: [{ name: 'Settings', href: '/settings', icon: SettingsIcon }] },
];

export function Layout({ children }: { children: React.ReactNode }) {
  const location = useLocation();
  const navigate = useNavigate();
  const { user, signOut } = useAuth();
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const { data: pendingTierCount } = usePendingTierRequestCount();

  const handleLogout = async () => {
    await signOut();
    navigate({ to: '/login' });
  };

  const renderNav = (onNavigate?: () => void) =>
    navGroups.map((group, gi) => (
      <div key={group.label ?? `group-${gi}`} className={group.label ? 'pt-3' : ''}>
        {group.label && (
          <p className="px-3 pb-1 text-xs font-semibold uppercase tracking-wider text-slate-400/80">
            {group.label}
          </p>
        )}
        {group.items.map((item) => {
          const isActive =
            location.pathname === item.href ||
            (item.href !== '/' && location.pathname.startsWith(item.href));
          return (
            <Link
              key={item.name}
              to={item.href}
              onClick={onNavigate}
              className={cn(
                'flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all duration-200',
                isActive
                  ? 'bg-white/12 text-white shadow-sm border-l-2 border-indigo-400 pl-[10px]'
                  : 'text-slate-300 hover:bg-white/8 hover:text-white'
              )}
            >
              <item.icon className={cn('size-5', isActive && 'text-indigo-300')} />
              {item.name}
              {item.name === 'Units' && pendingTierCount ? (
                <span className="ml-auto inline-flex items-center justify-center rounded-full bg-amber-500 text-white text-xs font-medium px-1.5 py-0.5 min-w-[1.25rem]">
                  {pendingTierCount}
                </span>
              ) : null}
            </Link>
          );
        })}
      </div>
    ));

  return (
    <div className="min-h-screen bg-background">
      {/* Mobile menu overlay */}
      {isMobileMenuOpen && (
        <div
          className="fixed inset-0 z-40 bg-slate-900/60 backdrop-blur-sm lg:hidden"
          onClick={() => setIsMobileMenuOpen(false)}
        />
      )}

      {/* Sidebar - Desktop */}
      <aside className="hidden lg:flex lg:flex-col lg:w-64 lg:fixed lg:inset-y-0 lg:z-30 bg-gradient-to-b from-indigo-950 via-[#1a1942] to-slate-900 text-white">
        <div className="flex h-16 items-center gap-3 px-6 border-b border-white/10">
          <Logo size="md" showText={false} />
          <span className="font-semibold text-lg tracking-tight">RACC Admin</span>
        </div>
        <nav className="flex-1 px-3 py-4 space-y-0.5 overflow-y-auto scrollbar-thin">
          {renderNav()}
        </nav>
        <div className="p-4 border-t border-white/10">
          <div className="text-sm text-slate-400 truncate mb-2">{user?.email}</div>
          <Button
            variant="ghost"
            size="sm"
            onClick={handleLogout}
            className="w-full justify-start text-slate-300 hover:text-white hover:bg-white/8"
          >
            <LogOut className="size-4 mr-2" />
            Logout
          </Button>
        </div>
      </aside>

      {/* Sidebar - Mobile */}
      <aside
        className={cn(
          'fixed inset-y-0 left-0 z-50 w-64 lg:hidden bg-gradient-to-b from-indigo-950 via-[#1a1942] to-slate-900 text-white',
          'transform transition-transform duration-200 ease-out',
          isMobileMenuOpen ? 'translate-x-0' : '-translate-x-full'
        )}
      >
        <div className="flex h-16 items-center justify-between px-6 border-b border-white/10">
          <div className="flex items-center gap-3">
            <Logo size="md" showText={false} />
            <span className="font-semibold text-lg tracking-tight">RACC Admin</span>
          </div>
          <button
            onClick={() => setIsMobileMenuOpen(false)}
            className="p-1 rounded-md hover:bg-white/10"
          >
            <X className="size-5" />
          </button>
        </div>
        <nav className="flex-1 px-3 py-4 space-y-0.5 overflow-y-auto">
          {renderNav(() => setIsMobileMenuOpen(false))}
        </nav>
        <div className="p-4 border-t border-white/10">
          <div className="text-sm text-slate-400 truncate mb-2">{user?.email}</div>
          <Button
            variant="ghost"
            size="sm"
            onClick={handleLogout}
            className="w-full justify-start text-slate-300 hover:text-white hover:bg-white/8"
          >
            <LogOut className="size-4 mr-2" />
            Logout
          </Button>
        </div>
      </aside>

      {/* Main content */}
      <div className="lg:pl-64">
        {/* Header */}
        <header className="sticky top-0 z-30 flex items-center h-16 px-4 bg-white/80 backdrop-blur-sm border-b border">
          {/* Mobile menu button */}
          <button
            onClick={() => setIsMobileMenuOpen(true)}
            className="lg:hidden p-2 -ml-2 rounded-md hover:bg-muted"
            aria-label="Open menu"
          >
            <Menu className="size-5" />
          </button>

          {/* Desktop header content */}
          <div className="hidden lg:flex flex-1 items-center justify-end">
            <div className="flex items-center gap-4">
              <span className="text-sm text-muted-foreground">{user?.email}</span>
              <Button variant="ghost" size="sm" onClick={handleLogout}>
                <LogOut className="size-4 mr-2" />
                Logout
              </Button>
            </div>
          </div>

          {/* Mobile header content */}
          <div className="flex lg:hidden flex-1 items-center justify-center">
            <span className="font-semibold text-foreground">RACC Admin</span>
          </div>
        </header>

        {/* Page content */}
        <main className="p-4 lg:p-6">{children}</main>
      </div>
    </div>
  );
}
