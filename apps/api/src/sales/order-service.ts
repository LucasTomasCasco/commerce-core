import { createHash } from "node:crypto";
import { and, asc, count, desc, eq, inArray, sql } from "drizzle-orm";
import { recordAudit } from "../audit/record.js";
import type { Db, Tx } from "../db/client.js";
import { withDbContext } from "../db/tenant.js";
import { idempotencyKeys, orderItems, orders, products, stores } from "../db/schema/index.js";
import { AppError } from "../http/errors.js";
import { applyStockChange } from "../inventory/stock.js";

export type OrderServiceDeps = { db: Db };

export type OrderLineInput = { productId: string; quantity: number };

export type CreateOrderInput = {
  storeId: string;
  actorUserId: string;
  customerName: string;
  customerPhone: string;
  note?: string | undefined;
  items: OrderLineInput[];
  idempotencyKey?: string | undefined;
};

export type OrderStatus = "pending" | "confirmed" | "fulfilled" | "cancelled";

export function createOrderService({ db }: OrderServiceDeps) {
  // Crea el pedido, toma snapshots de precio y nombre y descuenta stock, todo en una transacción.
  // Con Idempotency-Key, un reintento devuelve la respuesta original y no crea otro pedido.
  async function createOrder(input: CreateOrderInput) {
    const requestHash = hashRequest(input);

    return withDbContext(db, { storeId: input.storeId, userId: input.actorUserId }, async (tx) => {
      if (input.idempotencyKey) {
        const replay = await findReplay(tx, input.storeId, input.idempotencyKey, requestHash);
        if (replay) return replay;
      }

      const lines = mergeLines(input.items);
      const productRows = await tx
        .select()
        .from(products)
        .where(
          and(
            eq(products.storeId, input.storeId),
            inArray(
              products.id,
              lines.map((l) => l.productId),
            ),
          ),
        );
      const byId = new Map(productRows.map((p) => [p.id, p]));
      const unavailable = lines.filter((l) => {
        const p = byId.get(l.productId);
        return !p || !p.active || p.archivedAt !== null;
      });
      if (unavailable.length > 0) {
        throw new AppError(
          400,
          "PRODUCT_UNAVAILABLE",
          "Hay productos que no están disponibles para vender",
        );
      }

      const [store] = await tx
        .update(stores)
        .set({ orderSeq: sql`${stores.orderSeq} + 1` })
        .where(eq(stores.id, input.storeId))
        .returning({ orderSeq: stores.orderSeq, currencyCode: stores.currencyCode });
      if (!store) throw new Error("No se encontró la tienda");

      const priced = lines.map((line) => {
        const product = byId.get(line.productId);
        if (!product) throw new Error("Producto validado que no aparece en el listado");
        return {
          product,
          quantity: line.quantity,
          lineTotalMinor: product.priceMinor * line.quantity,
        };
      });
      const totalMinor = priced.reduce((sum, l) => sum + l.lineTotalMinor, 0);

      const [order] = await tx
        .insert(orders)
        .values({
          storeId: input.storeId,
          code: formatOrderCode(store.orderSeq),
          customerName: input.customerName,
          customerPhone: input.customerPhone,
          note: input.note ?? null,
          currencyCode: store.currencyCode,
          totalMinor,
          createdByUserId: input.actorUserId,
        })
        .returning();
      if (!order) throw new Error("No se creó el pedido");

      await tx.insert(orderItems).values(
        priced.map((l) => ({
          storeId: input.storeId,
          orderId: order.id,
          productId: l.product.id,
          skuSnapshot: l.product.sku,
          nameSnapshot: l.product.name,
          unitPriceMinor: l.product.priceMinor,
          quantity: l.quantity,
          lineTotalMinor: l.lineTotalMinor,
        })),
      );

      // Orden fijo por producto: transacciones concurrentes bloquean las filas en el mismo orden.
      for (const line of [...priced].sort((a, b) => a.product.id.localeCompare(b.product.id))) {
        await applyStockChange(tx, {
          storeId: input.storeId,
          productId: line.product.id,
          sku: line.product.sku,
          type: "sale",
          quantityDelta: -line.quantity,
          orderId: order.id,
          actorUserId: input.actorUserId,
        });
      }

      await recordAudit(tx, {
        storeId: input.storeId,
        actorUserId: input.actorUserId,
        action: "order.created",
        entity: "order",
        entityId: order.id,
        metadata: { code: order.code, totalMinor },
      });

      const response = await getOrderInTx(tx, input.storeId, order.id);
      if (input.idempotencyKey) {
        await tx.insert(idempotencyKeys).values({
          storeId: input.storeId,
          key: input.idempotencyKey,
          requestHash,
          statusCode: 201,
          response,
        });
      }
      return response;
    });
  }

  async function listOrders(input: {
    storeId: string;
    status?: OrderStatus | undefined;
    limit: number;
    offset: number;
  }) {
    const where = and(
      eq(orders.storeId, input.storeId),
      input.status ? eq(orders.status, input.status) : undefined,
    );
    const [items, [total]] = await withDbContext(db, { storeId: input.storeId }, (tx) =>
      Promise.all([
        tx
          .select()
          .from(orders)
          .where(where)
          .orderBy(desc(orders.createdAt))
          .limit(input.limit)
          .offset(input.offset),
        tx.select({ total: count() }).from(orders).where(where),
      ]),
    );
    return { items, total: total?.total ?? 0, limit: input.limit, offset: input.offset };
  }

  async function getOrder(input: { storeId: string; orderId: string }) {
    return withDbContext(db, { storeId: input.storeId }, (tx) =>
      getOrderInTx(tx, input.storeId, input.orderId),
    );
  }

  // Avanza confirmed o fulfilled. La condición de estado en el UPDATE evita carreras entre dos usuarios.
  async function advance(input: {
    storeId: string;
    actorUserId: string;
    orderId: string;
    from: "pending" | "confirmed";
    to: "confirmed" | "fulfilled";
  }) {
    return withDbContext(db, { storeId: input.storeId, userId: input.actorUserId }, async (tx) => {
      const [updated] = await tx
        .update(orders)
        .set({ status: input.to, updatedAt: new Date() })
        .where(
          and(
            eq(orders.storeId, input.storeId),
            eq(orders.id, input.orderId),
            eq(orders.status, input.from),
          ),
        )
        .returning({ id: orders.id });
      if (!updated) throw invalidTransition(input.from, input.to);
      await recordAudit(tx, {
        storeId: input.storeId,
        actorUserId: input.actorUserId,
        action: `order.${input.to}`,
        entity: "order",
        entityId: input.orderId,
      });
      return getOrderInTx(tx, input.storeId, input.orderId);
    });
  }

  // Cancelar devuelve el stock de cada línea con movimientos sale_cancel.
  async function cancel(input: { storeId: string; actorUserId: string; orderId: string }) {
    return withDbContext(db, { storeId: input.storeId, userId: input.actorUserId }, async (tx) => {
      const [cancelled] = await tx
        .update(orders)
        .set({ status: "cancelled", updatedAt: new Date() })
        .where(
          and(
            eq(orders.storeId, input.storeId),
            eq(orders.id, input.orderId),
            inArray(orders.status, ["pending", "confirmed"]),
          ),
        )
        .returning({ id: orders.id });
      if (!cancelled) {
        throw new AppError(
          409,
          "INVALID_TRANSITION",
          "Solo se pueden cancelar pedidos pendientes o confirmados",
        );
      }

      const lines = await tx
        .select({
          productId: orderItems.productId,
          sku: orderItems.skuSnapshot,
          quantity: orderItems.quantity,
        })
        .from(orderItems)
        .where(eq(orderItems.orderId, input.orderId))
        .orderBy(asc(orderItems.productId));
      for (const line of lines) {
        await applyStockChange(tx, {
          storeId: input.storeId,
          productId: line.productId,
          sku: line.sku,
          type: "sale_cancel",
          quantityDelta: line.quantity,
          orderId: input.orderId,
          actorUserId: input.actorUserId,
        });
      }

      await recordAudit(tx, {
        storeId: input.storeId,
        actorUserId: input.actorUserId,
        action: "order.cancelled",
        entity: "order",
        entityId: input.orderId,
      });
      return getOrderInTx(tx, input.storeId, input.orderId);
    });
  }

  return { createOrder, listOrders, getOrder, advance, cancel };
}

