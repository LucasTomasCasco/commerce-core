import { and, desc, eq, count } from "drizzle-orm";
import { recordAudit } from "../audit/record.js";
import type { Db } from "../db/client.js";
import { withDbContext } from "../db/tenant.js";
import { products, stockMovements } from "../db/schema/index.js";
import { AppError } from "../http/errors.js";
import { applyStockChange } from "./stock.js";

export type InventoryServiceDeps = { db: Db };

export function createInventoryService({ db }: InventoryServiceDeps) {
  async function listMovements(input: {
    storeId: string;
    productId?: string | undefined;
    limit: number;
    offset: number;
  }) {
    const where = and(
      eq(stockMovements.storeId, input.storeId),
      input.productId ? eq(stockMovements.productId, input.productId) : undefined,
    );
    const [items, [total]] = await withDbContext(db, { storeId: input.storeId }, (tx) =>
      Promise.all([
        tx
          .select()
          .from(stockMovements)
          .where(where)
          .orderBy(desc(stockMovements.createdAt))
          .limit(input.limit)
          .offset(input.offset),
        tx.select({ total: count() }).from(stockMovements).where(where),
      ]),
    );
    return { items, total: total?.total ?? 0, limit: input.limit, offset: input.offset };
  }

  // Entradas (purchase) suman; ajustes (adjustment) suman o restan y exigen motivo.
  async function registerMovement(input: {
    storeId: string;
    actorUserId: string;
    productId: string;
    type: "purchase" | "adjustment";
    quantityDelta: number;
    reason?: string | undefined;
  }) {
    if (input.type === "purchase" && input.quantityDelta <= 0) {
      throw new AppError(400, "INVALID_MOVEMENT", "Una entrada debe sumar stock");
    }
    if (input.type === "adjustment" && !input.reason) {
      throw new AppError(400, "INVALID_MOVEMENT", "Un ajuste necesita un motivo");
    }

    return withDbContext(db, { storeId: input.storeId, userId: input.actorUserId }, async (tx) => {
      const [product] = await tx
        .select()
        .from(products)
        .where(and(eq(products.storeId, input.storeId), eq(products.id, input.productId)))
        .limit(1);
      if (!product) throw new AppError(404, "PRODUCT_NOT_FOUND", "Producto no encontrado");
      if (product.archivedAt)
        throw new AppError(409, "PRODUCT_ARCHIVED", "El producto está archivado");

      const result = await applyStockChange(tx, {
        storeId: input.storeId,
        productId: product.id,
        sku: product.sku,
        type: input.type,
        quantityDelta: input.quantityDelta,
        reason: input.reason,
        actorUserId: input.actorUserId,
      });
      await recordAudit(tx, {
        storeId: input.storeId,
        actorUserId: input.actorUserId,
        action: "stock.moved",
        entity: "product",
        entityId: product.id,
        metadata: {
          type: input.type,
          quantityDelta: input.quantityDelta,
          stockOnHand: result.stockOnHand,
        },
      });
      return { movement: result.movement, stockOnHand: result.stockOnHand };
    });
  }

  return { listMovements, registerMovement };
}

export type InventoryService = ReturnType<typeof createInventoryService>;
