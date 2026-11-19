import { and, eq, sql } from "drizzle-orm";
import type { Tx } from "../db/client.js";
import { products, stockMovements } from "../db/schema/index.js";
import { AppError } from "../http/errors.js";

export type StockMovementType = "purchase" | "sale" | "sale_cancel" | "adjustment";

// Único punto que cambia stock_on_hand. Actualiza el saldo y registra el movimiento en la misma
// transacción, así el ledger y el saldo no pueden divergir. El WHERE impide dejar stock negativo.
export async function applyStockChange(
  tx: Tx,
  input: {
    storeId: string;
    productId: string;
    sku: string;
    type: StockMovementType;
    quantityDelta: number;
    reason?: string | undefined;
    orderId?: string | undefined;
    actorUserId: string;
  },
) {
  const [updated] = await tx
    .update(products)
    .set({
      stockOnHand: sql`${products.stockOnHand} + ${input.quantityDelta}`,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(products.storeId, input.storeId),
        eq(products.id, input.productId),
        sql`${products.stockOnHand} + ${input.quantityDelta} >= 0`,
      ),
    )
    .returning({ id: products.id, stockOnHand: products.stockOnHand });

  if (!updated) {
    throw new AppError(409, "INSUFFICIENT_STOCK", `Stock insuficiente para ${input.sku}`);
  }

  const [movement] = await tx
    .insert(stockMovements)
    .values({
      storeId: input.storeId,
      productId: input.productId,
      type: input.type,
      quantityDelta: input.quantityDelta,
      reason: input.reason ?? null,
      orderId: input.orderId ?? null,
      createdByUserId: input.actorUserId,
    })
    .returning();
  if (!movement) throw new Error("No se registró el movimiento de stock");

  return { movement, stockOnHand: updated.stockOnHand };
}
