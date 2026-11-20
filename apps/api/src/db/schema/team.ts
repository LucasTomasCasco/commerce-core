import {
  boolean,
  foreignKey,
  index,
  pgTable,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { stores, users } from "./platform.js";

// Tablas de tienda: todas llevan store_id y RLS (ver migración custom de RLS).

export const storeRoles = pgTable(
  "store_roles",
  {
    id: uuid().primaryKey().defaultRandom(),
    storeId: uuid()
      .notNull()
      .references(() => stores.id, { onDelete: "cascade" }),
    name: text().notNull(),
    permissions: text().array().notNull(),
    isSystem: boolean().notNull().default(false),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [unique("store_roles_store_name_key").on(t.storeId, t.name), unique().on(t.storeId, t.id)],
);

export const storeMembers = pgTable(
  "store_members",
  {
    id: uuid().primaryKey().defaultRandom(),
    storeId: uuid()
      .notNull()
      .references(() => stores.id, { onDelete: "cascade" }),
    userId: uuid()
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    roleId: uuid().notNull(),
    isOwner: boolean().notNull().default(false),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique("store_members_store_user_key").on(t.storeId, t.userId),
    // Un solo owner por tienda.
    uniqueIndex("store_members_one_owner_key")
      .on(t.storeId)
      .where(sql`${t.isOwner} = true`),
    foreignKey({
      name: "store_members_role_fk",
      columns: [t.storeId, t.roleId],
      foreignColumns: [storeRoles.storeId, storeRoles.id],
    }),
    index("store_members_user_id_idx").on(t.userId),
  ],
);

// Las invitaciones se consultan por hash del token sin conocer la tienda,
// por eso no tienen RLS. El token es aleatorio y solo se guarda su hash.
export const invitations = pgTable(
  "invitations",
  {
    id: uuid().primaryKey().defaultRandom(),
    email: text().notNull(),
    storeId: uuid()
      .notNull()
      .references(() => stores.id, { onDelete: "cascade" }),
    roleId: uuid().notNull(),
    tokenHash: text().notNull().unique(),
    expiresAt: timestamp({ withTimezone: true }).notNull(),
    acceptedAt: timestamp({ withTimezone: true }),
    revokedAt: timestamp({ withTimezone: true }),
    // Transferencia de propiedad: al aceptar, este miembro deja de ser propietario y pasa a replacementRoleId.
    replacesMemberId: uuid(),
    replacementRoleId: uuid(),
    createdByUserId: uuid()
      .notNull()
      .references(() => users.id),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("invitations_store_id_idx").on(t.storeId),
    foreignKey({
      name: "invitations_role_fk",
      columns: [t.storeId, t.roleId],
      foreignColumns: [storeRoles.storeId, storeRoles.id],
    }),
    foreignKey({
      name: "invitations_replacement_role_fk",
      columns: [t.storeId, t.replacementRoleId],
      foreignColumns: [storeRoles.storeId, storeRoles.id],
    }),
  ],
);
