import { Pager } from "../components/ui.js";
import { useMutation, useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { useState, type SyntheticEvent } from "react";
import { api, unwrap } from "../api/client.js";
import {
  Alert,
  Button,
  Card,
  Empty,
  Field,
  Input,
  Select,
  Table,
  formatDate,
} from "../components/ui.js";
import { useStore } from "../store/store-context.js";
import { errorText } from "./catalog-pages.js";

const MOVEMENTS_PAGE_SIZE = 20;

const MOVEMENT_LABEL: Record<string, string> = {
  purchase: "Entrada",
  sale: "Venta",
  sale_cancel: "Devolución por cancelación",
  adjustment: "Ajuste",
};

export function StockPage() {
  const { storeId, can } = useStore();
  const queryClient = useQueryClient();
  const [productId, setProductId] = useState("");
  const [type, setType] = useState<"purchase" | "adjustment">("purchase");
  const [quantity, setQuantity] = useState("");
  const [reason, setReason] = useState("");
  const [offset, setOffset] = useState(0);

  const products = useSuspenseQuery({
    queryKey: ["products", storeId, "stock-select"],
    queryFn: () =>
      unwrap(
        api.GET("/api/v1/stores/{storeId}/products", {
          params: { path: { storeId }, query: { limit: 100 } },
        }),
      ),
  });
  const movements = useSuspenseQuery({
    queryKey: ["movements", storeId],
    queryFn: () =>
      unwrap(
        api.GET("/api/v1/stores/{storeId}/stock-movements", {
          params: { path: { storeId }, query: { limit: MOVEMENTS_PAGE_SIZE, offset } },
        }),
      ),
  });

  const register = useMutation({
    mutationFn: () =>
      unwrap(
        api.POST("/api/v1/stores/{storeId}/stock-movements", {
          params: { path: { storeId } },
          body: {
            productId,
            type,
            quantityDelta: Number(quantity),
            ...(type === "adjustment" ? { reason } : {}),
          },
        }),
      ),
    onSuccess: async () => {
      setQuantity("");
      setReason("");
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["movements", storeId] }),
        queryClient.invalidateQueries({ queryKey: ["products", storeId] }),
      ]);
    },
  });

  const productName = (id: string) =>
    products.data.items.find((p) => p.id === id)?.sku ?? id.slice(0, 8);

  function submit(event: SyntheticEvent) {
    event.preventDefault();
    register.mutate();
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
      <div className="flex flex-col gap-4">
        {movements.data.items.length === 0 ? (
          <Empty>Todavía no hay movimientos de stock.</Empty>
        ) : (
          <Table headers={["Fecha", "Producto", "Tipo", "Cantidad", "Motivo"]}>
            {movements.data.items.map((m) => (
              <tr key={m.id}>
                <td className="px-4 py-2.5 text-xs text-fg-muted">{formatDate(m.createdAt)}</td>
                <td className="px-4 py-2.5 font-mono text-xs">{productName(m.productId)}</td>
                <td className="px-4 py-2.5">{MOVEMENT_LABEL[m.type] ?? m.type}</td>
                <td
                  className={`px-4 py-2.5 font-medium ${m.quantityDelta < 0 ? "text-bad" : "text-good"}`}
                >
                  {m.quantityDelta > 0 ? `+${String(m.quantityDelta)}` : m.quantityDelta}
                </td>
                <td className="px-4 py-2.5 text-fg-muted">{m.reason ?? "—"}</td>
              </tr>
            ))}
          </Table>
        )}
      </div>

      <Pager
        total={movements.data.total}
        limit={MOVEMENTS_PAGE_SIZE}
        offset={offset}
        onChange={setOffset}
      />
      {can("stock:adjust") && (
        <Card className="h-fit">
          <h2 className="mb-4 font-semibold">Registrar stock</h2>
          <form onSubmit={submit} className="flex flex-col gap-3">
            <Field label="Producto">
              <Select
                required
                value={productId}
                onChange={(e) => {
                  setProductId(e.target.value);
                }}
              >
                <option value="">Elegir…</option>
                {products.data.items.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.sku} · {p.name} ({p.stockOnHand})
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Tipo">
              <Select
                value={type}
                onChange={(e) => {
                  setType(e.target.value as "purchase" | "adjustment");
                }}
              >
                <option value="purchase">Entrada (compra o reposición)</option>
                <option value="adjustment">Ajuste (puede restar)</option>
              </Select>
            </Field>
            <Field label="Cantidad">
              <Input
                required
                type="number"
                step={1}
                value={quantity}
                onChange={(e) => {
                  setQuantity(e.target.value);
                }}
              />
            </Field>
            {type === "adjustment" && (
              <Field label="Motivo">
                <Input
                  required
                  minLength={3}
                  value={reason}
                  onChange={(e) => {
                    setReason(e.target.value);
                  }}
                />
              </Field>
            )}
            {register.error && <Alert>{errorText(register.error)}</Alert>}
            <Button type="submit" disabled={register.isPending || !productId}>
              Registrar
            </Button>
          </form>
        </Card>
      )}
    </div>
  );
}
