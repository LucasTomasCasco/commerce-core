import type { FastifyPluginCallbackZod } from "fastify-type-provider-zod";
import { z } from "zod";

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
  done();
};
