import {
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
} from '@tanstack/react-router';
import { Layout } from './components/Layout';
import { ProtectedRoute } from './components/ProtectedRoute';
import { Login } from './pages/Login';
import { ForgotPassword } from './pages/ForgotPassword';
import { ResetPassword } from './pages/ResetPassword';
import { Dashboard } from './pages/Dashboard';
import { CampaignList } from './pages/campaigns/CampaignList';
import { CampaignForm } from './pages/campaigns/CampaignForm';
import { CampaignDetail } from './pages/campaigns/CampaignDetail';
import { AgentList } from './pages/agents/AgentList';
import { AgentForm } from './pages/agents/AgentForm';
import { TierList } from './pages/tiers/TierList';
import { InsuranceProductList } from './pages/insurance-products/InsuranceProductList';
import { MerchantList } from './pages/merchants/MerchantList';
import { MerchantDetail } from './pages/merchants/MerchantDetail';
import { EnquiryList } from './pages/enquiries/EnquiryList';
import { EnquiryDetail } from './pages/enquiries/EnquiryDetail';
import { GiftList } from './pages/gifts/GiftList';
import { MerchantCommissionList } from './pages/commissions/MerchantCommissionList';
import { MerchantSettlementList } from './pages/settlements/MerchantSettlementList';
import { Reports } from './pages/Reports';
import { Rewards } from './pages/Rewards';
import { PdfExport } from './pages/PdfExport';
import { VenueDisplay } from './pages/VenueDisplay';
import { CheckInScanner } from './pages/CheckInScanner';
import { Settings } from './pages/Settings';
import { CardTemplateEditor } from './pages/CardTemplateEditor';

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

const insuranceProductsRoute = createRoute({
  getParentRoute: () => protectedLayoutRoute,
  path: '/insurance-products',
  component: InsuranceProductList,
});

const merchantsRoute = createRoute({
  getParentRoute: () => protectedLayoutRoute,
  path: '/merchants',
  component: MerchantList,
});

const merchantDetailRoute = createRoute({
  getParentRoute: () => protectedLayoutRoute,
  path: '/merchants/$merchantId',
  component: MerchantDetail,
});

const enquiriesRoute = createRoute({
  getParentRoute: () => protectedLayoutRoute,
  path: '/enquiries',
  component: EnquiryList,
});

const enquiryDetailRoute = createRoute({
  getParentRoute: () => protectedLayoutRoute,
  path: '/enquiries/$enquiryId',
  component: EnquiryDetail,
});

const giftsRoute = createRoute({
  getParentRoute: () => protectedLayoutRoute,
  path: '/gifts',
  component: GiftList,
});

const commissionsRoute = createRoute({
  getParentRoute: () => protectedLayoutRoute,
  path: '/commissions',
  component: MerchantCommissionList,
});

const settlementsRoute = createRoute({
  getParentRoute: () => protectedLayoutRoute,
  path: '/settlements',
  component: MerchantSettlementList,
});

// Reports route
const reportsRoute = createRoute({
  getParentRoute: () => protectedLayoutRoute,
  path: '/reports',
  component: Reports,
});

// Rewards route
const rewardsRoute = createRoute({
  getParentRoute: () => protectedLayoutRoute,
  path: '/rewards',
  component: Rewards,
});

// PDF Export route
const pdfExportRoute = createRoute({
  getParentRoute: () => protectedLayoutRoute,
  path: '/pdf-export',
  component: PdfExport,
});

// Check-in Scanner route
const checkInScannerRoute = createRoute({
  getParentRoute: () => protectedLayoutRoute,
  path: '/check-in',
  component: CheckInScanner,
});

const settingsRoute = createRoute({
  getParentRoute: () => protectedLayoutRoute,
  path: '/settings',
  component: Settings,
});

const cardTemplateRoute = createRoute({
  getParentRoute: () => protectedLayoutRoute,
  path: '/settings/card-template',
  component: CardTemplateEditor,
});

const venueDisplayRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/venue-display/$slotId',
  component: () => (
    <ProtectedRoute>
      <VenueDisplay />
    </ProtectedRoute>
  ),
});

const routeTree = rootRoute.addChildren([
  loginRoute,
  forgotPasswordRoute,
  resetPasswordRoute,
  venueDisplayRoute,
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
    insuranceProductsRoute,
    merchantsRoute,
    merchantDetailRoute,
    enquiriesRoute,
    enquiryDetailRoute,
    giftsRoute,
    commissionsRoute,
    settlementsRoute,
    reportsRoute,
    rewardsRoute,
    pdfExportRoute,
    checkInScannerRoute,
    settingsRoute,
    cardTemplateRoute,
  ]),
]);

export const router = createRouter({ routeTree });

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
}
