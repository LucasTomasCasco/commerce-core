import type { Db } from "../db/client.js";
import type { Services } from "../services.js";
import type { AuthContext } from "../http/session.js";
import type { StoreAccess } from "../tenancy/store-access.js";

declare module "fastify" {
  interface FastifyInstance {
    db: Db;
    services: Services;
  }

  interface FastifyRequest {
    auth: AuthContext | null;
    store: StoreAccess | null;
  }
}
