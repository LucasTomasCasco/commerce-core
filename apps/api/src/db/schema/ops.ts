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

// Cola de emails: se escribe en la misma transacción que la acción que lo origina.
// Un worker lo envía con reintentos; así un SMTP caído no rompe el alta ni deja emails perdidos.
export const outboxEmails = pgTable(
  "outbox_emails",
  {
    id: uuid().primaryKey().defaultRandom(),
    recipient: text().notNull(),
    subject: text().notNull(),
    body: text().notNull(),
    status: text({ enum: ["pending", "sent", "failed"] })
      .notNull()
      .default("pending"),
    attempts: integer().notNull().default(0),
    lastError: text(),
    nextAttemptAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    sentAt: timestamp({ withTimezone: true }),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("outbox_emails_due_idx").on(t.status, t.nextAttemptAt)],
);
