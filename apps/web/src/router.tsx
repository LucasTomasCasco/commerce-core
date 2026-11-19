import { createBrowserRouter } from "react-router";
import { AppLayout, NotFound } from "./layout.js";
import { RequireAuth, RequirePlatformAdmin } from "./auth/session.js";
import {
  ForgotPasswordPage,
  InvitePage,
  LoginPage,
  ResetPasswordPage,
} from "./pages/auth-pages.js";
import { HomePage } from "./pages/home-page.js";
import { StoresAdminPage, PlatformStorePage, CurrenciesPage } from "./pages/admin-pages.js";
import { StoreOverviewPage } from "./pages/store-overview-page.js";
import { CategoriesPage, ProductsPage } from "./pages/catalog-pages.js";
import { StockPage } from "./pages/stock-pages.js";
import { NewOrderPage, OrderDetailPage, OrdersPage } from "./pages/sales-pages.js";
import { AuditPage, TeamPage } from "./pages/team-pages.js";
import { StorefrontPage } from "./pages/storefront-page.js";
import { StoreLayout } from "./store/store-layout.js";

export const router = createBrowserRouter([
  { path: "/login", element: <LoginPage /> },
  { path: "/olvide", element: <ForgotPasswordPage /> },
  { path: "/restablecer", element: <ResetPasswordPage /> },
  { path: "/invitacion", element: <InvitePage /> },
  { path: "/t/:slug", element: <StorefrontPage /> },
  {
    element: (
      <RequireAuth>
        <AppLayout />
      </RequireAuth>
    ),
    children: [
      { path: "/", element: <HomePage /> },
      {
        path: "/admin/tiendas",
        element: (
          <RequirePlatformAdmin>
            <StoresAdminPage />
          </RequirePlatformAdmin>
        ),
      },
      {
        path: "/admin/tiendas/:storeId",
        element: (
          <RequirePlatformAdmin>
            <PlatformStorePage />
          </RequirePlatformAdmin>
        ),
      },
      {
        path: "/admin/monedas",
        element: (
          <RequirePlatformAdmin>
            <CurrenciesPage />
          </RequirePlatformAdmin>
        ),
      },
      {
        path: "/tiendas/:storeId",
        element: <StoreLayout />,
        children: [
          { index: true, element: <StoreOverviewPage /> },
          { path: "productos", element: <ProductsPage /> },
          { path: "categorias", element: <CategoriesPage /> },
          { path: "stock", element: <StockPage /> },
          { path: "pedidos", element: <OrdersPage /> },
          { path: "pedidos/nuevo", element: <NewOrderPage /> },
          { path: "pedidos/:orderId", element: <OrderDetailPage /> },
          { path: "equipo", element: <TeamPage /> },
          { path: "auditoria", element: <AuditPage /> },
        ],
      },
    ],
  },
  { path: "*", element: <NotFound /> },
]);
