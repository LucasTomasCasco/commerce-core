import { createAuthService } from "./auth/auth-service.js";
import type { Mailer } from "./auth/mailer.js";
import type { Env } from "./config/env.js";
import type { Db } from "./db/client.js";
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
  const platform = createPlatformService({ db, invitations });
  const team = createTeamService({ db, invitations });
  return { auth, invitations, platform, team };
}

export type Services = ReturnType<typeof createServices>;
