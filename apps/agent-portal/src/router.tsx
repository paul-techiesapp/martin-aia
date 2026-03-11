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
import { Invitations } from './pages/Invitations';
import { Rewards } from './pages/Rewards';
import { Partners } from './pages/Partners';
import { AvailableInvitations } from './pages/AvailableInvitations';
import { MyClaimedInvitations } from './pages/MyClaimedInvitations';
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

const invitationsRoute = createRoute({
  getParentRoute: () => authenticatedRoute,
  path: '/invitations',
  component: Invitations,
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
const availableInvitationsRoute = createRoute({
  getParentRoute: () => authenticatedRoute,
  path: '/available-invitations',
  component: AvailableInvitations,
});

const myClaimedInvitationsRoute = createRoute({
  getParentRoute: () => authenticatedRoute,
  path: '/my-invitations',
  component: MyClaimedInvitations,
});

const routeTree = rootRoute.addChildren([
  loginRoute,
  authenticatedRoute.addChildren([
    indexRoute,
    campaignsRoute,
    invitationsRoute,
    rewardsRoute,
    partnersRoute,
    availableInvitationsRoute,
    myClaimedInvitationsRoute,
  ]),
]);

export const router = createRouter({ routeTree });

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
}
