import { useState, Fragment } from 'react';
import { Link, useLocation } from '@tanstack/react-router';
import { cn, Button, Sheet, SheetContent, SheetTrigger, Logo, Avatar } from '@agent-system/shared-ui';
import { LayoutDashboard, CalendarDays, Link2, Award, LogOut, Menu, Users, UserCog, KeyRound, ClipboardList, QrCode, Inbox, type LucideIcon } from 'lucide-react';
import { useAuth } from '../hooks/useAuth';
import { useMyAgentPhoto } from '../hooks/useAgentPhoto';

type NavItem = { name: string; href: string; icon: LucideIcon };
type NavGroup = { label?: string; items: NavItem[] };

const agentAdminGroups: NavGroup[] = [
  { items: [{ name: 'Dashboard', href: '/', icon: LayoutDashboard }] },
  {
    label: 'Events',
    items: [
      { name: 'Events', href: '/campaigns', icon: CalendarDays },
      { name: 'My Links', href: '/my-links', icon: Link2 },
      { name: 'Rewards', href: '/rewards', icon: Award },
      { name: 'My Agents', href: '/my-agents', icon: UserCog },
      { name: 'Team Report', href: '/team-report', icon: ClipboardList },
      { name: 'Partners', href: '/partners', icon: Users },
    ],
  },
  {
    label: 'Partnership',
    items: [
      { name: 'My Link', href: '/my-link', icon: QrCode },
      { name: 'My Enquiries', href: '/my-enquiries', icon: Inbox },
    ],
  },
  { items: [{ name: 'Account', href: '/account', icon: KeyRound }] },
];

const agentGroups: NavGroup[] = [
  { items: [{ name: 'Dashboard', href: '/', icon: LayoutDashboard }] },
  {
    label: 'Events',
    items: [
      { name: 'Events', href: '/campaigns', icon: CalendarDays },
      { name: 'My Links', href: '/my-links', icon: Link2 },
      { name: 'Rewards', href: '/rewards', icon: Award },
    ],
  },
  {
    label: 'Partnership',
    items: [
      { name: 'My Link', href: '/my-link', icon: QrCode },
      { name: 'My Enquiries', href: '/my-enquiries', icon: Inbox },
    ],
  },
  { items: [{ name: 'Account', href: '/account', icon: KeyRound }] },
];

const partnerGroups: NavGroup[] = [
  {
    items: [
      { name: 'Dashboard', href: '/', icon: LayoutDashboard },
      { name: 'My Links', href: '/partner-links', icon: Link2 },
      { name: 'Account', href: '/account', icon: KeyRound },
    ],
  },
];

export function Layout({ children }: { children: React.ReactNode }) {
  const location = useLocation();
  const { agent, partner, role, isLoading, session, signOut, user } = useAuth();
  const { data: photoUrl } = useMyAgentPhoto(user?.id);
  const [mobileOpen, setMobileOpen] = useState(false);

  // Authenticated but not linked to any agent/partner profile. Previously the
  // app called signOut() here, which silently bounced the user back to /login
  // on every load. Keep the session and show a clear message instead.
  if (!isLoading && session && !role) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background p-4">
        <div className="max-w-md text-center space-y-4">
          <h1 className="text-xl font-semibold text-foreground">Account not linked</h1>
          <p className="text-muted-foreground">
            You're signed in, but this account isn't linked to an agent or partner
            profile yet. Please contact your administrator to finish setting it up.
          </p>
          <Button variant="outline" onClick={signOut}>
            <LogOut className="size-4 mr-2" />
            Sign Out
          </Button>
        </div>
      </div>
    );
  }

  const navGroups = role === 'partner'
    ? partnerGroups
    : role === 'agent_admin'
      ? agentAdminGroups
      : agentGroups;

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
        {navGroups.map((group, gi) => (
          <Fragment key={group.label ?? `group-${gi}`}>
            {group.label && (
              <p className="px-3 pt-4 pb-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                {group.label}
              </p>
            )}
            {group.items.map((item) => {
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
          </Fragment>
        ))}
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
              {role !== 'partner' && <Avatar src={photoUrl} name={displayName} size="sm" />}
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
