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
import { supabase } from './lib/supabase';

// Check if user is authenticated
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

const routeTree = rootRoute.addChildren([
  loginRoute,
  authenticatedRoute.addChildren([
    indexRoute,
    campaignsRoute,
    invitationsRoute,
    rewardsRoute,
  ]),
]);

export const router = createRouter({ routeTree });

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
}
