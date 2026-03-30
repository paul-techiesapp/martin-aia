import { useState } from 'react';
import { Link, useLocation } from '@tanstack/react-router';
import { cn, Button, Sheet, SheetContent, SheetTrigger, Logo } from '@agent-system/shared-ui';
import { LayoutDashboard, CalendarDays, Link2, Award, LogOut, Menu, Users, UserCog } from 'lucide-react';
import { useAuth } from '../hooks/useAuth';

const agentAdminNavigation = [
  { name: 'Dashboard', href: '/', icon: LayoutDashboard },
  { name: 'Events', href: '/campaigns', icon: CalendarDays },
  { name: 'My Links', href: '/my-links', icon: Link2 },
  { name: 'Rewards', href: '/rewards', icon: Award },
  { name: 'My Agents', href: '/my-agents', icon: UserCog },
  { name: 'Partners', href: '/partners', icon: Users },
];

const agentNavigation = [
  { name: 'Dashboard', href: '/', icon: LayoutDashboard },
  { name: 'Events', href: '/campaigns', icon: CalendarDays },
  { name: 'My Links', href: '/my-links', icon: Link2 },
  { name: 'Rewards', href: '/rewards', icon: Award },
];

const partnerNavigation = [
  { name: 'Dashboard', href: '/', icon: LayoutDashboard },
  { name: 'My Links', href: '/partner-links', icon: Link2 },
];

export function Layout({ children }: { children: React.ReactNode }) {
  const location = useLocation();
  const { agent, partner, role, signOut } = useAuth();
  const [mobileOpen, setMobileOpen] = useState(false);

  const navigation = role === 'partner'
    ? partnerNavigation
    : role === 'agent_admin'
      ? agentAdminNavigation
      : agentNavigation;

  const displayName = role === 'partner' ? partner?.name : agent?.name;
  const subtitle = role === 'partner'
    ? `Partner · ${partner?.agent?.name ?? 'Unknown Unit'}`
    : role === 'agent_admin'
      ? 'Unit Administrator'
      : agent?.tier?.name ?? 'No Tier';

  const SidebarContent = () => (
    <>
      <div className="flex h-16 items-center gap-3 px-6 border-b border-white/10">
        <Logo size="md" showText={false} />
        <span className="font-semibold text-lg text-white tracking-tight">
          {role === 'partner' ? 'RACC Partner' : 'RACC Unit'}
        </span>
      </div>
      <nav className="px-3 py-4 space-y-0.5">
        {navigation.map((item) => {
          const isActive = location.pathname === item.href ||
            (item.href !== '/' && location.pathname.startsWith(item.href));
          return (
            <Link
              key={item.name}
              to={item.href}
              onClick={() => setMobileOpen(false)}
              className={cn(
                'flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all duration-200',
                isActive
                  ? 'bg-white/12 text-white shadow-sm border-l-2 border-indigo-400 pl-[10px]'
                  : 'text-slate-300 hover:bg-white/8 hover:text-white'
              )}
            >
              <item.icon className={cn("size-5", isActive && "text-indigo-300")} />
              {item.name}
            </Link>
          );
        })}
      </nav>
    </>
  );

  return (
    <div className="min-h-screen bg-background">
      <div className="hidden lg:fixed lg:inset-y-0 lg:left-0 lg:z-50 lg:w-64 lg:flex lg:flex-col bg-gradient-to-b from-indigo-950 via-[#1a1942] to-slate-900">
        <SidebarContent />
      </div>

      <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
        <SheetContent side="left" className="w-64 p-0 bg-gradient-to-b from-indigo-950 via-[#1a1942] to-slate-900 border-r-0">
          <SidebarContent />
        </SheetContent>
      </Sheet>

      <div className="lg:pl-64">
        <header className="sticky top-0 z-40 h-16 bg-background/80 backdrop-blur-md border-b border-border shadow-sm">
          <div className="flex h-16 items-center justify-between px-4 lg:px-6">
            <div className="flex items-center gap-4">
              <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
                <SheetTrigger asChild>
                  <Button variant="ghost" size="sm" className="lg:hidden size-9 p-0">
                    <Menu className="size-5" />
                  </Button>
                </SheetTrigger>
              </Sheet>
              {displayName && (
                <p className="text-sm text-muted-foreground">
                  Welcome, <span className="font-medium text-foreground">{displayName}</span>
                  {subtitle && (
                    <>{' '}· <span className="text-sky-600 font-medium">{subtitle}</span></>
                  )}
                </p>
              )}
            </div>
            <Button
              variant="ghost"
              size="sm"
              onClick={signOut}
              className="text-muted-foreground hover:text-foreground hover:bg-muted"
            >
              <LogOut className="size-4 mr-2" />
              Sign Out
            </Button>
          </div>
        </header>
        <main className="p-4 lg:p-6">{children}</main>
      </div>
    </div>
  );
}
