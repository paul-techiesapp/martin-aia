import {
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
} from '@tanstack/react-router';
import { Layout } from './components/Layout';
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

const rootRoute = createRootRoute({
  component: () => (
    <Layout>
      <Outlet />
    </Layout>
  ),
});

const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/',
  component: Dashboard,
});

// Campaign routes
const campaignsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/campaigns',
  component: CampaignList,
});

const newCampaignRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/campaigns/new',
  component: CampaignForm,
});

const campaignDetailRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/campaigns/$campaignId',
  component: CampaignDetail,
});

const editCampaignRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/campaigns/$campaignId/edit',
  component: CampaignForm,
});

// Agent routes
const agentsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/agents',
  component: AgentList,
});

const newAgentRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/agents/new',
  component: AgentForm,
});

const editAgentRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/agents/$agentId/edit',
  component: AgentForm,
});

// Tier routes
const tiersRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/tiers',
  component: TierList,
});

// PIN codes route
const pinCodesRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/pin-codes',
  component: PinCodes,
});

// Reports route
const reportsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/reports',
  component: Reports,
});

// PDF Export route
const pdfExportRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/pdf-export',
  component: PdfExport,
});

const routeTree = rootRoute.addChildren([
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
]);

export const router = createRouter({ routeTree });

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
}
