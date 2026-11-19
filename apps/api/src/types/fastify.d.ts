import type { AuthService } from "../auth/auth-service.js";
import type { Db } from "../db/client.js";
import type { AuthContext } from "../http/session.js";
import type { StoreAccess } from "../tenancy/store-access.js";

declare module "fastify" {
  interface FastifyInstance {
    auth: AuthService;
    db: Db;
  }

  interface FastifyRequest {
    auth: AuthContext | null;
    store: StoreAccess | null;
  }
}
