import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState, type SyntheticEvent } from "react";
import { api, unwrap } from "../api/client.js";
import { Alert, Button, Input } from "./ui.js";
import { errorText } from "../pages/catalog-pages.js";

// Renombrado inline de una categoría. Cambiar el nombre no cambia su slug.
export function RenameCategory({
  storeId,
  category,
}: {
  storeId: string;
  category: { id: string; name: string };
}) {
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(category.name);
  const rename = useMutation({
    mutationFn: () =>
      unwrap(
        api.PATCH("/api/v1/stores/{storeId}/categories/{categoryId}", {
          params: { path: { storeId, categoryId: category.id } },
          body: { name },
        }),
      ),
    onSuccess: async () => {
      setEditing(false);
      await queryClient.invalidateQueries({ queryKey: ["categories", storeId] });
    },
  });

  if (!editing) {
    return (
      <Button
        variant="secondary"
        onClick={() => {
          setEditing(true);
        }}
      >
        Renombrar
      </Button>
    );
  }

  return (
    <form
      className="flex flex-col gap-2"
      onSubmit={(e: SyntheticEvent) => {
        e.preventDefault();
        rename.mutate();
      }}
    >
      <Input
        required
        value={name}
        onChange={(e) => {
          setName(e.target.value);
        }}
      />
      <div className="flex gap-2">
        <Button type="submit" disabled={rename.isPending || name.trim() === ""}>
          Guardar
        </Button>
        <Button
          variant="secondary"
          onClick={() => {
            setEditing(false);
          }}
        >
          Cancelar
        </Button>
      </div>
      {rename.error && <Alert>{errorText(rename.error)}</Alert>}
    </form>
  );
}
