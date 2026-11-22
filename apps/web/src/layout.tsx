import { useQueryClient } from "@tanstack/react-query";
import { Link, Outlet, useNavigate } from "react-router";
import { api, unwrap } from "./api/client.js";
import { useMe } from "./auth/session.js";
import { BrandMark, Boundary, Button } from "./components/ui.js";
import { ThemeToggle } from "./components/theme-toggle.js";
import { OnboardingTour } from "./components/onboarding-tour.js";

export function AppLayout() {
  const me = useMe();
  const queryClient = useQueryClient();
  const navigate = useNavigate();

  async function logout() {
    await unwrap(api.POST("/api/v1/auth/logout"));
    queryClient.removeQueries();
    await navigate("/login", { replace: true });
  }

  // Cierra la sesión en este dispositivo y en todos los demás.
  async function logoutEverywhere() {
    await unwrap(api.POST("/api/v1/auth/logout-all"));
    queryClient.removeQueries();
    await navigate("/login", { replace: true });
  }

  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-30 border-b border-line bg-canvas/75 backdrop-blur-xl">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-5 py-3">
          <div className="flex items-center gap-6">
            <Link to="/" className="flex items-center gap-2.5">
              <BrandMark />
              <span className="hidden text-sm font-bold tracking-tight sm:block">
                Commerce Core
              </span>
            </Link>
            {me.data?.isPlatformAdmin && (
              <nav className="flex items-center gap-1 text-sm font-medium">
                <Link
                  to="/admin/tiendas"
                  className="rounded-lg px-3 py-1.5 text-fg-muted transition hover:bg-surface-2 hover:text-fg"
                >
                  Tiendas
                </Link>
                <Link
                  to="/admin/monedas"
                  className="rounded-lg px-3 py-1.5 text-fg-muted transition hover:bg-surface-2 hover:text-fg"
                >
                  Monedas
                </Link>
              </nav>
            )}
          </div>
          <div className="flex items-center gap-2">
            <span className="hidden max-w-[12rem] truncate pr-2 text-sm text-fg-muted md:inline">
              {me.data?.fullName}
            </span>
            <Button
              variant="ghost"
              onClick={() => window.dispatchEvent(new Event("cc-open-tour"))}
              className="hidden md:inline-flex"
            >
              Tutorial
            </Button>
            <ThemeToggle />
            <Button variant="secondary" onClick={() => void logout()}>
              Salir
            </Button>
            <Button
              variant="ghost"
              onClick={() => void logoutEverywhere()}
              className="hidden lg:inline-flex"
            >
              Salir de todos
            </Button>
          </div>
        </div>
      </header>
      <OnboardingTour />
      <main className="mx-auto max-w-6xl px-5 py-10">
        <Boundary>
          <Outlet />
        </Boundary>
      </main>
    </div>
  );
}

export function NotFound() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4">
      <BrandMark size="lg" />
      <p className="text-2xl font-bold">Página no encontrada</p>
      <Link to="/" className="text-sm font-semibold text-accent hover:underline">
        Volver al inicio
      </Link>
    </div>
  );
}
