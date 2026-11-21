import { useSuspenseQuery } from "@tanstack/react-query";
import { NavLink, Outlet, useParams } from "react-router";
import { api, unwrap } from "../api/client.js";
import { Badge } from "../components/ui.js";
import { StoreContext, type StoreContextValue } from "./store-context.js";

const NAV = [
  { to: "", label: "Resumen", permission: null, end: true },
  { to: "productos", label: "Productos", permission: "products:read", end: false },
  { to: "categorias", label: "Categorías", permission: "products:read", end: false },
  { to: "stock", label: "Stock", permission: "stock:read", end: false },
  { to: "pedidos", label: "Pedidos", permission: "orders:read", end: false },
  { to: "equipo", label: "Equipo", permission: "team:manage", end: false },
  { to: "auditoria", label: "Auditoría", permission: "audit:read", end: false },
];

export function StoreLayout() {
  const { storeId = "" } = useParams();
  const access = useSuspenseQuery({
    queryKey: ["store", storeId],
    queryFn: () => unwrap(api.GET("/api/v1/stores/{storeId}", { params: { path: { storeId } } })),
  });

  const { store, access: mine } = access.data;
  const permissions: string[] = mine.permissions;
  const value: StoreContextValue = {
    storeId,
    store,
    roleName: mine.roleName,
    isOwner: mine.isOwner,
    permissions,
    can: (permission) => permissions.includes(permission),
  };
  const visible = NAV.filter((item) => item.permission === null || value.can(item.permission));

  return (
    <StoreContext.Provider value={value}>
      <div className="mb-10 flex flex-wrap items-end justify-between gap-6">
        <div className="flex items-center gap-4">
          <span className="flex size-14 items-center justify-center rounded-2xl bg-gradient-to-br from-accent to-[#ff7a1a] text-lg font-extrabold text-accent-fg shadow-[0_12px_32px_-14px_var(--accent)]">
            {store.name.charAt(0).toUpperCase()}
          </span>
          <div>
            <p className="num text-xs font-semibold uppercase tracking-[0.2em] text-fg-muted">
              /{store.slug}
            </p>
            <h1 className="text-3xl font-extrabold tracking-tight">{store.name}</h1>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Badge>{store.currencyCode}</Badge>
          <Badge tone={store.status === "active" ? "good" : "bad"}>
            {store.status === "active" ? "Activa" : "Suspendida"}
          </Badge>
        </div>
      </div>
      <nav className="mb-10 flex flex-wrap gap-1.5 rounded-2xl border border-line bg-surface p-1.5 shadow-card">
        {visible.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.end}
            className={({ isActive }) =>
              `rounded-xl px-4 py-2 text-sm font-semibold transition ${
                isActive
                  ? "bg-accent text-accent-fg shadow-sm"
                  : "text-fg-muted hover:bg-surface-2 hover:text-fg"
              }`
            }
          >
            {item.label}
          </NavLink>
        ))}
      </nav>
      <Outlet />
    </StoreContext.Provider>
  );
}
