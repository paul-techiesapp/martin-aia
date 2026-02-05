import {
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
} from '@tanstack/react-router';
import { Register } from './pages/Register';
import { CheckIn } from './pages/CheckIn';
import { CheckOut } from './pages/CheckOut';

const rootRoute = createRootRoute({
  component: () => <Outlet />,
});

const registerRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/public/register/$token',
  component: Register,
});

const checkinRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/public/checkin',
  component: CheckIn,
});

const checkoutRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/public/checkout',
  component: CheckOut,
});

const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/',
  component: () => (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      <div className="text-center space-y-4">
        <h1 className="text-3xl font-bold">Agent Recruitment System</h1>
        <p className="text-muted-foreground">
          Use your invitation link to register for an event.
        </p>
      </div>
    </div>
  ),
});

const routeTree = rootRoute.addChildren([
  indexRoute,
  registerRoute,
  checkinRoute,
  checkoutRoute,
]);

export const router = createRouter({ routeTree });

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
}
