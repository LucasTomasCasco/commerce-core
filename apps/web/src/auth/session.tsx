import { useQuery } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { Navigate, useLocation } from "react-router";
import { api, ApiError, unwrap } from "../api/client.js";
import { Spinner } from "../components/ui.js";

export type Me = { id: string; email: string; fullName: string; isPlatformAdmin: boolean };

// Devuelve el usuario de la sesión o null si no hay sesión válida.
export function useMe() {
  return useQuery({
    queryKey: ["me"],
    queryFn: async (): Promise<Me | null> => {
      try {
        return (await unwrap(api.GET("/api/v1/auth/me"))).user;
      } catch (error) {
        if (error instanceof ApiError && error.status === 401) return null;
        throw error;
      }
    },
    retry: false,
  });
}

export function RequireAuth({ children }: { children: ReactNode }) {
  const me = useMe();
  const location = useLocation();
  if (me.isPending) return <Spinner />;
  if (!me.data) {
    const next = encodeURIComponent(`${location.pathname}${location.search}`);
    return <Navigate to={`/login?next=${next}`} replace />;
  }
  return children;
}

export function RequirePlatformAdmin({ children }: { children: ReactNode }) {
  const me = useMe();
  if (me.isPending) return <Spinner />;
  if (!me.data?.isPlatformAdmin) return <Navigate to="/" replace />;
  return children;
}
