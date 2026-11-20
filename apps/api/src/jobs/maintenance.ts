import { and, eq, lt } from "drizzle-orm";
import { recordAudit } from "../audit/record.js";
import type { Db } from "../db/client.js";
import { withDbContext } from "../db/tenant.js";
import { idempotencyKeys, orderItems, orders, stores } from "../db/schema/index.js";
import { applyStockChange } from "../inventory/stock.js";

// Cancela pedidos pendientes que nunca se confirmaron y devuelve su stock.
// Un pedido pendiente reserva stock; sin límite de tiempo, un abandono bloquearía el inventario para siempre.
export async function expireStalePendingOrders(db: Db, options: { now: Date; ttlHours: number }) {
  const cutoff = new Date(options.now.getTime() - options.ttlHours * 60 * 60 * 1000);
  const storeIds = (await db.select({ id: stores.id }).from(stores)).map((s) => s.id);
  let expired = 0;

  for (const storeId of storeIds) {
    expired += await withDbContext(db, { storeId }, async (tx) => {
      const stale = await tx
        .select({ id: orders.id, createdByUserId: orders.createdByUserId })
        .from(orders)
        .where(
          and(
            eq(orders.storeId, storeId),
            eq(orders.status, "pending"),
            lt(orders.createdAt, cutoff),
          ),
        );

      for (const order of stale) {
        const [cancelled] = await tx
          .update(orders)
          .set({ status: "cancelled", updatedAt: options.now })
          .where(and(eq(orders.id, order.id), eq(orders.status, "pending")))
          .returning({ id: orders.id });
        if (!cancelled) continue;

        const lines = await tx
          .select({
            productId: orderItems.productId,
            sku: orderItems.skuSnapshot,
            quantity: orderItems.quantity,
          })
          .from(orderItems)
          .where(eq(orderItems.orderId, order.id));
        for (const line of lines) {
          await applyStockChange(tx, {
            storeId,
            productId: line.productId,
            sku: line.sku,
            type: "sale_cancel",
            quantityDelta: line.quantity,
            orderId: order.id,
            actorUserId: order.createdByUserId,
          });
        }
        await recordAudit(tx, {
          storeId,
          actorUserId: order.createdByUserId,
          action: "order.expired",
          entity: "order",
          entityId: order.id,
        });
      }
      return stale.length;
    });
  }
  return expired;
}

// Borra claves de idempotencia vencidas. Pasado el plazo, un reintento se trata como pedido nuevo.
export async function cleanupIdempotencyKeys(
  db: Db,
  options: { now: Date; retentionHours: number },
) {
  const cutoff = new Date(options.now.getTime() - options.retentionHours * 60 * 60 * 1000);
  const storeIds = (await db.select({ id: stores.id }).from(stores)).map((s) => s.id);
  let deleted = 0;
  for (const storeId of storeIds) {
    deleted += await withDbContext(db, { storeId }, async (tx) => {
      const rows = await tx
        .delete(idempotencyKeys)
        .where(and(eq(idempotencyKeys.storeId, storeId), lt(idempotencyKeys.createdAt, cutoff)))
        .returning({ id: idempotencyKeys.id });
      return rows.length;
    });
  }
  return deleted;
}
