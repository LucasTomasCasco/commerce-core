import type { FastifyPluginCallbackZod } from "fastify-type-provider-zod";
import { z } from "zod";
import { paginated, paginationQuery } from "../http/pagination.js";
import { requireStoreAccess } from "../http/guards.js";
import { currentAuth, requireSession } from "../http/session.js";

const uuidParam = z.object({ storeId: z.uuid() });
const orderParams = z.object({ storeId: z.uuid(), orderId: z.uuid() });

const orderStatusSchema = z.enum(["pending", "confirmed", "fulfilled", "cancelled"]);

// Las fechas usan coerce: un reintento con Idempotency-Key devuelve la respuesta guardada como JSON,
// donde las fechas llegan como string ISO.
const orderSummarySchema = z.object({
  id: z.uuid(),
  storeId: z.uuid(),
  code: z.string(),
  status: orderStatusSchema,
  customerName: z.string(),
  customerPhone: z.string(),
  note: z.string().nullable(),
  currencyCode: z.string().length(3),
  totalMinor: z.number().int().nonnegative(),
  createdByUserId: z.uuid(),
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
});

const orderSchema = orderSummarySchema.extend({
  items: z.array(
    z.object({
      id: z.uuid(),
      productId: z.uuid(),
      skuSnapshot: z.string(),
      nameSnapshot: z.string(),
      unitPriceMinor: z.number().int().nonnegative(),
      quantity: z.number().int().positive(),
      lineTotalMinor: z.number().int().nonnegative(),
    }),
  ),
});

export const orderRoutes: FastifyPluginCallbackZod = (app, _options, done) => {
  const orders = app.services.orders;
  const auth = app.services.auth;
  const read = [requireSession(auth), requireStoreAccess(app.db, "orders:read")];
  const create = [requireSession(auth), requireStoreAccess(app.db, "orders:create")];
  const updateStatus = [requireSession(auth), requireStoreAccess(app.db, "orders:update_status")];
  const cancelPermission = [requireSession(auth), requireStoreAccess(app.db, "orders:cancel")];

  app.get(
    "/stores/:storeId/orders",
    {
      preHandler: read,
      schema: {
        tags: ["orders"],
        summary: "Pedidos de la tienda",
        params: uuidParam,
        querystring: paginationQuery.extend({ status: orderStatusSchema.optional() }),
        response: { 200: paginated(orderSummarySchema) },
      },
    },
    (request) => orders.listOrders({ storeId: request.params.storeId, ...request.query }),
  );

  app.post(
    "/stores/:storeId/orders",
    {
      preHandler: create,
      schema: {
        tags: ["orders"],
        summary: "Cargar un pedido manual",
        description: "Enviar Idempotency-Key evita crear dos pedidos ante un reintento.",
        params: uuidParam,
        headers: z.object({ "idempotency-key": z.string().trim().min(1).max(255).optional() }),
        body: z.object({
          customerName: z.string().trim().min(1).max(120),
          customerPhone: z.string().trim().min(6).max(30),
          note: z.string().trim().max(1000).optional(),
          items: z
            .array(z.object({ productId: z.uuid(), quantity: z.number().int().positive() }))
            .min(1)
            .max(100),
        }),
        response: { 201: orderSchema },
      },
    },
    async (request, reply) => {
      const order = await orders.createOrder({
        storeId: request.params.storeId,
        actorUserId: currentAuth(request).user.id,
        idempotencyKey: request.headers["idempotency-key"],
        ...request.body,
      });
      return reply.code(201).send(order);
    },
  );

  app.get(
    "/stores/:storeId/orders/:orderId",
    {
      preHandler: read,
      schema: {
        tags: ["orders"],
        summary: "Detalle de pedido",
        params: orderParams,
        response: { 200: orderSchema },
      },
    },
    (request) =>
      orders.getOrder({ storeId: request.params.storeId, orderId: request.params.orderId }),
  );

  app.post(
    "/stores/:storeId/orders/:orderId/confirm",
    {
      preHandler: updateStatus,
      schema: {
        tags: ["orders"],
        summary: "Confirmar pedido pendiente",
        params: orderParams,
        response: { 200: orderSchema },
      },
    },
    (request) =>
      orders.advance({
        storeId: request.params.storeId,
        orderId: request.params.orderId,
        actorUserId: currentAuth(request).user.id,
        from: "pending",
        to: "confirmed",
      }),
  );

  app.post(
    "/stores/:storeId/orders/:orderId/fulfill",
    {
      preHandler: updateStatus,
      schema: {
        tags: ["orders"],
        summary: "Marcar pedido confirmado como entregado",
        params: orderParams,
        response: { 200: orderSchema },
      },
    },
    (request) =>
      orders.advance({
        storeId: request.params.storeId,
        orderId: request.params.orderId,
        actorUserId: currentAuth(request).user.id,
        from: "confirmed",
        to: "fulfilled",
      }),
  );

  app.post(
    "/stores/:storeId/orders/:orderId/cancel",
    {
      preHandler: cancelPermission,
      schema: {
        tags: ["orders"],
        summary: "Cancelar pedido y devolver stock",
        params: orderParams,
        response: { 200: orderSchema },
      },
    },
    (request) =>
      orders.cancel({
        storeId: request.params.storeId,
        orderId: request.params.orderId,
        actorUserId: currentAuth(request).user.id,
      }),
  );

  done();
};
