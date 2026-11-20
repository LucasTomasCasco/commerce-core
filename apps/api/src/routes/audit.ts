import type { FastifyPluginCallbackZod } from "fastify-type-provider-zod";
import { z } from "zod";
import { paginated, paginationQuery } from "../http/pagination.js";
import { requireStoreAccess, requirePlatformAdmin } from "../http/guards.js";
import { requireSession } from "../http/session.js";

const storeParams = z.object({ storeId: z.uuid() });

export const auditEntrySchema = z.object({
  id: z.uuid(),
  action: z.string(),
  entity: z.string(),
  entityId: z.string(),
  metadata: z.record(z.string(), z.unknown()),
  createdAt: z.coerce.date(),
  actorUserId: z.uuid(),
  actorEmail: z.email(),
  actorName: z.string(),
});

export const auditRoutes: FastifyPluginCallbackZod = (app, _options, done) => {
  const audit = app.services.audit;
  const auth = app.services.auth;

  app.get(
    "/stores/:storeId/audit",
    {
      preValidation: [requireSession(auth), requireStoreAccess(app.db, "audit:read")],
      schema: {
        tags: ["audit"],
        summary: "Auditoría de la tienda",
        params: storeParams,
        querystring: paginationQuery,
        response: { 200: paginated(auditEntrySchema) },
      },
    },
    (request) => audit.listEntries({ storeId: request.params.storeId, ...request.query }),
  );

  // El administrador general audita cualquier tienda sin operar sus datos.
  app.get(
    "/platform/stores/:storeId/audit",
    {
      preValidation: [requireSession(auth), requirePlatformAdmin()],
      schema: {
        tags: ["platform"],
        summary: "Auditoría de una tienda (administrador general)",
        params: storeParams,
        querystring: paginationQuery,
        response: { 200: paginated(auditEntrySchema) },
      },
    },
    (request) => audit.listEntries({ storeId: request.params.storeId, ...request.query }),
  );

  done();
};
