import { sql } from "drizzle-orm";
import {
  bigint,
  char,
  check,
  foreignKey,
  index,
  integer,
  pgEnum,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import { products } from "./catalog.js";
import { currencies, stores, users } from "./platform.js";

export const orderStatusEnum = pgEnum("order_status", [
  "pending",
  "confirmed",
  "fulfilled",
  "cancelled",
]);

export const orders = pgTable(
  "orders",
  {
    id: uuid().primaryKey().defaultRandom(),
    storeId: uuid()
      .notNull()
      .references(() => stores.id, { onDelete: "cascade" }),
    code: text().notNull(),
    status: orderStatusEnum().notNull().default("pending"),
    customerName: text().notNull(),
    customerPhone: text().notNull(),
    note: text(),
    currencyCode: char({ length: 3 })
      .notNull()
      .references(() => currencies.code),
    totalMinor: bigint({ mode: "number" }).notNull(),
    createdByUserId: uuid()
      .notNull()
      .references(() => users.id),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique("orders_store_code_key").on(t.storeId, t.code),
    unique().on(t.storeId, t.id),
    check("orders_total_non_negative", sql`${t.totalMinor} >= 0`),
    index("orders_store_status_idx").on(t.storeId, t.status, t.createdAt),
  ],
);

export const orderItems = pgTable(
  "order_items",
  {
    id: uuid().primaryKey().defaultRandom(),
    storeId: uuid()
      .notNull()
      .references(() => stores.id, { onDelete: "cascade" }),
    orderId: uuid().notNull(),
    productId: uuid().notNull(),
    // Snapshots: el pedido conserva el nombre y el precio vigentes al momento de la venta.
    skuSnapshot: text().notNull(),
    nameSnapshot: text().notNull(),
    unitPriceMinor: bigint({ mode: "number" }).notNull(),
    quantity: integer().notNull(),
    lineTotalMinor: bigint({ mode: "number" }).notNull(),
  },
  (t) => [
    foreignKey({
      name: "order_items_order_fk",
      columns: [t.storeId, t.orderId],
      foreignColumns: [orders.storeId, orders.id],
    }).onDelete("cascade"),
    foreignKey({
      name: "order_items_product_fk",
      columns: [t.storeId, t.productId],
      foreignColumns: [products.storeId, products.id],
    }),
    check("order_items_quantity_positive", sql`${t.quantity} > 0`),
    check("order_items_unit_price_non_negative", sql`${t.unitPriceMinor} >= 0`),
    check(
      "order_items_line_total_consistent",
      sql`${t.lineTotalMinor} = ${t.unitPriceMinor} * ${t.quantity}`,
    ),
    index("order_items_order_id_idx").on(t.orderId),
  ],
);
