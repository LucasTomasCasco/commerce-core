import { Pager } from "../components/ui.js";
import { useMutation, useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { useState, type SyntheticEvent } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { api, unwrap } from "../api/client.js";
import {
  Alert,
  Badge,
  Button,
  Card,
  Empty,
  Field,
  Input,
  LinkButton,
  PageHeader,
  Select,
  Table,
  formatDate,
} from "../components/ui.js";
import { formatMoney } from "../lib/money.js";
import { useStore } from "../store/store-context.js";
import { errorText } from "./catalog-pages.js";

const ORDERS_PAGE_SIZE = 20;

type OrderStatus = "pending" | "confirmed" | "fulfilled" | "cancelled";

const STATUS_LABEL: Record<string, string> = {
  pending: "Pendiente",
  confirmed: "Confirmado",
  fulfilled: "Entregado",
  cancelled: "Cancelado",
};

const STATUS_TONE: Record<string, "neutral" | "good" | "warn" | "bad"> = {
  pending: "warn",
  confirmed: "neutral",
  fulfilled: "good",
  cancelled: "bad",
};

export function OrderStatusBadge({ status }: { status: string }) {
  return <Badge tone={STATUS_TONE[status] ?? "neutral"}>{STATUS_LABEL[status] ?? status}</Badge>;
}

export function OrdersPage() {
  const { storeId, store, can } = useStore();
  const [status, setStatus] = useState("");
  const [offset, setOffset] = useState(0);
  const orders = useSuspenseQuery({
    queryKey: ["orders", storeId, status],
    queryFn: () =>
      unwrap(
        api.GET("/api/v1/stores/{storeId}/orders", {
          params: {
            path: { storeId },
            query: {
              limit: ORDERS_PAGE_SIZE,
              offset,
              ...(status ? { status: status as OrderStatus } : {}),
            },
          },
        }),
      ),
  });

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <Field label="Estado">
          <Select
            value={status}
            onChange={(e) => {
              setStatus(e.target.value);
              setOffset(0);
            }}
          >
            <option value="">Todos</option>
            {Object.entries(STATUS_LABEL).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </Select>
        </Field>
        {can("orders:create") && (
          <LinkButton to={`/tiendas/${storeId}/pedidos/nuevo`}>Cargar pedido</LinkButton>
        )}
      </div>
      {orders.data.items.length === 0 ? (
        <Empty>No hay pedidos.</Empty>
      ) : (
        <Table headers={["Código", "Cliente", "Estado", "Total", "Fecha", ""]}>
          {orders.data.items.map((o) => (
            <tr key={o.id} className="hover:bg-slate-50">
              <td className="px-4 py-2.5 font-mono text-xs">{o.code}</td>
              <td className="px-4 py-2.5">{o.customerName}</td>
              <td className="px-4 py-2.5">
                <OrderStatusBadge status={o.status} />
              </td>
              <td className="px-4 py-2.5">{formatMoney(o.totalMinor, store.currencyCode)}</td>
              <td className="px-4 py-2.5 text-xs text-slate-500">{formatDate(o.createdAt)}</td>
              <td className="px-4 py-2.5">
                <Link
                  className="text-slate-700 underline"
                  to={`/tiendas/${storeId}/pedidos/${o.id}`}
                >
                  Ver
                </Link>
              </td>
            </tr>
          ))}
        </Table>
      )}
      <Pager
        total={orders.data.total}
        limit={ORDERS_PAGE_SIZE}
        offset={offset}
        onChange={setOffset}
      />
    </div>
  );
}

type Line = { productId: string; quantity: string };

export function NewOrderPage() {
  const { storeId, store } = useStore();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [customerName, setCustomerName] = useState("");
  const [customerPhone, setCustomerPhone] = useState("");
  const [note, setNote] = useState("");
  const [lines, setLines] = useState<Line[]>([{ productId: "", quantity: "1" }]);
  // Una clave por formulario: un reintento de red o un doble clic no crea dos pedidos.
  const [idempotencyKey] = useState(() => crypto.randomUUID());

  const products = useSuspenseQuery({
    queryKey: ["products", storeId, "order-select"],
    queryFn: () =>
      unwrap(
        api.GET("/api/v1/stores/{storeId}/products", {
          params: { path: { storeId }, query: { limit: 100, active: "true" } },
        }),
      ),
  });

  const create = useMutation({
    mutationFn: () =>
      unwrap(
        api.POST("/api/v1/stores/{storeId}/orders", {
          params: { path: { storeId }, header: { "idempotency-key": idempotencyKey } },
          body: {
            customerName,
            customerPhone,
            ...(note ? { note } : {}),
            items: lines.map((l) => ({ productId: l.productId, quantity: Number(l.quantity) })),
          },
        }),
      ),
    onSuccess: async (order) => {
      await queryClient.invalidateQueries({ queryKey: ["orders", storeId] });
      await navigate(`/tiendas/${storeId}/pedidos/${order.id}`);
    },
  });

  function updateLine(index: number, patch: Partial<Line>) {
    setLines((current) => current.map((line, i) => (i === index ? { ...line, ...patch } : line)));
  }

  function submit(event: SyntheticEvent) {
    event.preventDefault();
    create.mutate();
  }

  const total = lines.reduce((sum, line) => {
    const product = products.data.items.find((p) => p.id === line.productId);
    return product ? sum + product.priceMinor * Number(line.quantity || 0) : sum;
  }, 0);

  return (
    <>
      <PageHeader title="Nuevo pedido" />
      <form onSubmit={submit} className="grid gap-6 lg:grid-cols-[1fr_300px]">
        <Card className="flex flex-col gap-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Nombre del cliente">
              <Input
                required
                value={customerName}
                onChange={(e) => {
                  setCustomerName(e.target.value);
                }}
              />
            </Field>
            <Field label="Teléfono">
              <Input
                required
                value={customerPhone}
                onChange={(e) => {
                  setCustomerPhone(e.target.value);
                }}
              />
            </Field>
          </div>
          <Field label="Nota (opcional)">
            <Input
              value={note}
              onChange={(e) => {
                setNote(e.target.value);
              }}
            />
          </Field>
          <div className="flex flex-col gap-2">
            <p className="text-sm font-medium text-slate-700">Productos</p>
            {lines.map((line, index) => (
              <div key={index} className="flex gap-2">
                <Select
                  required
                  className="flex-1"
                  value={line.productId}
                  onChange={(e) => {
                    updateLine(index, { productId: e.target.value });
                  }}
                >
                  <option value="">Elegir producto…</option>
                  {products.data.items.map((p) => (
                    <option key={p.id} value={p.id} disabled={p.stockOnHand === 0}>
                      {p.sku} · {p.name} · {formatMoney(p.priceMinor, store.currencyCode)} (stock{" "}
                      {p.stockOnHand})
                    </option>
                  ))}
                </Select>
                <Input
                  required
                  type="number"
                  min={1}
                  className="w-24"
                  value={line.quantity}
                  onChange={(e) => {
                    updateLine(index, { quantity: e.target.value });
                  }}
                />
                {lines.length > 1 && (
                  <Button
                    type="button"
                    variant="secondary"
                    onClick={() => {
                      setLines(lines.filter((_, i) => i !== index));
                    }}
                  >
                    Quitar
                  </Button>
                )}
              </div>
            ))}
            <div>
              <Button
                type="button"
                variant="secondary"
                onClick={() => {
                  setLines([...lines, { productId: "", quantity: "1" }]);
                }}
              >
                Agregar producto
              </Button>
            </div>
          </div>
        </Card>
        <Card className="flex h-fit flex-col gap-4">
          <p className="text-sm text-slate-500">Total</p>
          <p className="text-2xl font-semibold">{formatMoney(total, store.currencyCode)}</p>
          {create.error && <Alert>{errorText(create.error)}</Alert>}
          <Button type="submit" disabled={create.isPending}>
            Cargar pedido
          </Button>
        </Card>
      </form>
    </>
  );
}

export function OrderDetailPage() {
  const { storeId, store, can } = useStore();
  const { orderId = "" } = useParams();
  const queryClient = useQueryClient();
  const order = useSuspenseQuery({
    queryKey: ["order", storeId, orderId],
    queryFn: () =>
      unwrap(
        api.GET("/api/v1/stores/{storeId}/orders/{orderId}", {
          params: { path: { storeId, orderId } },
        }),
      ),
  });

  const transition = useMutation({
    mutationFn: (action: "confirm" | "fulfill" | "cancel") => {
      const params = { path: { storeId, orderId } };
      if (action === "confirm")
        return unwrap(api.POST("/api/v1/stores/{storeId}/orders/{orderId}/confirm", { params }));
      if (action === "fulfill")
        return unwrap(api.POST("/api/v1/stores/{storeId}/orders/{orderId}/fulfill", { params }));
      return unwrap(api.POST("/api/v1/stores/{storeId}/orders/{orderId}/cancel", { params }));
    },
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["order", storeId, orderId] }),
        queryClient.invalidateQueries({ queryKey: ["orders", storeId] }),
        queryClient.invalidateQueries({ queryKey: ["products", storeId] }),
        queryClient.invalidateQueries({ queryKey: ["movements", storeId] }),
      ]);
    },
  });
  const o = order.data;
  const canConfirm = o.status === "pending" && can("orders:update_status");
  const canFulfill = o.status === "confirmed" && can("orders:update_status");
  const canCancel = (o.status === "pending" || o.status === "confirmed") && can("orders:cancel");

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_300px]">
      <Card className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="font-mono text-sm">{o.code}</p>
          <OrderStatusBadge status={o.status} />
        </div>
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
          <dt className="text-slate-500">Cliente</dt>
          <dd>{o.customerName}</dd>
          <dt className="text-slate-500">Teléfono</dt>
          <dd>{o.customerPhone}</dd>
          <dt className="text-slate-500">Nota</dt>
          <dd>{o.note ?? "—"}</dd>
          <dt className="text-slate-500">Creado</dt>
          <dd>{formatDate(o.createdAt)}</dd>
        </dl>
        <Table headers={["Producto", "Precio", "Cant.", "Subtotal"]}>
          {o.items.map((item) => (
            <tr key={item.id}>
              <td className="px-4 py-2.5">
                {item.nameSnapshot}{" "}
                <span className="font-mono text-xs text-slate-500">{item.skuSnapshot}</span>
              </td>
              <td className="px-4 py-2.5">
                {formatMoney(item.unitPriceMinor, store.currencyCode)}
              </td>
              <td className="px-4 py-2.5">{item.quantity}</td>
              <td className="px-4 py-2.5">
                {formatMoney(item.lineTotalMinor, store.currencyCode)}
              </td>
            </tr>
          ))}
        </Table>
        <p className="text-right text-lg font-semibold">
          Total {formatMoney(o.totalMinor, store.currencyCode)}
        </p>
      </Card>
      <Card className="flex h-fit flex-col gap-2">
        <h2 className="font-semibold">Acciones</h2>
        {canConfirm && (
          <Button
            onClick={() => {
              transition.mutate("confirm");
            }}
          >
            Confirmar pedido
          </Button>
        )}
        {canFulfill && (
          <Button
            onClick={() => {
              transition.mutate("fulfill");
            }}
          >
            Marcar como entregado
          </Button>
        )}
        {canCancel && (
          <Button
            variant="danger"
            onClick={() => {
              transition.mutate("cancel");
            }}
          >
            Cancelar y devolver stock
          </Button>
        )}
        {!canConfirm && !canFulfill && !canCancel && (
          <p className="text-sm text-slate-500">Sin acciones disponibles.</p>
        )}
        {transition.error && <Alert>{errorText(transition.error)}</Alert>}
        <Link to={`/tiendas/${storeId}/pedidos`} className="mt-2 text-sm text-slate-600 underline">
          Volver a pedidos
        </Link>
      </Card>
    </div>
  );
}
