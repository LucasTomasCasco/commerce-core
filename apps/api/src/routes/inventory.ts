import type { FastifyPluginCallbackZod } from "fastify-type-provider-zod";
import { z } from "zod";
import { paginated, paginationQuery } from "../http/pagination.js";
import { requireStoreAccess } from "../http/guards.js";
import { currentAuth, requireSession } from "../http/session.js";

const movementSchema = z.object({
  id: z.uuid(),
  storeId: z.uuid(),
  productId: z.uuid(),
  type: z.enum(["purchase", "sale", "sale_cancel", "adjustment"]),
  quantityDelta: z.number().int(),
  reason: z.string().nullable(),
  orderId: z.uuid().nullable(),
  createdByUserId: z.uuid(),
  createdAt: z.date(),
});

export const inventoryRoutes: FastifyPluginCallbackZod = (app, _options, done) => {
  const inventory = app.services.inventory;
  const auth = app.services.auth;
  const read = [requireSession(auth), requireStoreAccess(app.db, "stock:read")];
  const adjust = [requireSession(auth), requireStoreAccess(app.db, "stock:adjust")];

  app.get(
    "/stores/:storeId/stock-movements",
    {
      preValidation: read,
      schema: {
        tags: ["inventory"],
        summary: "Movimientos de stock",
        params: z.object({ storeId: z.uuid() }),
        querystring: paginationQuery.extend({ productId: z.uuid().optional() }),
        response: { 200: paginated(movementSchema) },
      },
    },
    (request) => inventory.listMovements({ storeId: request.params.storeId, ...request.query }),
  );

  app.post(
    "/stores/:storeId/stock-movements",
    {
      preValidation: adjust,
      schema: {
        tags: ["inventory"],
        summary: "Registrar entrada o ajuste de stock",
        params: z.object({ storeId: z.uuid() }),
        body: z.object({
          productId: z.uuid(),
          type: z.enum(["purchase", "adjustment"]),
          quantityDelta: z
            .number()
            .int()
            .refine((n) => n !== 0, "No puede ser cero"),
          reason: z.string().trim().min(3).max(200).optional(),
        }),
        response: {
          201: z.object({ movement: movementSchema, stockOnHand: z.number().int() }),
        },
      },
    },
    async (request, reply) =>
      reply.code(201).send(
        await inventory.registerMovement({
          storeId: request.params.storeId,
          actorUserId: currentAuth(request).user.id,
          ...request.body,
        }),
      ),
  );

  done();
};
