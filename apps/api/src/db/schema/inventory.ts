import { sql } from "drizzle-orm";
import {
  check,
  foreignKey,
  index,
  integer,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { products } from "./catalog.js";
import { orders } from "./sales.js";
import { stores, users } from "./platform.js";

export const stockMovementTypeEnum = pgEnum("stock_movement_type", [
  "purchase",
  "sale",
  "sale_cancel",
  "adjustment",
]);

// Ledger: products.stock_on_hand debe ser igual a la suma de quantity_delta por producto.
export const stockMovements = pgTable(
  "stock_movements",
  {
    id: uuid().primaryKey().defaultRandom(),
    storeId: uuid()
      .notNull()
      .references(() => stores.id, { onDelete: "cascade" }),
    productId: uuid().notNull(),
    type: stockMovementTypeEnum().notNull(),
    quantityDelta: integer().notNull(),
    reason: text(),
    orderId: uuid(),
    createdByUserId: uuid()
      .notNull()
      .references(() => users.id),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    foreignKey({
      name: "stock_movements_product_fk",
      columns: [t.storeId, t.productId],
      foreignColumns: [products.storeId, products.id],
    }),
    foreignKey({
      name: "stock_movements_order_fk",
      columns: [t.storeId, t.orderId],
      foreignColumns: [orders.storeId, orders.id],
    }),
    check("stock_movements_delta_not_zero", sql`${t.quantityDelta} <> 0`),
    check(
      "stock_movements_sign_matches_type",
      sql`(${t.type} = 'sale' AND ${t.quantityDelta} < 0)
        OR (${t.type} IN ('purchase', 'sale_cancel') AND ${t.quantityDelta} > 0)
        OR (${t.type} = 'adjustment')`,
    ),
    index("stock_movements_product_idx").on(t.storeId, t.productId, t.createdAt),
  ],
);
