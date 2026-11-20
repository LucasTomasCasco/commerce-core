import { createAuditService } from "./audit/audit-service.js";
import { createAuthService } from "./auth/auth-service.js";
import type { Env } from "./config/env.js";
import type { Db } from "./db/client.js";
import { createCatalogService } from "./catalog/catalog-service.js";
import { createInventoryService } from "./inventory/inventory-service.js";
import { createOrderService } from "./sales/order-service.js";
import { createPlatformService } from "./platform/platform-service.js";
import { createInvitationService } from "./team/invitation-service.js";
import { createTeamService } from "./team/team-service.js";

export type ServicesDeps = {
  db: Db;
  env: Pick<Env, "SESSION_TTL_DAYS" | "APP_ORIGIN" | "LOGIN_MAX_FAILURES" | "LOGIN_LOCK_MINUTES">;
};

// Un solo punto de construcción: cada servicio recibe sus dependencias explícitas.
// Los emails no se envían desde los servicios: se encolan en la misma transacción (ver outbox).
export function createServices({ db, env }: ServicesDeps) {
  const auth = createAuthService({
    db,
    sessionTtlDays: env.SESSION_TTL_DAYS,
    appOrigin: env.APP_ORIGIN,
    loginMaxFailures: env.LOGIN_MAX_FAILURES,
    loginLockMinutes: env.LOGIN_LOCK_MINUTES,
  });
  const invitations = createInvitationService({
    db,
    sessionTtlDays: env.SESSION_TTL_DAYS,
    appOrigin: env.APP_ORIGIN,
  });
  const team = createTeamService({ db, invitations });
  const platform = createPlatformService({ db, invitations, team });
  const catalog = createCatalogService({ db });
  const inventory = createInventoryService({ db });
  const orders = createOrderService({ db });
  const audit = createAuditService({ db });
  return { auth, invitations, platform, team, catalog, inventory, orders, audit };
}

export type Services = ReturnType<typeof createServices>;
