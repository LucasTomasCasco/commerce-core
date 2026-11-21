import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState, type SyntheticEvent } from "react";
import { api, unwrap } from "../api/client.js";
import { Alert, Button, Card, Field, Input } from "../components/ui.js";
import { useStore } from "../store/store-context.js";
import { errorText } from "./catalog-pages.js";

export function StoreOverviewPage() {
  const { storeId, store, roleName, isOwner, permissions, can } = useStore();
  return (
    <div className="grid gap-4 md:grid-cols-2">
      <Card>
        <h2 className="mb-3 font-semibold">Tienda</h2>
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
          <dt className="text-fg-muted">Dirección pública</dt>
          <dd>
            <a className="underline" href={`/t/${store.slug}`} target="_blank" rel="noreferrer">
              /t/{store.slug}
            </a>
          </dd>
          <dt className="text-fg-muted">Moneda</dt>
          <dd>{store.currencyCode}</dd>
          <dt className="text-fg-muted">Estado</dt>
          <dd>{store.status}</dd>
        </dl>
      </Card>
      <Card>
        <h2 className="mb-3 font-semibold">Tu acceso</h2>
        <p className="text-sm">
          Rol: <strong>{roleName}</strong>
          {isOwner ? " (propietario)" : ""}
        </p>
        <p className="mt-2 text-xs text-fg-muted">{permissions.length} permisos</p>
      </Card>
      {can("store:settings") && <StoreSettingsForm storeId={storeId} currentName={store.name} />}
    </div>
  );
}

function StoreSettingsForm({ storeId, currentName }: { storeId: string; currentName: string }) {
  const queryClient = useQueryClient();
  const [name, setName] = useState(currentName);
  const save = useMutation({
    mutationFn: () =>
      unwrap(
        api.PATCH("/api/v1/stores/{storeId}", { params: { path: { storeId } }, body: { name } }),
      ),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["store", storeId] }),
        queryClient.invalidateQueries({ queryKey: ["my-stores"] }),
      ]);
    },
  });

  return (
    <Card>
      <h2 className="mb-3 font-semibold">Datos de la tienda</h2>
      <form
        className="flex flex-col gap-3"
        onSubmit={(e: SyntheticEvent) => {
          e.preventDefault();
          save.mutate();
        }}
      >
        <Field label="Nombre de la tienda">
          <Input
            required
            value={name}
            onChange={(e) => {
              setName(e.target.value);
            }}
          />
        </Field>
        {save.error && <Alert>{errorText(save.error)}</Alert>}
        {save.isSuccess && <Alert tone="info">Cambios guardados.</Alert>}
        <Button type="submit" disabled={save.isPending || name.trim() === currentName}>
          Guardar
        </Button>
      </form>
    </Card>
  );
}
