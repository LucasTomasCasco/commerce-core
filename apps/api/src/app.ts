import cookie from "@fastify/cookie";
import helmet from "@fastify/helmet";
import rateLimit from "@fastify/rate-limit";
import Fastify from "fastify";
import {
  serializerCompiler,
  validatorCompiler,
  type ZodTypeProvider,
} from "fastify-type-provider-zod";
import { createAuthService } from "./auth/auth-service.js";
import type { Mailer } from "./auth/mailer.js";
import type { Env } from "./config/env.js";
import type { Db } from "./db/client.js";
import { registerErrorHandler } from "./http/error-handler.js";
import { authRoutes } from "./routes/auth.js";
import { healthRoutes } from "./routes/health.js";
import { storesRoutes } from "./routes/stores.js";

export type AppDeps = {
  env: Env;
  db: Db;
  mailer: Mailer;
};

export async function buildApp({ env, db, mailer }: AppDeps) {
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

  await app.register(helmet);
  await app.register(cookie);
  await app.register(rateLimit, { global: false });

  app.decorate(
    "auth",
    createAuthService({
      db,
      mailer,
      sessionTtlDays: env.SESSION_TTL_DAYS,
      appOrigin: env.APP_ORIGIN,
    }),
  );
  app.decorate("db", db);
  app.decorateRequest("auth", null);
  app.decorateRequest("store", null);

  await app.register(healthRoutes, { prefix: "/api/v1" });
  await app.register(authRoutes(env), { prefix: "/api/v1/auth" });
  await app.register(storesRoutes, { prefix: "/api/v1" });

  return app;
}
