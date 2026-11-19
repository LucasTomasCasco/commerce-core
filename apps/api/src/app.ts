import cookie from "@fastify/cookie";
import helmet from "@fastify/helmet";
import swagger from "@fastify/swagger";
import swaggerUi from "@fastify/swagger-ui";
import rateLimit from "@fastify/rate-limit";
import Fastify from "fastify";
import {
  jsonSchemaTransform,
  serializerCompiler,
  validatorCompiler,
  type ZodTypeProvider,
} from "fastify-type-provider-zod";
import type { Mailer } from "./auth/mailer.js";
import type { Env } from "./config/env.js";
import type { Db } from "./db/client.js";
import { registerErrorHandler } from "./http/error-handler.js";
import { authRoutes } from "./routes/auth.js";
import { healthRoutes } from "./routes/health.js";
import { storesRoutes } from "./routes/stores.js";
import { teamRoutes } from "./routes/team.js";
import { platformRoutes } from "./routes/platform.js";
import { invitationRoutes } from "./routes/invitations.js";
import { catalogRoutes } from "./routes/catalog.js";
import { publicStoreRoutes } from "./routes/public-store.js";
import { inventoryRoutes } from "./routes/inventory.js";
import { orderRoutes } from "./routes/orders.js";
import { auditRoutes } from "./routes/audit.js";
import { createServices } from "./services.js";

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

  // La API sirve JSON; el CSP de helmet se desactiva para que Swagger UI cargue sus scripts.
  await app.register(helmet, { contentSecurityPolicy: false });
  await app.register(cookie);
  await app.register(rateLimit, { global: false });

  app.decorate("db", db);
  app.decorate("services", createServices({ db, mailer, env }));
  app.decorateRequest("auth", null);
  app.decorateRequest("store", null);

  await app.register(swagger, {
    openapi: {
      info: { title: "Commerce Core API", version: "1.0.0" },
    },
    transform: jsonSchemaTransform,
  });
  await app.register(swaggerUi, { routePrefix: "/docs" });
  app.get("/openapi.json", { schema: { hide: true } }, () => app.swagger());

  await app.register(healthRoutes, { prefix: "/api/v1" });
  await app.register(authRoutes(env), { prefix: "/api/v1/auth" });
  await app.register(storesRoutes, { prefix: "/api/v1" });
  await app.register(teamRoutes, { prefix: "/api/v1" });
  await app.register(platformRoutes, { prefix: "/api/v1" });
  await app.register(invitationRoutes(env), { prefix: "/api/v1" });
  await app.register(catalogRoutes, { prefix: "/api/v1" });
  await app.register(publicStoreRoutes, { prefix: "/api/v1" });
  await app.register(inventoryRoutes, { prefix: "/api/v1" });
  await app.register(orderRoutes, { prefix: "/api/v1" });
  await app.register(auditRoutes, { prefix: "/api/v1" });

  return app;
}
