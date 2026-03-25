import {
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
} from '@tanstack/react-router';
import { Register } from './pages/Register';
import { CheckOut } from './pages/CheckOut';
import { Display } from './pages/Display';

const rootRoute = createRootRoute({
  component: () => <Outlet />,
});

const registerRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/public/register/$linkCode',
  component: Register,
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
        <h1 className="text-3xl font-bold">Unit Recruitment System</h1>
        <p className="text-muted-foreground">
          Use your invitation link to register for an event.
        </p>
      </div>
    </div>
  ),
});

const displayRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/public/display/$slotId',
  component: Display,
});

const routeTree = rootRoute.addChildren([
  indexRoute,
  registerRoute,
  checkoutRoute,
  displayRoute,
]);

export const router = createRouter({ routeTree });

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
}
