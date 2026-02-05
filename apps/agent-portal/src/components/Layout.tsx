import { Link, useLocation } from '@tanstack/react-router';
import { cn } from '@agent-system/shared-ui';
import { Home, Calendar, Send, Award, LogOut } from 'lucide-react';
import { useAuth } from '../hooks/useAuth';
import { Button } from '@agent-system/shared-ui';

const navigation = [
  { name: 'Dashboard', href: '/', icon: Home },
  { name: 'Campaigns', href: '/campaigns', icon: Calendar },
  { name: 'My Invitations', href: '/invitations', icon: Send },
  { name: 'Rewards', href: '/rewards', icon: Award },
];

export function Layout({ children }: { children: React.ReactNode }) {
  const location = useLocation();
  const { agent, signOut } = useAuth();

  return (
    <div className="min-h-screen bg-background">
      {/* Sidebar */}
      <div className="fixed inset-y-0 left-0 z-50 w-64 bg-card border-r">
        <div className="flex h-16 items-center gap-2 px-6 border-b">
          <div className="h-8 w-8 rounded-lg bg-primary flex items-center justify-center">
            <span className="text-primary-foreground font-bold">A</span>
          </div>
          <span className="font-semibold text-lg">Agent Portal</span>
        </div>
        <nav className="p-4 space-y-1">
          {navigation.map((item) => {
            const isActive = location.pathname === item.href ||
              (item.href !== '/' && location.pathname.startsWith(item.href));
            return (
              <Link
                key={item.name}
                to={item.href}
                className={cn(
                  'flex items-center gap-3 px-3 py-2 rounded-md text-sm font-medium transition-colors',
                  isActive
                    ? 'bg-primary text-primary-foreground'
                    : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground'
                )}
              >
                <item.icon className="h-5 w-5" />
                {item.name}
              </Link>
            );
          })}
        </nav>
      </div>

      {/* Main content */}
      <div className="pl-64">
        <header className="sticky top-0 z-40 h-16 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60 border-b">
          <div className="flex h-16 items-center justify-between px-6">
            <div>
              {agent && (
                <p className="text-sm text-muted-foreground">
                  Welcome, <span className="font-medium text-foreground">{agent.name}</span>
                  {' '}• {agent.tier?.name}
                </p>
              )}
            </div>
            <Button variant="ghost" size="sm" onClick={signOut}>
              <LogOut className="h-4 w-4 mr-2" />
              Sign Out
            </Button>
          </div>
        </header>
        <main className="p-6">{children}</main>
      </div>
    </div>
  );
}
