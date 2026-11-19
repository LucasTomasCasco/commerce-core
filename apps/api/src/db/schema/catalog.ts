import { sql } from "drizzle-orm";
import {
  bigint,
  check,
  foreignKey,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  boolean,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import { stores } from "./platform.js";

export const categories = pgTable(
  "categories",
  {
    id: uuid().primaryKey().defaultRandom(),
    storeId: uuid()
      .notNull()
      .references(() => stores.id, { onDelete: "cascade" }),
    name: text().notNull(),
    slug: text().notNull(),
    archivedAt: timestamp({ withTimezone: true }),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [unique("categories_store_slug_key").on(t.storeId, t.slug), unique().on(t.storeId, t.id)],
);

export const products = pgTable(
  "products",
  {
    id: uuid().primaryKey().defaultRandom(),
    storeId: uuid()
      .notNull()
      .references(() => stores.id, { onDelete: "cascade" }),
    categoryId: uuid(),
    sku: text().notNull(),
    name: text().notNull(),
    description: text(),
    priceMinor: bigint({ mode: "number" }).notNull(),
    stockOnHand: integer().notNull().default(0),
    active: boolean().notNull().default(true),
    archivedAt: timestamp({ withTimezone: true }),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique("products_store_sku_key").on(t.storeId, t.sku),
    unique().on(t.storeId, t.id),
    // Con category_id nulo la FK no se evalúa, así que un producto sin categoría es válido.
    foreignKey({
      name: "products_category_fk",
      columns: [t.storeId, t.categoryId],
      foreignColumns: [categories.storeId, categories.id],
    }),
    check("products_price_non_negative", sql`${t.priceMinor} >= 0`),
    check("products_stock_non_negative", sql`${t.stockOnHand} >= 0`),
    index("products_store_active_idx").on(t.storeId, t.active),
  ],
);
