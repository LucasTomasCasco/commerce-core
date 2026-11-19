import { sql } from "drizzle-orm";
import type { Db } from "../../src/db/client.js";

// Invariante del ledger: el saldo de cada producto debe igual la suma de sus movimientos.
export async function ledgerMismatches(db: Db, storeId: string) {
  return db.execute<{ sku: string; stock_on_hand: number; ledger: number }>(sql`
    SELECT p.sku, p.stock_on_hand, COALESCE(SUM(m.quantity_delta), 0)::int AS ledger
    FROM products p
    LEFT JOIN stock_movements m ON m.product_id = p.id
    WHERE p.store_id = ${storeId}
    GROUP BY p.id, p.sku, p.stock_on_hand
    HAVING p.stock_on_hand <> COALESCE(SUM(m.quantity_delta), 0)
  `);
}
