import type { FastifyPluginCallbackZod } from "fastify-type-provider-zod";
import { z } from "zod";
import { paginated, paginationQuery } from "../http/pagination.js";
import { requirePlatformAdmin } from "../http/guards.js";
import { currentAuth, requireSession } from "../http/session.js";

const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

const storeSchema = z.object({
  id: z.uuid(),
  slug: z.string(),
  name: z.string(),
  status: z.enum(["draft", "active", "suspended"]),
  currencyCode: z.string().length(3),
  createdAt: z.date(),
  updatedAt: z.date(),
});

const currencySchema = z.object({
  code: z.string().length(3),
  name: z.string(),
  minorUnit: z.number().int(),
  isActive: z.boolean(),
});

export const platformRoutes: FastifyPluginCallbackZod = (app, _options, done) => {
  const platform = app.services.platform;
  const guard = [requireSession(app.services.auth), requirePlatformAdmin()];

  app.get(
    "/platform/stores",
    {
      preHandler: guard,
      schema: {
        tags: ["platform"],
        summary: "Listar tiendas",
        querystring: paginationQuery,
        response: { 200: paginated(storeSchema) },
      },
    },
    (request) => platform.listStores(request.query),
  );

  app.post(
    "/platform/stores",
    {
      preHandler: guard,
      schema: {
        tags: ["platform"],
        summary: "Crear tienda e invitar a su propietario",
        body: z.object({
          name: z.string().trim().min(1).max(120),
          slug: z.string().min(3).max(60).regex(SLUG_PATTERN),
          currencyCode: z.string().length(3),
          ownerEmail: z.email(),
        }),
        response: { 201: storeSchema },
      },
    },
    async (request, reply) => {
      const store = await platform.createStore({
        actorUserId: currentAuth(request).user.id,
        ...request.body,
      });
      return reply.code(201).send(store);
    },
  );

  app.get(
    "/platform/stores/:storeId",
    {
      preHandler: guard,
      schema: {
        tags: ["platform"],
        summary: "Detalle de una tienda",
        params: z.object({ storeId: z.uuid() }),
        response: { 200: storeSchema },
      },
    },
    (request) => platform.getStore(request.params.storeId),
  );

  app.patch(
    "/platform/stores/:storeId",
    {
      preHandler: guard,
      schema: {
        tags: ["platform"],
        summary: "Editar tienda o cambiar su estado",
        params: z.object({ storeId: z.uuid() }),
        body: z
          .object({
            name: z.string().trim().min(1).max(120),
            status: z.enum(["active", "suspended"]),
          })
          .partial(),
        response: { 200: storeSchema },
      },
    },
    (request) =>
      platform.updateStore({
        actorUserId: currentAuth(request).user.id,
        storeId: request.params.storeId,
        ...request.body,
      }),
  );

  app.post(
    "/platform/stores/:storeId/owner-invitation/resend",
    {
      preHandler: guard,
      schema: {
        tags: ["platform"],
        summary: "Reenviar la invitación al propietario de una tienda",
        params: z.object({ storeId: z.uuid() }),
        response: { 202: z.null() },
      },
    },
    async (request, reply) => {
      await platform.resendOwnerInvitation({
        actorUserId: currentAuth(request).user.id,
        storeId: request.params.storeId,
      });
      return reply.code(202).send(null);
    },
  );

  app.get(
    "/platform/currencies",
    {
      preHandler: guard,
      schema: {
        tags: ["platform"],
        summary: "Monedas disponibles",
        response: { 200: z.object({ currencies: z.array(currencySchema) }) },
      },
    },
    async () => ({ currencies: await platform.listCurrencies() }),
  );

  app.post(
    "/platform/currencies",
    {
      preHandler: guard,
      schema: {
        tags: ["platform"],
        summary: "Agregar una moneda",
        body: z.object({
          code: z.string().regex(/^[A-Z]{3}$/),
          name: z.string().trim().min(1).max(60),
          minorUnit: z.number().int().min(0).max(4),
        }),
        response: { 201: currencySchema },
      },
    },
    async (request, reply) => reply.code(201).send(await platform.createCurrency(request.body)),
  );

  app.patch(
    "/platform/currencies/:code",
    {
      preHandler: guard,
      schema: {
        tags: ["platform"],
        summary: "Editar o desactivar una moneda",
        params: z.object({ code: z.string().regex(/^[A-Z]{3}$/) }),
        body: z.object({ name: z.string().trim().min(1).max(60), isActive: z.boolean() }).partial(),
        response: { 200: currencySchema },
      },
    },
    (request) => platform.updateCurrency({ code: request.params.code, ...request.body }),
  );

  done();
};
