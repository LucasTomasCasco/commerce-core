import cookie from "@fastify/cookie";
import helmet from "@fastify/helmet";
import rateLimit from "@fastify/rate-limit";
import swagger from "@fastify/swagger";
import swaggerUi from "@fastify/swagger-ui";
import Fastify from "fastify";
import {
  jsonSchemaTransform,
  serializerCompiler,
  validatorCompiler,
  type ZodTypeProvider,
} from "fastify-type-provider-zod";
import type { Env } from "./config/env.js";
import type { Db } from "./db/client.js";
import { registerErrorHandler } from "./http/error-handler.js";
import { AppError } from "./http/errors.js";
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
};

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

export async function buildApp({ env, db }: AppDeps) {
  const app = Fastify({
    logger: {
      level: env.LOG_LEVEL,
      // Contraseñas, tokens y cookies nunca salen en logs (los tokens ya no viajan en la URL).
      redact: [
        "req.headers.cookie",
        "res.headers['set-cookie']",
        "req.body.password",
        "req.body.token",
        "req.body.newPassword",
        "*.password",
        "*.token",
      ],
    },
    requestIdHeader: "x-request-id",
    // Solo se confía en X-Forwarded-For de los saltos de proxy configurados (nginx = 1).
    trustProxy:
      env.TRUST_PROXY === 0 ? false : (_address: string, hop: number) => hop < env.TRUST_PROXY,
  }).withTypeProvider<ZodTypeProvider>();

  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  registerErrorHandler(app);

  // Protección CSRF: la cookie de sesión es SameSite=Lax, y además todo request que cambia estado
  // y declara un Origin distinto del propio se rechaza. Sin Origin (curl, servidor a servidor) pasa.
  app.addHook("onRequest", (request, _reply, done) => {
    if (SAFE_METHODS.has(request.method)) {
      done();
      return;
    }
    const origin = request.headers.origin;
    if (origin !== undefined && origin !== env.APP_ORIGIN) {
      done(new AppError(403, "CSRF_ORIGIN_MISMATCH", "Origen de la petición no permitido"));
      return;
    }
    done();
  });

  await app.register(helmet, { contentSecurityPolicy: false });
  await app.register(cookie);
  await app.register(rateLimit, { global: false });

  app.decorate("db", db);
  app.decorate("services", createServices({ db, env }));
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
