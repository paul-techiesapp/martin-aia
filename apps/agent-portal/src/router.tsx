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
import { Rewards } from './pages/Rewards';
import { Partners } from './pages/Partners';
import { PartnerLinks } from './pages/PartnerLinks';
import { MyAgents } from './pages/MyAgents';
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
    rewardsRoute,
    partnersRoute,
    partnerLinksRoute,
    myAgentsRoute,
    accountRoute,
  ]),
]);

export const router = createRouter({ routeTree });

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
}
