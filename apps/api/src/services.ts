import { createAuthService } from "./auth/auth-service.js";
import type { Mailer } from "./auth/mailer.js";
import type { Env } from "./config/env.js";
import type { Db } from "./db/client.js";
import { createAuditService } from "./audit/audit-service.js";
import { createCatalogService } from "./catalog/catalog-service.js";
import { createInventoryService } from "./inventory/inventory-service.js";
import { createOrderService } from "./sales/order-service.js";
import { createPlatformService } from "./platform/platform-service.js";
import { createInvitationService } from "./team/invitation-service.js";
import { createTeamService } from "./team/team-service.js";

export type ServicesDeps = {
  db: Db;
  mailer: Mailer;
  env: Pick<Env, "SESSION_TTL_DAYS" | "APP_ORIGIN">;
};

// Un solo punto de construcción: cada servicio recibe sus dependencias explícitas.
export function createServices({ db, mailer, env }: ServicesDeps) {
  const deps = { db, mailer, sessionTtlDays: env.SESSION_TTL_DAYS, appOrigin: env.APP_ORIGIN };
  const auth = createAuthService(deps);
  const invitations = createInvitationService(deps);
  const team = createTeamService({ db, invitations });
  const platform = createPlatformService({ db, invitations, team });
  const catalog = createCatalogService({ db });
  const inventory = createInventoryService({ db });
  const orders = createOrderService({ db });
  const audit = createAuditService({ db });
  return { auth, invitations, platform, team, catalog, inventory, orders, audit };
}

export type Services = ReturnType<typeof createServices>;
