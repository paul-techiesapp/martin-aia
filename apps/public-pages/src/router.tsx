import {
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
} from '@tanstack/react-router';
import { Register } from './pages/Register';
import { Enquiry } from './pages/Enquiry';
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

const enquiryRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/public/enquiry/$linkCode',
  component: Enquiry,
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
      <div className="text-center flex flex-col gap-4">
        <h1 className="text-2xl font-semibold">Unit Recruitment System</h1>
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
  enquiryRoute,
  checkoutRoute,
  displayRoute,
]);

export const router = createRouter({ routeTree });

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
}
