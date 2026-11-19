import { useStore } from "../store/store-context.js";
import { Card } from "../components/ui.js";

export function StoreOverviewPage() {
  const { store, roleName, isOwner, permissions } = useStore();
  return (
    <div className="grid gap-4 md:grid-cols-2">
      <Card>
        <h2 className="mb-3 font-semibold">Tienda</h2>
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
          <dt className="text-slate-500">Dirección</dt>
          <dd>/{store.slug}</dd>
          <dt className="text-slate-500">Moneda</dt>
          <dd>{store.currencyCode}</dd>
          <dt className="text-slate-500">Estado</dt>
          <dd>{store.status}</dd>
        </dl>
      </Card>
      <Card>
        <h2 className="mb-3 font-semibold">Tu acceso</h2>
        <p className="text-sm">
          Rol: <strong>{roleName}</strong>
          {isOwner ? " (propietario)" : ""}
        </p>
        <p className="mt-2 text-xs text-slate-500">{permissions.length} permisos</p>
      </Card>
    </div>
  );
}
