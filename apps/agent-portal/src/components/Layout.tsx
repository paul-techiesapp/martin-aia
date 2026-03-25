import { useState } from 'react';
import { Link, useLocation } from '@tanstack/react-router';
import { cn, Button, Sheet, SheetContent, SheetTrigger, Logo } from '@agent-system/shared-ui';
import { Home, Calendar, Link2, Award, LogOut, Menu, Users } from 'lucide-react';
import { useAuth } from '../hooks/useAuth';

const agentNavigation = [
  { name: 'Dashboard', href: '/', icon: Home },
  { name: 'Events', href: '/campaigns', icon: Calendar },
  { name: 'My Links', href: '/my-links', icon: Link2 },
  { name: 'Rewards', href: '/rewards', icon: Award },
  { name: 'Partners', href: '/partners', icon: Users },
];

const partnerNavigation = [
  { name: 'Dashboard', href: '/', icon: Home },
  { name: 'My Links', href: '/partner-links', icon: Link2 },
];

export function Layout({ children }: { children: React.ReactNode }) {
  const location = useLocation();
  const { agent, partner, role, signOut } = useAuth();
  const [mobileOpen, setMobileOpen] = useState(false);

  const navigation = role === 'partner' ? partnerNavigation : agentNavigation;
  const displayName = role === 'partner' ? partner?.name : agent?.name;
  const subtitle = role === 'partner'
    ? `Partner · ${partner?.agent?.name ?? 'Unknown Unit'}`
    : agent?.tier?.name;

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
              <item.icon className={cn("h-5 w-5", isActive && "text-indigo-300")} />
              {item.name}
            </Link>
          );
        })}
      </nav>
    </>
  );

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="hidden lg:fixed lg:inset-y-0 lg:left-0 lg:z-50 lg:w-64 lg:flex lg:flex-col bg-gradient-to-b from-indigo-950 via-[#1a1942] to-slate-900">
        <SidebarContent />
      </div>

      <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
        <SheetContent side="left" className="w-64 p-0 bg-gradient-to-b from-indigo-950 via-[#1a1942] to-slate-900 border-r-0">
          <SidebarContent />
        </SheetContent>
      </Sheet>

      <div className="lg:pl-64">
        <header className="sticky top-0 z-40 h-16 bg-white/80 backdrop-blur-md border-b border-slate-200/60 shadow-sm">
          <div className="flex h-16 items-center justify-between px-4 lg:px-6">
            <div className="flex items-center gap-4">
              <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
                <SheetTrigger asChild>
                  <Button variant="ghost" size="sm" className="lg:hidden h-9 w-9 p-0">
                    <Menu className="h-5 w-5" />
                  </Button>
                </SheetTrigger>
              </Sheet>
              {displayName && (
                <p className="text-sm text-slate-500">
                  Welcome, <span className="font-medium text-slate-900">{displayName}</span>
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
              className="text-slate-600 hover:text-slate-900 hover:bg-slate-100"
            >
              <LogOut className="h-4 w-4 mr-2" />
              Sign Out
            </Button>
          </div>
        </header>
        <main className="p-4 lg:p-6">{children}</main>
      </div>
    </div>
  );
}
