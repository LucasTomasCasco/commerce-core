import { index, jsonb, pgTable, text, timestamp, unique, uuid, integer } from "drizzle-orm/pg-core";
import { stores, users } from "./platform.js";

export const auditLogs = pgTable(
  "audit_logs",
  {
    id: uuid().primaryKey().defaultRandom(),
    storeId: uuid()
      .notNull()
      .references(() => stores.id, { onDelete: "cascade" }),
    actorUserId: uuid()
      .notNull()
      .references(() => users.id),
    action: text().notNull(),
    entity: text().notNull(),
    entityId: text().notNull(),
    metadata: jsonb().$type<Record<string, unknown>>().notNull().default({}),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("audit_logs_store_created_idx").on(t.storeId, t.createdAt)],
);

export const idempotencyKeys = pgTable(
  "idempotency_keys",
  {
    id: uuid().primaryKey().defaultRandom(),
    storeId: uuid()
      .notNull()
      .references(() => stores.id, { onDelete: "cascade" }),
    key: text().notNull(),
    requestHash: text().notNull(),
    statusCode: integer().notNull(),
    response: jsonb().$type<unknown>().notNull(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [unique("idempotency_keys_store_key_key").on(t.storeId, t.key)],
);
