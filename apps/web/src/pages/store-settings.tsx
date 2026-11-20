import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState, type SyntheticEvent } from "react";
import { api, unwrap } from "../api/client.js";
import { Alert, Button, Card, Field, Input } from "../components/ui.js";
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
      <div className="flex flex-col gap-2 border-t border-slate-200 pt-4">
        <p className="text-sm text-slate-600">
          Si el propietario no recibió la invitación o el enlace venció, reenvíala. El enlace
          anterior deja de funcionar.
        </p>
        <Button
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
