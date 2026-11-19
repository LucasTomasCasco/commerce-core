import type { FastifyPluginCallbackZod } from "fastify-type-provider-zod";
import { z } from "zod";
import { paginated, paginationQuery } from "../http/pagination.js";
import { requireStoreAccess } from "../http/guards.js";
import { currentAuth, requireSession } from "../http/session.js";

const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const uuidParam = z.object({ storeId: z.uuid() });
const categoryParams = z.object({ storeId: z.uuid(), categoryId: z.uuid() });
const productParams = z.object({ storeId: z.uuid(), productId: z.uuid() });
const moneyMinor = z.number().int().nonnegative();

const categorySchema = z.object({
  id: z.uuid(),
  storeId: z.uuid(),
  name: z.string(),
  slug: z.string(),
  archivedAt: z.date().nullable(),
  createdAt: z.date(),
  updatedAt: z.date(),
});

const productSchema = z.object({
  id: z.uuid(),
  storeId: z.uuid(),
  categoryId: z.uuid().nullable(),
  sku: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  priceMinor: moneyMinor,
  stockOnHand: z.number().int(),
  active: z.boolean(),
  archivedAt: z.date().nullable(),
  createdAt: z.date(),
  updatedAt: z.date(),
});

const productListQuery = paginationQuery.extend({
  categoryId: z.uuid().optional(),
  active: z.stringbool().optional(),
  q: z.string().trim().min(1).max(100).optional(),
  includeArchived: z.stringbool().optional(),
});

export const catalogRoutes: FastifyPluginCallbackZod = (app, _options, done) => {
  const catalog = app.services.catalog;
  const auth = app.services.auth;
  const read = [requireSession(auth), requireStoreAccess(app.db, "products:read")];
  const manageCategories = [requireSession(auth), requireStoreAccess(app.db, "categories:manage")];
  const manageProducts = [requireSession(auth), requireStoreAccess(app.db, "products:manage")];

  app.get(
    "/stores/:storeId/categories",
    {
      preHandler: read,
      schema: {
        tags: ["catalog"],
        summary: "Categorías de la tienda",
        params: uuidParam,
        querystring: z.object({ includeArchived: z.stringbool().optional() }),
        response: { 200: z.object({ categories: z.array(categorySchema) }) },
      },
    },
    async (request) => ({
      categories: await catalog.listCategories({
        storeId: request.params.storeId,
        includeArchived: request.query.includeArchived,
      }),
    }),
  );

  app.post(
    "/stores/:storeId/categories",
    {
      preHandler: manageCategories,
      schema: {
        tags: ["catalog"],
        summary: "Crear categoría",
        params: uuidParam,
        body: z.object({
          name: z.string().trim().min(1).max(80),
          slug: z.string().min(2).max(80).regex(SLUG_PATTERN),
        }),
        response: { 201: categorySchema },
      },
    },
    async (request, reply) =>
      reply.code(201).send(
        await catalog.createCategory({
          storeId: request.params.storeId,
          actorUserId: currentAuth(request).user.id,
          ...request.body,
        }),
      ),
  );

  app.patch(
    "/stores/:storeId/categories/:categoryId",
    {
      preHandler: manageCategories,
      schema: {
        tags: ["catalog"],
        summary: "Editar categoría",
        params: categoryParams,
        body: z
          .object({
            name: z.string().trim().min(1).max(80),
            slug: z.string().min(2).max(80).regex(SLUG_PATTERN),
          })
          .partial(),
        response: { 200: categorySchema },
      },
    },
    (request) =>
      catalog.updateCategory({
        storeId: request.params.storeId,
        categoryId: request.params.categoryId,
        actorUserId: currentAuth(request).user.id,
        ...request.body,
      }),
  );

  app.delete(
    "/stores/:storeId/categories/:categoryId",
    {
      preHandler: manageCategories,
      schema: {
        tags: ["catalog"],
        summary: "Archivar categoría",
        params: categoryParams,
        response: { 204: z.null() },
      },
    },
    async (request, reply) => {
      await catalog.archiveCategory({
        storeId: request.params.storeId,
        categoryId: request.params.categoryId,
        actorUserId: currentAuth(request).user.id,
      });
      return reply.code(204).send(null);
    },
  );

  app.get(
    "/stores/:storeId/products",
    {
      preHandler: read,
      schema: {
        tags: ["catalog"],
        summary: "Productos de la tienda con filtros",
        params: uuidParam,
        querystring: productListQuery,
        response: { 200: paginated(productSchema) },
      },
    },
    (request) => catalog.listProducts({ storeId: request.params.storeId, ...request.query }),
  );

  app.post(
    "/stores/:storeId/products",
    {
      preHandler: manageProducts,
      schema: {
        tags: ["catalog"],
        summary: "Crear producto",
        params: uuidParam,
        body: z.object({
          sku: z.string().trim().min(1).max(64),
          name: z.string().trim().min(1).max(160),
          description: z.string().trim().max(2000).optional(),
          categoryId: z.uuid().optional(),
          priceMinor: moneyMinor,
        }),
        response: { 201: productSchema },
      },
    },
    async (request, reply) =>
      reply.code(201).send(
        await catalog.createProduct({
          storeId: request.params.storeId,
          actorUserId: currentAuth(request).user.id,
          ...request.body,
        }),
      ),
  );

  app.get(
    "/stores/:storeId/products/:productId",
    {
      preHandler: read,
      schema: {
        tags: ["catalog"],
        summary: "Detalle de producto",
        params: productParams,
        response: { 200: productSchema },
      },
    },
    (request) =>
      catalog.getProduct({
        storeId: request.params.storeId,
        productId: request.params.productId,
      }),
  );

  app.patch(
    "/stores/:storeId/products/:productId",
    {
      preHandler: manageProducts,
      schema: {
        tags: ["catalog"],
        summary: "Editar producto",
        params: productParams,
        body: z
          .object({
            sku: z.string().trim().min(1).max(64),
            name: z.string().trim().min(1).max(160),
            description: z.string().trim().max(2000).nullable(),
            categoryId: z.uuid().nullable(),
            priceMinor: moneyMinor,
            active: z.boolean(),
          })
          .partial(),
        response: { 200: productSchema },
      },
    },
    (request) =>
      catalog.updateProduct({
        storeId: request.params.storeId,
        productId: request.params.productId,
        actorUserId: currentAuth(request).user.id,
        ...request.body,
      }),
  );

  app.delete(
    "/stores/:storeId/products/:productId",
    {
      preHandler: manageProducts,
      schema: {
        tags: ["catalog"],
        summary: "Archivar producto",
        params: productParams,
        response: { 204: z.null() },
      },
    },
    async (request, reply) => {
      await catalog.archiveProduct({
        storeId: request.params.storeId,
        productId: request.params.productId,
        actorUserId: currentAuth(request).user.id,
      });
      return reply.code(204).send(null);
    },
  );

  done();
};
