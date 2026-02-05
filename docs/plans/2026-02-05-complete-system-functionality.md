# Complete System Functionality Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Make the Agent Onboarding System fully functional by adding admin authentication, fixing broken features, and completing partial implementations.

**Architecture:** Add Supabase Auth to admin portal with protected routes, fix PDF export by creating the missing page, replace mock data in reports with real Supabase queries, and complete dashboard statistics.

**Tech Stack:** React 18, Supabase Auth, TanStack Router, TanStack Query, react-hook-form, zod, jspdf, recharts

---

## Critical Issues to Fix

1. ❌ Admin Portal has no authentication (security vulnerability)
2. ❌ PDF Export page missing (route exists, component doesn't)
3. ⚠️ Reports using mock data instead of real queries
4. ⚠️ Dashboard stats incomplete (showing `-` for several metrics)
5. ⚠️ Agent Portal rewards showing hardcoded `confirmedRewards = 0`

---

## Task 1: Admin Portal Authentication - Auth Hook

**Files:**
- Create: `apps/admin-portal/src/hooks/useAuth.ts`

**Step 1: Create the auth hook**

```typescript
import { useEffect, useState } from 'react';
import { User, Session } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';

interface AuthState {
  user: User | null;
  session: Session | null;
  isLoading: boolean;
  isAdmin: boolean;
}

export function useAuth() {
  const [authState, setAuthState] = useState<AuthState>({
    user: null,
    session: null,
    isLoading: true,
    isAdmin: false,
  });

  useEffect(() => {
    // Get initial session
    supabase.auth.getSession().then(({ data: { session } }) => {
      const user = session?.user ?? null;
      const isAdmin = user?.user_metadata?.role === 'admin';
      setAuthState({
        user,
        session,
        isLoading: false,
        isAdmin,
      });
    });

    // Listen for auth changes
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (_event, session) => {
        const user = session?.user ?? null;
        const isAdmin = user?.user_metadata?.role === 'admin';
        setAuthState({
          user,
          session,
          isLoading: false,
          isAdmin,
        });
      }
    );

    return () => subscription.unsubscribe();
  }, []);

  const signIn = async (email: string, password: string) => {
    const { data, error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });
    if (error) throw error;
    return data;
  };

  const signOut = async () => {
    const { error } = await supabase.auth.signOut();
    if (error) throw error;
  };

  return {
    ...authState,
    signIn,
    signOut,
  };
}
```

**Step 2: Verify file created**

Run: `cat apps/admin-portal/src/hooks/useAuth.ts | head -20`
Expected: Shows the hook code starting with imports

**Step 3: Commit**

```bash
git add apps/admin-portal/src/hooks/useAuth.ts
git commit -m "feat(admin): add useAuth hook for authentication"
```

---

## Task 2: Admin Portal Authentication - Login Page

**Files:**
- Create: `apps/admin-portal/src/pages/Login.tsx`

**Step 1: Create the login page**

```typescript
import { useState } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Input,
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@agent-system/shared-ui';
import { Shield } from 'lucide-react';
import { useAuth } from '../hooks/useAuth';

const loginSchema = z.object({
  email: z.string().email('Invalid email address'),
  password: z.string().min(6, 'Password must be at least 6 characters'),
});

type LoginFormData = z.infer<typeof loginSchema>;

export function Login() {
  const navigate = useNavigate();
  const { signIn } = useAuth();
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const form = useForm<LoginFormData>({
    resolver: zodResolver(loginSchema),
    defaultValues: {
      email: '',
      password: '',
    },
  });

  const onSubmit = async (data: LoginFormData) => {
    setIsLoading(true);
    setError(null);

    try {
      const { user } = await signIn(data.email, data.password);

      // Check if user is admin
      if (user?.user_metadata?.role !== 'admin') {
        setError('Access denied. Admin privileges required.');
        setIsLoading(false);
        return;
      }

      navigate({ to: '/' });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Login failed');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <div className="h-12 w-12 rounded-full bg-primary flex items-center justify-center mx-auto mb-4">
            <Shield className="h-6 w-6 text-primary-foreground" />
          </div>
          <CardTitle className="text-2xl">Admin Portal</CardTitle>
          <CardDescription>
            Sign in to access the administration dashboard
          </CardDescription>
        </CardHeader>
        <CardContent>
          {error && (
            <div className="p-3 mb-4 text-sm text-destructive bg-destructive/10 rounded-md">
              {error}
            </div>
          )}

          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
              <FormField
                control={form.control}
                name="email"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Email</FormLabel>
                    <FormControl>
                      <Input
                        type="email"
                        placeholder="admin@example.com"
                        {...field}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="password"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Password</FormLabel>
                    <FormControl>
                      <Input type="password" placeholder="••••••••" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <Button type="submit" className="w-full" disabled={isLoading}>
                {isLoading ? 'Signing in...' : 'Sign In'}
              </Button>
            </form>
          </Form>
        </CardContent>
      </Card>
    </div>
  );
}
```

**Step 2: Verify file created**

Run: `cat apps/admin-portal/src/pages/Login.tsx | head -20`
Expected: Shows the login page code

**Step 3: Commit**

```bash
git add apps/admin-portal/src/pages/Login.tsx
git commit -m "feat(admin): add login page with form validation"
```

---

## Task 3: Admin Portal Authentication - Protected Route Component

**Files:**
- Create: `apps/admin-portal/src/components/ProtectedRoute.tsx`

**Step 1: Create protected route wrapper**

```typescript
import { ReactNode, useEffect } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { useAuth } from '../hooks/useAuth';

interface ProtectedRouteProps {
  children: ReactNode;
}

export function ProtectedRoute({ children }: ProtectedRouteProps) {
  const { user, isLoading, isAdmin } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    if (!isLoading && (!user || !isAdmin)) {
      navigate({ to: '/login' });
    }
  }, [user, isLoading, isAdmin, navigate]);

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
      </div>
    );
  }

  if (!user || !isAdmin) {
    return null;
  }

  return <>{children}</>;
}
```

**Step 2: Verify file created**

Run: `cat apps/admin-portal/src/components/ProtectedRoute.tsx`
Expected: Shows the protected route component

**Step 3: Commit**

```bash
git add apps/admin-portal/src/components/ProtectedRoute.tsx
git commit -m "feat(admin): add ProtectedRoute component for auth guards"
```

---

## Task 4: Admin Portal Authentication - Update Router

**Files:**
- Modify: `apps/admin-portal/src/router.tsx`

**Step 1: Read current router file**

Run: `cat apps/admin-portal/src/router.tsx`

**Step 2: Update router with login route and protected routes**

Replace the entire router.tsx with:

```typescript
import { createRouter, createRoute, createRootRoute, Outlet } from '@tanstack/react-router';
import { Layout } from './components/Layout';
import { ProtectedRoute } from './components/ProtectedRoute';
import { Login } from './pages/Login';
import { Dashboard } from './pages/Dashboard';
import { CampaignList } from './pages/campaigns/CampaignList';
import { CampaignForm } from './pages/campaigns/CampaignForm';
import { CampaignDetail } from './pages/campaigns/CampaignDetail';
import { AgentList } from './pages/agents/AgentList';
import { AgentForm } from './pages/agents/AgentForm';
import { TierList } from './pages/tiers/TierList';
import { PinCodes } from './pages/PinCodes';
import { Reports } from './pages/Reports';
import { PdfExport } from './pages/PdfExport';

// Root route
const rootRoute = createRootRoute({
  component: () => <Outlet />,
});

// Login route (public)
const loginRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/login',
  component: Login,
});

// Protected layout route
const protectedLayoutRoute = createRoute({
  getParentRoute: () => rootRoute,
  id: 'protected',
  component: () => (
    <ProtectedRoute>
      <Layout>
        <Outlet />
      </Layout>
    </ProtectedRoute>
  ),
});

// Dashboard
const indexRoute = createRoute({
  getParentRoute: () => protectedLayoutRoute,
  path: '/',
  component: Dashboard,
});

// Campaigns
const campaignsRoute = createRoute({
  getParentRoute: () => protectedLayoutRoute,
  path: '/campaigns',
  component: CampaignList,
});

const newCampaignRoute = createRoute({
  getParentRoute: () => protectedLayoutRoute,
  path: '/campaigns/new',
  component: CampaignForm,
});

const editCampaignRoute = createRoute({
  getParentRoute: () => protectedLayoutRoute,
  path: '/campaigns/$campaignId/edit',
  component: CampaignForm,
});

const campaignDetailRoute = createRoute({
  getParentRoute: () => protectedLayoutRoute,
  path: '/campaigns/$campaignId',
  component: CampaignDetail,
});

// Agents
const agentsRoute = createRoute({
  getParentRoute: () => protectedLayoutRoute,
  path: '/agents',
  component: AgentList,
});

const newAgentRoute = createRoute({
  getParentRoute: () => protectedLayoutRoute,
  path: '/agents/new',
  component: AgentForm,
});

const editAgentRoute = createRoute({
  getParentRoute: () => protectedLayoutRoute,
  path: '/agents/$agentId/edit',
  component: AgentForm,
});

// Tiers
const tiersRoute = createRoute({
  getParentRoute: () => protectedLayoutRoute,
  path: '/tiers',
  component: TierList,
});

// PIN Codes
const pinCodesRoute = createRoute({
  getParentRoute: () => protectedLayoutRoute,
  path: '/pin-codes',
  component: PinCodes,
});

// Reports
const reportsRoute = createRoute({
  getParentRoute: () => protectedLayoutRoute,
  path: '/reports',
  component: Reports,
});

// PDF Export
const pdfExportRoute = createRoute({
  getParentRoute: () => protectedLayoutRoute,
  path: '/pdf-export',
  component: PdfExport,
});

// Route tree
const routeTree = rootRoute.addChildren([
  loginRoute,
  protectedLayoutRoute.addChildren([
    indexRoute,
    campaignsRoute,
    newCampaignRoute,
    editCampaignRoute,
    campaignDetailRoute,
    agentsRoute,
    newAgentRoute,
    editAgentRoute,
    tiersRoute,
    pinCodesRoute,
    reportsRoute,
    pdfExportRoute,
  ]),
]);

// Create router
export const router = createRouter({ routeTree });

// Type declaration
declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
}
```

**Step 3: Verify router updated**

Run: `grep -n "loginRoute\|ProtectedRoute" apps/admin-portal/src/router.tsx`
Expected: Shows lines with loginRoute and ProtectedRoute imports/usage

**Step 4: Commit**

```bash
git add apps/admin-portal/src/router.tsx
git commit -m "feat(admin): protect all routes with authentication"
```

---

## Task 5: Admin Portal - Update Layout with Logout

**Files:**
- Modify: `apps/admin-portal/src/components/Layout.tsx`

**Step 1: Read current layout**

Run: `cat apps/admin-portal/src/components/Layout.tsx`

**Step 2: Add logout button to layout**

Add these imports at the top:
```typescript
import { useAuth } from '../hooks/useAuth';
import { LogOut } from 'lucide-react';
```

Add in the component before return:
```typescript
const { user, signOut } = useAuth();
const navigate = useNavigate();

const handleLogout = async () => {
  await signOut();
  navigate({ to: '/login' });
};
```

Add logout button in the header section (after the navigation, before closing header tag):
```typescript
<div className="flex items-center gap-4">
  <span className="text-sm text-muted-foreground">{user?.email}</span>
  <Button variant="ghost" size="sm" onClick={handleLogout}>
    <LogOut className="h-4 w-4 mr-2" />
    Logout
  </Button>
</div>
```

**Step 3: Verify layout updated**

Run: `grep -n "signOut\|handleLogout" apps/admin-portal/src/components/Layout.tsx`
Expected: Shows lines with signOut and handleLogout

**Step 4: Commit**

```bash
git add apps/admin-portal/src/components/Layout.tsx
git commit -m "feat(admin): add logout button to layout header"
```

---

## Task 6: Fix PDF Export Page

**Files:**
- Create: `apps/admin-portal/src/pages/PdfExport.tsx`

**Step 1: Create the PDF export page**

```typescript
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import jsPDF from 'jspdf';
import html2canvas from 'html2canvas';
import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@agent-system/shared-ui';
import { FileDown, Loader2 } from 'lucide-react';
import { supabase } from '../lib/supabase';

export function PdfExport() {
  const [selectedCampaign, setSelectedCampaign] = useState<string>('');
  const [isExporting, setIsExporting] = useState(false);

  const { data: campaigns } = useQuery({
    queryKey: ['campaigns'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('campaigns')
        .select('*')
        .order('created_at', { ascending: false });
      if (error) throw error;
      return data;
    },
  });

  const { data: reportData } = useQuery({
    queryKey: ['campaign-report', selectedCampaign],
    queryFn: async () => {
      if (!selectedCampaign) return null;

      // Get campaign details
      const { data: campaign } = await supabase
        .from('campaigns')
        .select('*')
        .eq('id', selectedCampaign)
        .single();

      // Get slots with attendance counts
      const { data: slots } = await supabase
        .from('slots')
        .select(`
          *,
          invitations:invitations(count),
          attendance:attendance(count)
        `)
        .eq('campaign_id', selectedCampaign);

      // Get total invitations
      const { count: totalInvitations } = await supabase
        .from('invitations')
        .select('*', { count: 'exact', head: true })
        .in('slot_id', slots?.map(s => s.id) || []);

      // Get attendance records
      const { count: totalAttendance } = await supabase
        .from('attendance')
        .select('*', { count: 'exact', head: true })
        .in('invitation_id',
          (await supabase
            .from('invitations')
            .select('id')
            .in('slot_id', slots?.map(s => s.id) || [])
          ).data?.map(i => i.id) || []
        );

      return {
        campaign,
        slots,
        totalInvitations: totalInvitations || 0,
        totalAttendance: totalAttendance || 0,
      };
    },
    enabled: !!selectedCampaign,
  });

  const handleExport = async () => {
    if (!reportData?.campaign) return;

    setIsExporting(true);
    try {
      const reportElement = document.getElementById('report-content');
      if (!reportElement) return;

      const canvas = await html2canvas(reportElement, { scale: 2 });
      const imgData = canvas.toDataURL('image/png');

      const pdf = new jsPDF('p', 'mm', 'a4');
      const pdfWidth = pdf.internal.pageSize.getWidth();
      const pdfHeight = (canvas.height * pdfWidth) / canvas.width;

      pdf.addImage(imgData, 'PNG', 0, 0, pdfWidth, pdfHeight);
      pdf.save(`${reportData.campaign.name}-report.pdf`);
    } catch (error) {
      console.error('Export failed:', error);
    } finally {
      setIsExporting(false);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold">PDF Export</h1>
        <p className="text-muted-foreground">
          Generate and download campaign reports as PDF
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Select Campaign</CardTitle>
          <CardDescription>
            Choose a campaign to generate the report
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <Select value={selectedCampaign} onValueChange={setSelectedCampaign}>
            <SelectTrigger>
              <SelectValue placeholder="Select a campaign" />
            </SelectTrigger>
            <SelectContent>
              {campaigns?.map((campaign) => (
                <SelectItem key={campaign.id} value={campaign.id}>
                  {campaign.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          {reportData?.campaign && (
            <Button onClick={handleExport} disabled={isExporting}>
              {isExporting ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <FileDown className="h-4 w-4 mr-2" />
              )}
              Export to PDF
            </Button>
          )}
        </CardContent>
      </Card>

      {reportData?.campaign && (
        <Card id="report-content" className="bg-white">
          <CardHeader>
            <CardTitle>{reportData.campaign.name}</CardTitle>
            <CardDescription>
              {new Date(reportData.campaign.start_date).toLocaleDateString()} -{' '}
              {new Date(reportData.campaign.end_date).toLocaleDateString()}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="grid grid-cols-2 gap-4">
              <div className="p-4 bg-muted rounded-lg">
                <p className="text-sm text-muted-foreground">Total Slots</p>
                <p className="text-2xl font-bold">{reportData.slots?.length || 0}</p>
              </div>
              <div className="p-4 bg-muted rounded-lg">
                <p className="text-sm text-muted-foreground">Total Invitations</p>
                <p className="text-2xl font-bold">{reportData.totalInvitations}</p>
              </div>
              <div className="p-4 bg-muted rounded-lg">
                <p className="text-sm text-muted-foreground">Total Attendance</p>
                <p className="text-2xl font-bold">{reportData.totalAttendance}</p>
              </div>
              <div className="p-4 bg-muted rounded-lg">
                <p className="text-sm text-muted-foreground">Attendance Rate</p>
                <p className="text-2xl font-bold">
                  {reportData.totalInvitations > 0
                    ? Math.round((reportData.totalAttendance / reportData.totalInvitations) * 100)
                    : 0}%
                </p>
              </div>
            </div>

            <div>
              <h3 className="font-semibold mb-2">Campaign Details</h3>
              <p className="text-sm text-muted-foreground">
                Location: {reportData.campaign.location || 'Not specified'}
              </p>
              <p className="text-sm text-muted-foreground">
                Status: {reportData.campaign.status}
              </p>
            </div>

            <div className="text-xs text-muted-foreground text-right">
              Generated on {new Date().toLocaleString()}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
```

**Step 2: Verify file created**

Run: `cat apps/admin-portal/src/pages/PdfExport.tsx | head -30`
Expected: Shows the PDF export page code

**Step 3: Commit**

```bash
git add apps/admin-portal/src/pages/PdfExport.tsx
git commit -m "feat(admin): add PDF export page for campaign reports"
```

---

## Task 7: Fix Dashboard Statistics

**Files:**
- Modify: `apps/admin-portal/src/pages/Dashboard.tsx`

**Step 1: Read current dashboard**

Run: `cat apps/admin-portal/src/pages/Dashboard.tsx`

**Step 2: Update dashboard with real data queries**

Replace the stats queries section to fetch real data:

```typescript
// Add these queries after existing campaign query
const { data: agentCount } = useQuery({
  queryKey: ['agent-count'],
  queryFn: async () => {
    const { count, error } = await supabase
      .from('agents')
      .select('*', { count: 'exact', head: true });
    if (error) throw error;
    return count || 0;
  },
});

const { data: todayAttendance } = useQuery({
  queryKey: ['today-attendance'],
  queryFn: async () => {
    const today = new Date().toISOString().split('T')[0];
    const { count, error } = await supabase
      .from('attendance')
      .select('*', { count: 'exact', head: true })
      .gte('checkin_time', `${today}T00:00:00`)
      .lte('checkin_time', `${today}T23:59:59`);
    if (error) throw error;
    return count || 0;
  },
});

const { data: pendingRewards } = useQuery({
  queryKey: ['pending-rewards'],
  queryFn: async () => {
    const { count, error } = await supabase
      .from('rewards')
      .select('*', { count: 'exact', head: true })
      .eq('status', 'pending');
    if (error) throw error;
    return count || 0;
  },
});
```

Update the stats cards to use real values:
- Total Agents: `{agentCount ?? 0}`
- Attendance Today: `{todayAttendance ?? 0}`
- Pending Rewards: `{pendingRewards ?? 0}`

**Step 3: Verify dashboard updated**

Run: `grep -n "agentCount\|todayAttendance\|pendingRewards" apps/admin-portal/src/pages/Dashboard.tsx`
Expected: Shows the new query variables

**Step 4: Commit**

```bash
git add apps/admin-portal/src/pages/Dashboard.tsx
git commit -m "feat(admin): add real-time stats to dashboard"
```

---

## Task 8: Fix Reports Page - Replace Mock Data

**Files:**
- Modify: `apps/admin-portal/src/pages/Reports.tsx`

**Step 1: Read current reports page**

Run: `cat apps/admin-portal/src/pages/Reports.tsx`

**Step 2: Replace mock data with real Supabase queries**

Add real data queries:

```typescript
const { data: reportStats } = useQuery({
  queryKey: ['report-stats'],
  queryFn: async () => {
    // Get campaign stats
    const { count: totalCampaigns } = await supabase
      .from('campaigns')
      .select('*', { count: 'exact', head: true });

    const { count: activeCampaigns } = await supabase
      .from('campaigns')
      .select('*', { count: 'exact', head: true })
      .eq('status', 'active');

    // Get agent stats
    const { count: totalAgents } = await supabase
      .from('agents')
      .select('*', { count: 'exact', head: true });

    // Get invitation stats
    const { count: totalInvitations } = await supabase
      .from('invitations')
      .select('*', { count: 'exact', head: true });

    const { count: registeredInvitations } = await supabase
      .from('invitations')
      .select('*', { count: 'exact', head: true })
      .in('status', ['registered', 'attended', 'completed']);

    // Get attendance stats
    const { count: totalAttendance } = await supabase
      .from('attendance')
      .select('*', { count: 'exact', head: true });

    const { count: fullAttendance } = await supabase
      .from('attendance')
      .select('*', { count: 'exact', head: true })
      .eq('is_full_attendance', true);

    // Get rewards stats
    const { data: rewards } = await supabase
      .from('rewards')
      .select('amount, status');

    const totalRewardsAmount = rewards?.reduce((sum, r) => sum + (r.amount || 0), 0) || 0;
    const paidRewardsAmount = rewards?.filter(r => r.status === 'paid')
      .reduce((sum, r) => sum + (r.amount || 0), 0) || 0;

    return {
      totalCampaigns: totalCampaigns || 0,
      activeCampaigns: activeCampaigns || 0,
      totalAgents: totalAgents || 0,
      totalInvitations: totalInvitations || 0,
      registeredInvitations: registeredInvitations || 0,
      conversionRate: totalInvitations ? Math.round((registeredInvitations || 0) / totalInvitations * 100) : 0,
      totalAttendance: totalAttendance || 0,
      fullAttendance: fullAttendance || 0,
      attendanceRate: totalAttendance ? Math.round((fullAttendance || 0) / (totalAttendance || 1) * 100) : 0,
      totalRewardsAmount,
      paidRewardsAmount,
    };
  },
});

const { data: monthlyData } = useQuery({
  queryKey: ['monthly-invitations'],
  queryFn: async () => {
    const months = [];
    const now = new Date();

    for (let i = 5; i >= 0; i--) {
      const date = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const startOfMonth = date.toISOString().split('T')[0];
      const endOfMonth = new Date(date.getFullYear(), date.getMonth() + 1, 0).toISOString().split('T')[0];

      const { count: invitations } = await supabase
        .from('invitations')
        .select('*', { count: 'exact', head: true })
        .gte('created_at', startOfMonth)
        .lte('created_at', endOfMonth);

      const { count: attendance } = await supabase
        .from('attendance')
        .select('*', { count: 'exact', head: true })
        .gte('checkin_time', startOfMonth)
        .lte('checkin_time', endOfMonth);

      months.push({
        month: date.toLocaleString('default', { month: 'short' }),
        invitations: invitations || 0,
        attendance: attendance || 0,
      });
    }

    return months;
  },
});
```

**Step 3: Update chart data to use real data**

Replace hardcoded `invitationData` with `monthlyData`:
```typescript
<BarChart data={monthlyData || []}>
```

**Step 4: Implement CSV export**

Replace the handleExport function:
```typescript
const handleExport = () => {
  if (!reportStats) return;

  const csvContent = [
    ['Metric', 'Value'],
    ['Total Campaigns', reportStats.totalCampaigns],
    ['Active Campaigns', reportStats.activeCampaigns],
    ['Total Agents', reportStats.totalAgents],
    ['Total Invitations', reportStats.totalInvitations],
    ['Registered Invitations', reportStats.registeredInvitations],
    ['Conversion Rate', `${reportStats.conversionRate}%`],
    ['Total Attendance', reportStats.totalAttendance],
    ['Full Attendance', reportStats.fullAttendance],
    ['Attendance Rate', `${reportStats.attendanceRate}%`],
    ['Total Rewards', `$${reportStats.totalRewardsAmount}`],
    ['Paid Rewards', `$${reportStats.paidRewardsAmount}`],
  ].map(row => row.join(',')).join('\n');

  const blob = new Blob([csvContent], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `report-${new Date().toISOString().split('T')[0]}.csv`;
  a.click();
  URL.revokeObjectURL(url);
};
```

**Step 5: Verify reports updated**

Run: `grep -n "reportStats\|monthlyData\|csvContent" apps/admin-portal/src/pages/Reports.tsx`
Expected: Shows the new query and export variables

**Step 6: Commit**

```bash
git add apps/admin-portal/src/pages/Reports.tsx
git commit -m "feat(admin): replace mock data with real Supabase queries in reports"
```

---

## Task 9: Fix Agent Portal Rewards

**Files:**
- Modify: `apps/agent-portal/src/pages/Rewards.tsx`

**Step 1: Read current rewards page**

Run: `cat apps/agent-portal/src/pages/Rewards.tsx`

**Step 2: Add real rewards query**

Add query for confirmed rewards:
```typescript
const { data: rewardsData } = useQuery({
  queryKey: ['agent-rewards', agentId],
  queryFn: async () => {
    if (!agentId) return { total: 0, pending: 0, confirmed: 0, paid: 0 };

    const { data: rewards } = await supabase
      .from('rewards')
      .select('amount, status')
      .eq('agent_id', agentId);

    if (!rewards) return { total: 0, pending: 0, confirmed: 0, paid: 0 };

    return {
      total: rewards.reduce((sum, r) => sum + (r.amount || 0), 0),
      pending: rewards.filter(r => r.status === 'pending').reduce((sum, r) => sum + (r.amount || 0), 0),
      confirmed: rewards.filter(r => r.status === 'confirmed').reduce((sum, r) => sum + (r.amount || 0), 0),
      paid: rewards.filter(r => r.status === 'paid').reduce((sum, r) => sum + (r.amount || 0), 0),
    };
  },
  enabled: !!agentId,
});
```

Update the display to use `rewardsData.confirmed` instead of hardcoded 0.

**Step 3: Verify rewards updated**

Run: `grep -n "rewardsData\|confirmed" apps/agent-portal/src/pages/Rewards.tsx`
Expected: Shows the new query and confirmed usage

**Step 4: Commit**

```bash
git add apps/agent-portal/src/pages/Rewards.tsx
git commit -m "fix(agent): fetch real confirmed rewards data"
```

---

## Task 10: Build Verification and Push

**Step 1: Run TypeScript check**

Run: `pnpm -r typecheck`
Expected: No errors

**Step 2: Run build**

Run: `pnpm build`
Expected: Build succeeds for all apps

**Step 3: Final commit and push**

```bash
git add -A
git status
git push origin master:main
```

**Step 4: Verify deployment**

Wait for Render auto-deploy (check dashboard links) and test:
1. Visit admin portal - should redirect to login
2. Login with `admin@test.com` / `@Abc1234`
3. Verify dashboard shows real stats
4. Check reports page shows real data
5. Test PDF export
6. Test logout

---

## Summary

| Task | Description | Status |
|------|-------------|--------|
| 1 | Admin Auth Hook | Pending |
| 2 | Admin Login Page | Pending |
| 3 | Protected Route Component | Pending |
| 4 | Update Router | Pending |
| 5 | Add Logout to Layout | Pending |
| 6 | Fix PDF Export Page | Pending |
| 7 | Fix Dashboard Stats | Pending |
| 8 | Fix Reports Mock Data | Pending |
| 9 | Fix Agent Rewards | Pending |
| 10 | Build & Deploy | Pending |

**Estimated Total Time:** 45-60 minutes

**Test Credentials:**
- Admin: `admin@test.com` / `@Abc1234`
- Agent: `agent@test.com` / `@Abc1234`
