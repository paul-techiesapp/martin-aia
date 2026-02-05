import { useState } from 'react';
import { Link, useLocation } from '@tanstack/react-router';
import { cn, Button, Sheet, SheetContent, SheetTrigger } from '@agent-system/shared-ui';
import { Home, Calendar, Send, Award, LogOut, Menu, Users } from 'lucide-react';
import { useAuth } from '../hooks/useAuth';

const navigation = [
  { name: 'Dashboard', href: '/', icon: Home },
  { name: 'Campaigns', href: '/campaigns', icon: Calendar },
  { name: 'My Invitations', href: '/invitations', icon: Send },
  { name: 'Rewards', href: '/rewards', icon: Award },
];

export function Layout({ children }: { children: React.ReactNode }) {
  const location = useLocation();
  const { agent, signOut } = useAuth();
  const [mobileOpen, setMobileOpen] = useState(false);

  const SidebarContent = () => (
    <>
      <div className="flex h-16 items-center gap-3 px-6 border-b border-white/10">
        <div className="h-9 w-9 rounded-xl bg-sky-600 flex items-center justify-center shadow-lg">
          <Users className="h-5 w-5 text-white" />
        </div>
        <span className="font-semibold text-lg text-white">Agent Portal</span>
      </div>
      <nav className="p-4 space-y-1">
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
                  ? 'bg-white/15 text-white shadow-sm'
                  : 'text-slate-300 hover:bg-white/10 hover:text-white'
              )}
            >
              <item.icon className="h-5 w-5" />
              {item.name}
            </Link>
          );
        })}
      </nav>
    </>
  );

  return (
    <div className="min-h-screen bg-slate-50">
      {/* Desktop Sidebar */}
      <div className="hidden lg:fixed lg:inset-y-0 lg:left-0 lg:z-50 lg:w-64 lg:flex lg:flex-col bg-slate-900">
        <SidebarContent />
      </div>

      {/* Mobile Sidebar */}
      <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
        <SheetContent side="left" className="w-64 p-0 bg-slate-900 border-r-0">
          <SidebarContent />
        </SheetContent>
      </Sheet>

      {/* Main content */}
      <div className="lg:pl-64">
        <header className="sticky top-0 z-40 h-16 bg-white/80 backdrop-blur-md border-b border-slate-200/60 shadow-sm">
          <div className="flex h-16 items-center justify-between px-4 lg:px-6">
            <div className="flex items-center gap-4">
              {/* Mobile menu trigger */}
              <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
                <SheetTrigger asChild>
                  <Button variant="ghost" size="sm" className="lg:hidden h-9 w-9 p-0">
                    <Menu className="h-5 w-5" />
                  </Button>
                </SheetTrigger>
              </Sheet>
              {agent && (
                <p className="text-sm text-slate-500">
                  Welcome, <span className="font-medium text-slate-900">{agent.name}</span>
                  {' '}• <span className="text-sky-600 font-medium">{agent.tier?.name}</span>
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
