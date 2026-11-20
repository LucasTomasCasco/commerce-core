import { useQueryClient } from "@tanstack/react-query";
import { Link, Outlet, useNavigate } from "react-router";
import { api, unwrap } from "./api/client.js";
import { Boundary, Button } from "./components/ui.js";
import { useMe } from "./auth/session.js";

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
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-3">
          <Link to="/" className="text-base font-semibold tracking-tight">
            Commerce Core
          </Link>
          <div className="flex items-center gap-3 text-sm">
            {me.data?.isPlatformAdmin && (
              <>
                <Link to="/admin/tiendas" className="text-slate-600 hover:text-slate-900">
                  Tiendas
                </Link>
                <Link to="/admin/monedas" className="text-slate-600 hover:text-slate-900">
                  Monedas
                </Link>
              </>
            )}
            <span className="hidden text-slate-500 sm:inline">{me.data?.fullName}</span>
            <Button variant="secondary" onClick={() => void logout()}>
              Salir
            </Button>
            <Button variant="secondary" onClick={() => void logoutEverywhere()}>
              Salir de todos
            </Button>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-4 py-8">
        <Boundary>
          <Outlet />
        </Boundary>
      </main>
    </div>
  );
}

export function NotFound() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-3">
      <p className="text-lg font-medium">Página no encontrada</p>
      <Link to="/" className="text-sm text-slate-600 underline">
        Volver al inicio
      </Link>
    </div>
  );
}
