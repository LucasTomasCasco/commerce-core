import { useMutation, useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { useState, type SyntheticEvent } from "react";
import { api, unwrap } from "../api/client.js";
import { Alert, Boundary, Button, Card, Field, Input, Select } from "../components/ui.js";
import { errorText } from "./catalog-pages.js";

// Ajustes que el administrador general puede cambiar de una tienda: nombre y reenvío de la invitación al propietario.
export function PlatformStoreSettings({
  storeId,
  currentName,
}: {
  storeId: string;
  currentName: string;
}) {
  const queryClient = useQueryClient();
  const [name, setName] = useState(currentName);
  const rename = useMutation({
    mutationFn: () =>
      unwrap(
        api.PATCH("/api/v1/platform/stores/{storeId}", {
          params: { path: { storeId } },
          body: { name },
        }),
      ),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["platform-store", storeId] }),
        queryClient.invalidateQueries({ queryKey: ["platform-stores"] }),
      ]);
    },
  });
  const resend = useMutation({
    mutationFn: () =>
      unwrap(
        api.POST("/api/v1/platform/stores/{storeId}/owner-invitation/resend", {
          params: { path: { storeId } },
        }),
      ),
  });

  return (
    <Card className="flex flex-col gap-4">
      <h2 className="font-semibold">Ajustes</h2>
      <form
        className="flex flex-col gap-3"
        onSubmit={(e: SyntheticEvent) => {
          e.preventDefault();
          rename.mutate();
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
        {rename.error && <Alert>{errorText(rename.error)}</Alert>}
        <Button type="submit" disabled={rename.isPending || name.trim() === currentName}>
          Guardar nombre
        </Button>
      </form>
      <div className="flex flex-col gap-2 border-t border-line pt-4">
        <p className="text-sm text-fg-muted">
          Si el propietario no recibió la invitación o el enlace venció, reenvíala. El enlace
          anterior deja de funcionar.
        </p>
        <Button
          size="sm"
          variant="secondary"
          onClick={() => {
            resend.mutate();
          }}
          disabled={resend.isPending}
        >
          Reenviar invitación al propietario
        </Button>
        {resend.isSuccess && <Alert tone="info">Invitación reenviada.</Alert>}
        {resend.error && <Alert>{errorText(resend.error)}</Alert>}
      </div>
    </Card>
  );
}

// Transferencia de propiedad: el propietario actual pasa al rol elegido cuando el nuevo acepta la invitación.
export function OwnerTransferForm({ storeId }: { storeId: string }) {
  const [ownerEmail, setOwnerEmail] = useState("");
  const [demoteToRoleId, setDemoteToRoleId] = useState("");
  const transfer = useMutation({
    mutationFn: () =>
      unwrap(
        api.POST("/api/v1/platform/stores/{storeId}/owner-transfer", {
          params: { path: { storeId } },
          body: { ownerEmail, demoteToRoleId },
        }),
      ),
  });

  return (
    <Card className="flex flex-col gap-4">
      <h2 className="font-semibold">Transferir propiedad</h2>
      <p className="text-sm text-fg-muted">
        El nuevo propietario recibe una invitación. Hasta que la acepte, la tienda sigue con el
        propietario actual.
      </p>
      <Boundary>
        <RoleOptions storeId={storeId} value={demoteToRoleId} onChange={setDemoteToRoleId} />
      </Boundary>
      <form
        className="flex flex-col gap-3"
        onSubmit={(e: SyntheticEvent) => {
          e.preventDefault();
          transfer.mutate();
        }}
      >
        <Field label="Email del nuevo propietario">
          <Input
            type="email"
            required
            value={ownerEmail}
            onChange={(e) => {
              setOwnerEmail(e.target.value);
            }}
          />
        </Field>
        {transfer.error && <Alert>{errorText(transfer.error)}</Alert>}
        {transfer.isSuccess && <Alert tone="info">Invitación enviada al nuevo propietario.</Alert>}
        <Button
          type="submit"
          variant="danger"
          disabled={transfer.isPending || !demoteToRoleId || !ownerEmail}
        >
          Transferir propiedad
        </Button>
      </form>
    </Card>
  );
}

function RoleOptions({
  storeId,
  value,
  onChange,
}: {
  storeId: string;
  value: string;
  onChange: (id: string) => void;
}) {
  const roles = useSuspenseQuery({
    queryKey: ["platform-assignable-roles", storeId],
    queryFn: () =>
      unwrap(api.GET("/api/v1/platform/stores/{storeId}/roles", { params: { path: { storeId } } })),
  });
  return (
    <Field label="Rol del propietario anterior">
      <Select
        required
        value={value}
        onChange={(e) => {
          onChange(e.target.value);
        }}
      >
        <option value="">Elegir rol…</option>
        {roles.data.roles.map((r) => (
          <option key={r.id} value={r.id}>
            {r.name}
          </option>
        ))}
      </Select>
    </Field>
  );
}
