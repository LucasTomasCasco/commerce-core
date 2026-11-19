import { useSuspenseQuery } from "@tanstack/react-query";
import { NavLink, Outlet, useParams } from "react-router";
import { api, unwrap } from "../api/client.js";
import { Badge, PageHeader } from "../components/ui.js";
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
      <PageHeader title={store.name}>
        <Badge>{store.currencyCode}</Badge>
        <Badge tone={store.status === "active" ? "good" : "bad"}>
          {store.status === "active" ? "Activa" : "Suspendida"}
        </Badge>
      </PageHeader>
      <nav className="mb-6 flex flex-wrap gap-1 border-b border-slate-200">
        {visible.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.end}
            className={({ isActive }) =>
              `-mb-px border-b-2 px-3 py-2 text-sm font-medium ${
                isActive
                  ? "border-slate-900 text-slate-900"
                  : "border-transparent text-slate-500 hover:text-slate-900"
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
