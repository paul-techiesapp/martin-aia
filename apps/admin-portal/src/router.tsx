import {
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
} from '@tanstack/react-router';
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

// Campaign routes
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

const campaignDetailRoute = createRoute({
  getParentRoute: () => protectedLayoutRoute,
  path: '/campaigns/$campaignId',
  component: CampaignDetail,
});

const editCampaignRoute = createRoute({
  getParentRoute: () => protectedLayoutRoute,
  path: '/campaigns/$campaignId/edit',
  component: CampaignForm,
});

// Agent routes
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

// Tier routes
const tiersRoute = createRoute({
  getParentRoute: () => protectedLayoutRoute,
  path: '/tiers',
  component: TierList,
});

// PIN codes route
const pinCodesRoute = createRoute({
  getParentRoute: () => protectedLayoutRoute,
  path: '/pin-codes',
  component: PinCodes,
});

// Reports route
const reportsRoute = createRoute({
  getParentRoute: () => protectedLayoutRoute,
  path: '/reports',
  component: Reports,
});

// PDF Export route
const pdfExportRoute = createRoute({
  getParentRoute: () => protectedLayoutRoute,
  path: '/pdf-export',
  component: PdfExport,
});

const routeTree = rootRoute.addChildren([
  loginRoute,
  protectedLayoutRoute.addChildren([
    indexRoute,
    campaignsRoute,
    newCampaignRoute,
    campaignDetailRoute,
    editCampaignRoute,
    agentsRoute,
    newAgentRoute,
    editAgentRoute,
    tiersRoute,
    pinCodesRoute,
    reportsRoute,
    pdfExportRoute,
  ]),
]);

export const router = createRouter({ routeTree });

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
}
