import type { FastifyPluginCallbackZod } from "fastify-type-provider-zod";
import { z } from "zod";
import { paginated, paginationQuery } from "../http/pagination.js";

const slugParams = z.object({ slug: z.string().min(1).max(60) });

const publicProductSchema = z.object({
  id: z.uuid(),
  sku: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  categoryId: z.uuid().nullable(),
  priceMinor: z.number().int().nonnegative(),
  currencyCode: z.string().length(3),
  inStock: z.boolean(),
});

// Storefront público: sin sesión. Solo tiendas activas y productos activos y no archivados.
export const publicStoreRoutes: FastifyPluginCallbackZod = (app, _options, done) => {
  const catalog = app.services.catalog;

  app.get(
    "/public/stores/:slug/categories",
    {
      schema: {
        tags: ["public"],
        summary: "Categorías visibles de una tienda",
        params: slugParams,
        response: {
          200: z.object({
            categories: z.array(z.object({ id: z.uuid(), name: z.string(), slug: z.string() })),
          }),
        },
      },
    },
    async (request) => ({ categories: await catalog.listPublicCategories(request.params.slug) }),
  );

  app.get(
    "/public/stores/:slug/products",
    {
      schema: {
        tags: ["public"],
        summary: "Productos visibles de una tienda",
        params: slugParams,
        querystring: paginationQuery.extend({
          categoryId: z.uuid().optional(),
          q: z.string().trim().min(1).max(100).optional(),
        }),
        response: { 200: paginated(publicProductSchema) },
      },
    },
    (request) => catalog.listPublicProducts(request.params.slug, request.query),
  );

  app.get(
    "/public/stores/:slug/products/:productId",
    {
      schema: {
        tags: ["public"],
        summary: "Detalle de un producto visible",
        params: z.object({ slug: z.string().min(1).max(60), productId: z.uuid() }),
        response: { 200: publicProductSchema },
      },
    },
    (request) => catalog.getPublicProduct(request.params.slug, request.params.productId),
  );

  done();
};
