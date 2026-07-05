import {
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  redirect,
} from '@tanstack/react-router';
import { Layout } from './components/Layout';
import { Login } from './pages/Login';
import { Dashboard } from './pages/Dashboard';
import { Campaigns } from './pages/Campaigns';
import { MyLinks } from './pages/MyLinks';
import { AllLinks } from './pages/AllLinks';
import { Rewards } from './pages/Rewards';
import { Partners } from './pages/Partners';
import { MyEnquiryLink } from './pages/MyEnquiryLink';
import { MyEnquiries } from './pages/MyEnquiries';
import { MyPartners } from './pages/MyPartners';
import { MyCommissions } from './pages/MyCommissions';
import { PartnerLinks } from './pages/PartnerLinks';
import { MyAgents } from './pages/MyAgents';
import { TeamReport } from './pages/TeamReport';
import { BranchPerformance } from './pages/BranchPerformance';
import { Account } from './pages/Account';
import { ForgotPassword } from './pages/ForgotPassword';
import { ResetPassword } from './pages/ResetPassword';
import { supabase } from './lib/supabase';

const isAuthenticated = async () => {
  const { data: { session } } = await supabase.auth.getSession();
  return !!session;
};

const rootRoute = createRootRoute({
  component: () => <Outlet />,
});

const loginRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/login',
  component: Login,
  beforeLoad: async () => {
    if (await isAuthenticated()) {
      throw redirect({ to: '/' });
    }
  },
});

// Public, unguarded password-recovery routes (reset link target lands here)
const forgotPasswordRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/forgot-password',
  component: ForgotPassword,
});

const resetPasswordRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/reset-password',
  component: ResetPassword,
});

const authenticatedRoute = createRoute({
  getParentRoute: () => rootRoute,
  id: 'authenticated',
  component: () => (
    <Layout>
      <Outlet />
    </Layout>
  ),
  beforeLoad: async () => {
    if (!(await isAuthenticated())) {
      throw redirect({ to: '/login' });
    }
  },
});

const indexRoute = createRoute({
  getParentRoute: () => authenticatedRoute,
  path: '/',
  component: Dashboard,
});

// Agent routes
const campaignsRoute = createRoute({
  getParentRoute: () => authenticatedRoute,
  path: '/campaigns',
  component: Campaigns,
});

const myLinksRoute = createRoute({
  getParentRoute: () => authenticatedRoute,
  path: '/my-links',
  component: MyLinks,
});

const allLinksRoute = createRoute({
  getParentRoute: () => authenticatedRoute,
  path: '/all-links',
  component: AllLinks,
});

const rewardsRoute = createRoute({
  getParentRoute: () => authenticatedRoute,
  path: '/rewards',
  component: Rewards,
});

const partnersRoute = createRoute({
  getParentRoute: () => authenticatedRoute,
  path: '/partners',
  component: Partners,
});

const myLinkRoute = createRoute({
  getParentRoute: () => authenticatedRoute,
  path: '/my-link',
  component: MyEnquiryLink,
});

const myEnquiriesRoute = createRoute({
  getParentRoute: () => authenticatedRoute,
  path: '/my-enquiries',
  component: MyEnquiries,
});

const myPartnersRoute = createRoute({
  getParentRoute: () => authenticatedRoute,
  path: '/my-partners',
  component: MyPartners,
});

const myCommissionsRoute = createRoute({
  getParentRoute: () => authenticatedRoute,
  path: '/my-commissions',
  component: MyCommissions,
});

// Partner routes
const partnerLinksRoute = createRoute({
  getParentRoute: () => authenticatedRoute,
  path: '/partner-links',
  component: PartnerLinks,
});

const myAgentsRoute = createRoute({
  getParentRoute: () => authenticatedRoute,
  path: '/my-agents',
  component: MyAgents,
});

const teamReportRoute = createRoute({
  getParentRoute: () => authenticatedRoute,
  path: '/team-report',
  component: TeamReport,
});

// Master Partner (merchant) portal — read-only branch performance dashboard.
const branchPerformanceRoute = createRoute({
  getParentRoute: () => authenticatedRoute,
  path: '/branch-performance',
  component: BranchPerformance,
});

// Available to every role (Unit Admin, Agent, Partner) for self-service password change
const accountRoute = createRoute({
  getParentRoute: () => authenticatedRoute,
  path: '/account',
  component: Account,
});

const routeTree = rootRoute.addChildren([
  loginRoute,
  forgotPasswordRoute,
  resetPasswordRoute,
  authenticatedRoute.addChildren([
    indexRoute,
    campaignsRoute,
    myLinksRoute,
    allLinksRoute,
    rewardsRoute,
    partnersRoute,
    myLinkRoute,
    myEnquiriesRoute,
    myPartnersRoute,
    myCommissionsRoute,
    partnerLinksRoute,
    myAgentsRoute,
    teamReportRoute,
    branchPerformanceRoute,
    accountRoute,
  ]),
]);

export const router = createRouter({ routeTree });

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
}