export type OrderService = ReturnType<typeof createOrderService>;

function hashRequest(input: CreateOrderInput): string {
  const canonical = JSON.stringify({
    customerName: input.customerName,
    customerPhone: input.customerPhone,
    note: input.note ?? null,
    items: mergeLines(input.items),
  });
  return createHash("sha256").update(canonical).digest("hex");
}

// Varias líneas del mismo producto se suman: el pedido tiene una línea por producto.
function mergeLines(items: OrderLineInput[]): OrderLineInput[] {
  const totals = new Map<string, number>();
  for (const item of items) {
    totals.set(item.productId, (totals.get(item.productId) ?? 0) + item.quantity);
  }
  return [...totals.entries()]
    .map(([productId, quantity]) => ({ productId, quantity }))
    .sort((a, b) => a.productId.localeCompare(b.productId));
}

function formatOrderCode(seq: number): string {
  return `ORD-${String(seq).padStart(6, "0")}`;
}

async function findReplay(tx: Tx, storeId: string, key: string, requestHash: string) {
  const [row] = await tx
    .select()
    .from(idempotencyKeys)
    .where(and(eq(idempotencyKeys.storeId, storeId), eq(idempotencyKeys.key, key)))
    .limit(1);
  if (!row) return null;
  if (row.requestHash !== requestHash) {
    throw new AppError(
      422,
      "IDEMPOTENCY_KEY_REUSED",
      "La clave de idempotencia ya se usó con otro pedido",
    );
  }
  return row.response as Awaited<ReturnType<typeof getOrderInTx>>;
}

async function getOrderInTx(tx: Tx, storeId: string, orderId: string) {
  const [order] = await tx
    .select()
    .from(orders)
    .where(and(eq(orders.storeId, storeId), eq(orders.id, orderId)))
    .limit(1);
  if (!order) throw new AppError(404, "ORDER_NOT_FOUND", "Pedido no encontrado");
  const items = await tx
    .select()
    .from(orderItems)
    .where(eq(orderItems.orderId, orderId))
    .orderBy(asc(orderItems.nameSnapshot));
  return { ...order, items };
}

function invalidTransition(from: string, to: string) {
  return new AppError(409, "INVALID_TRANSITION", `No se puede pasar de ${from} a ${to}`);
}
