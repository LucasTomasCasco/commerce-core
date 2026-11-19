import type { FastifyPluginCallbackZod } from "fastify-type-provider-zod";
import { sql } from "drizzle-orm";
import { z } from "zod";
import { AppError } from "../http/errors.js";

export const healthRoutes: FastifyPluginCallbackZod = (app, _options, done) => {
  app.get(
    "/health",
    {
      schema: {
        tags: ["system"],
        summary: "Estado del servicio",
        response: {
          200: z.object({ status: z.literal("ok") }),
        },
      },
    },
    () => ({ status: "ok" as const }),
  );

  // Readiness: además del proceso, verifica que la base responda.
  app.get(
    "/ready",
    {
      schema: {
        tags: ["system"],
        summary: "Servicio listo para recibir tráfico",
        response: { 200: z.object({ status: z.literal("ready") }) },
      },
    },
    async () => {
      try {
        await app.db.execute(sql`SELECT 1`);
      } catch {
        throw new AppError(503, "NOT_READY", "La base de datos no está disponible");
      }
      return { status: "ready" as const };
    },
  );
  done();
};
