import { ReactNode, useEffect } from 'react';
import { useLocation, useNavigate } from '@tanstack/react-router';
import { useAuth } from '../hooks/useAuth';

interface ProtectedRouteProps {
  children: ReactNode;
}

/**
 * Paths an event-staff (organising team) login may open. Everything else in the
 * admin portal is admin-only. This is a UX guard — the real boundary is RLS and
 * admin_check_in, which only expose the staff member's assigned events.
 */
const STAFF_PATHS = ['/check-in', '/venue-display/'];

export function isStaffPath(pathname: string) {
  return STAFF_PATHS.some((p) => pathname === p || pathname.startsWith(p));
}

export function ProtectedRoute({ children }: ProtectedRouteProps) {
  const { user, isLoading, isAdmin, isEventStaff } = useAuth();
  const navigate = useNavigate();
  const { pathname } = useLocation();

  const staffOutOfScope = isEventStaff && !isStaffPath(pathname);

  useEffect(() => {
    if (isLoading) return;
    if (!user || (!isAdmin && !isEventStaff)) {
      navigate({ to: '/login' });
    } else if (staffOutOfScope) {
      navigate({ to: '/check-in' });
    }
  }, [user, isLoading, isAdmin, isEventStaff, staffOutOfScope, navigate]);

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
      </div>
    );
  }

  if (!user || (!isAdmin && !isEventStaff) || staffOutOfScope) {
    return null;
  }

  return <>{children}</>;
}
