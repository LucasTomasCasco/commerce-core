import { buildApp } from "./app.js";
import { createSmtpMailer } from "./auth/mailer.js";
import { loadEnv } from "./config/env.js";
import { createDb } from "./db/client.js";
import { assertRowLevelSecurityEnforced } from "./db/guard.js";
import { startWorker } from "./jobs/worker.js";

const env = loadEnv();
const { client, db } = createDb(env.DATABASE_URL);

// En producción la API no puede correr con un rol que salte RLS (superusuario o BYPASSRLS).
if (env.NODE_ENV === "production") {
  await assertRowLevelSecurityEnforced(db);
}

const app = await buildApp({ env, db });
const mailer = createSmtpMailer(env.SMTP_URL, env.MAIL_FROM);
const stopWorker = startWorker({
  db,
  mailer,
  intervalMs: env.JOB_INTERVAL_SECONDS * 1000,
  orderPendingTtlHours: env.ORDER_PENDING_TTL_HOURS,
  idempotencyRetentionHours: env.IDEMPOTENCY_RETENTION_HOURS,
  onError: (error) => {
    app.log.error({ err: error }, "falló un job de fondo");
  },
});

app.addHook("onClose", async () => {
  stopWorker();
  await client.end();
});

await app.listen({ port: env.PORT, host: "0.0.0.0" });
