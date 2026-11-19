import Fastify from "fastify";
import {
  serializerCompiler,
  validatorCompiler,
  type ZodTypeProvider,
} from "fastify-type-provider-zod";
import type { Env } from "./config/env.js";
import { registerErrorHandler } from "./http/error-handler.js";
import { healthRoutes } from "./routes/health.js";

export type AppDeps = {
  env: Env;
};

export async function buildApp({ env }: AppDeps) {
  const app = Fastify({
    logger: {
      level: env.LOG_LEVEL,
      redact: ["req.headers.cookie", "res.headers['set-cookie']", "*.password", "*.token"],
    },
    requestIdHeader: "x-request-id",
  }).withTypeProvider<ZodTypeProvider>();

  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  registerErrorHandler(app);

  await app.register(healthRoutes, { prefix: "/api/v1" });

  return app;
}
