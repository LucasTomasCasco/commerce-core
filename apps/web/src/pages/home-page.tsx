import { useSuspenseQuery } from "@tanstack/react-query";
import { Link, Navigate } from "react-router";
import { api, unwrap } from "../api/client.js";
import { useMe } from "../auth/session.js";
import { Badge, Boundary, Card, Empty, PageHeader, Spinner } from "../components/ui.js";

export function HomePage() {
  const me = useMe();
  if (me.isPending) return <Spinner />;
  if (me.data?.isPlatformAdmin) return <Navigate to="/admin/tiendas" replace />;
  return (
    <Boundary>
      <MyStores />
    </Boundary>
  );
}

function MyStores() {
  const stores = useSuspenseQuery({
    queryKey: ["my-stores"],
    queryFn: () => unwrap(api.GET("/api/v1/me/stores")),
  });

  return (
    <>
      <PageHeader title="Mis tiendas" />
      {stores.data.stores.length === 0 ? (
        <Empty>Todavía no tienes tiendas asignadas.</Empty>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          {stores.data.stores.map((store) => (
            <Link key={store.id} to={`/tiendas/${store.id}`}>
              <Card className="transition hover:border-fg-muted">
                <div className="mb-4 flex size-12 items-center justify-center rounded-xl bg-gradient-to-br from-accent to-[#ff7a1a] text-base font-extrabold text-accent-fg">
                  {store.name.charAt(0).toUpperCase()}
                </div>
                <div className="flex items-center justify-between gap-2">
                  <p className="text-lg font-bold">{store.name}</p>
                  <Badge tone={store.status === "active" ? "good" : "bad"}>
                    {store.status === "active" ? "Activa" : "Suspendida"}
                  </Badge>
                </div>
                <p className="mt-1 text-sm text-fg-muted">
                  {store.access.roleName}
                  {store.access.isOwner ? " · Propietario" : ""}
                </p>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </>
  );
}
