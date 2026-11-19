import type { FastifyPluginCallbackZod } from "fastify-type-provider-zod";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { PERMISSIONS } from "../domain/permissions.js";
import { withDbContext } from "../db/tenant.js";
import { storeMembers, storeRoles, stores } from "../db/schema/index.js";
import { AppError } from "../http/errors.js";
import { requireStoreAccess } from "../http/guards.js";
import { requireSession } from "../http/session.js";

const storeSchema = z.object({
  id: z.uuid(),
  slug: z.string(),
  name: z.string(),
  status: z.enum(["draft", "active", "suspended"]),
  currencyCode: z.string().length(3),
});

const accessSchema = z.object({
  roleName: z.string(),
  isOwner: z.boolean(),
  permissions: z.array(z.enum(PERMISSIONS)),
});

const roleSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  permissions: z.array(z.enum(PERMISSIONS)),
  isSystem: z.boolean(),
});

export const storesRoutes: FastifyPluginCallbackZod = (app, _options, done) => {
  app.get(
    "/me/stores",
    {
      preHandler: requireSession(app.auth),
      schema: {
        tags: ["stores"],
        summary: "Tiendas en las que tengo membresía",
        response: {
          200: z.object({ stores: z.array(storeSchema.extend({ access: accessSchema })) }),
        },
      },
    },
    async (request) => {
      if (!request.auth) throw new AppError(401, "UNAUTHENTICATED", "Necesitas iniciar sesión");
      const userId = request.auth.user.id;

      const rows = await withDbContext(app.db, { userId }, (tx) =>
        tx
          .select({ store: stores, member: storeMembers, role: storeRoles })
          .from(storeMembers)
          .innerJoin(stores, eq(stores.id, storeMembers.storeId))
          .innerJoin(storeRoles, eq(storeRoles.id, storeMembers.roleId))
          .where(eq(storeMembers.userId, userId)),
      );

      return {
        stores: rows.map((row) => ({
          id: row.store.id,
          slug: row.store.slug,
          name: row.store.name,
          status: row.store.status,
          currencyCode: row.store.currencyCode,
          access: {
            roleName: row.role.name,
            isOwner: row.member.isOwner,
            permissions: row.role.permissions as (typeof PERMISSIONS)[number][],
          },
        })),
      };
    },
  );

  app.get(
    "/stores/:storeId",
    {
      preHandler: [requireSession(app.auth), requireStoreAccess(app.db)],
      schema: {
        tags: ["stores"],
        summary: "Detalle de la tienda y mi acceso",
        params: z.object({ storeId: z.uuid() }),
        response: { 200: z.object({ store: storeSchema, access: accessSchema }) },
      },
    },
    (request) => {
      if (!request.store) throw new AppError(404, "STORE_NOT_FOUND", "Tienda no encontrada");
      const { store, ...access } = request.store;
      return { store, access };
    },
  );

  app.get(
    "/stores/:storeId/roles",
    {
      preHandler: [requireSession(app.auth), requireStoreAccess(app.db, "team:manage")],
      schema: {
        tags: ["team"],
        summary: "Roles de la tienda",
        params: z.object({ storeId: z.uuid() }),
        response: { 200: z.object({ roles: z.array(roleSchema) }) },
      },
    },
    async (request) => {
      if (!request.store) throw new AppError(404, "STORE_NOT_FOUND", "Tienda no encontrada");
      const storeId = request.store.store.id;

      const roles = await withDbContext(app.db, { storeId }, (tx) =>
        tx
          .select()
          .from(storeRoles)
          .where(eq(storeRoles.storeId, storeId))
          .orderBy(storeRoles.name),
      );

      return {
        roles: roles.map((role) => ({
          id: role.id,
          name: role.name,
          permissions: role.permissions as (typeof PERMISSIONS)[number][],
          isSystem: role.isSystem,
        })),
      };
    },
  );

  done();
};
