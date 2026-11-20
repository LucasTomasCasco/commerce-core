import { buildApp } from "../../src/app.js";
import type { MailMessage } from "../../src/auth/mailer.js";
import { loadEnv } from "../../src/config/env.js";
import { processOutbox } from "../../src/outbox/outbox.js";
import { createTestDb, TEST_DATABASE_URL } from "./db.js";

type TestAppOptions = {
  rateLimitMax?: number;
  trustProxy?: number;
  loginMaxFailures?: number;
  loginLockMinutes?: number;
  appOrigin?: string;
  orderPendingTtlHours?: number;
};

// Aplicación de prueba con base real. El outbox se procesa tras cada request (como el worker en
// producción) y los emails enviados quedan en `sent`.
export async function buildTestApp(options: TestAppOptions = {}) {
  const { client, db } = createTestDb();
  const sent: MailMessage[] = [];
  const mailer = {
    send(message: MailMessage) {
      sent.push(message);
      return Promise.resolve();
    },
  };
  const app = await buildApp({
    env: loadEnv({
      DATABASE_URL: TEST_DATABASE_URL,
      LOG_LEVEL: "silent",
      AUTH_RATE_LIMIT_MAX: String(options.rateLimitMax ?? 1000),
      TRUST_PROXY: String(options.trustProxy ?? 0),
      LOGIN_MAX_FAILURES: String(options.loginMaxFailures ?? 1000),
      LOGIN_LOCK_MINUTES: String(options.loginLockMinutes ?? 15),
      APP_ORIGIN: options.appOrigin ?? "http://localhost:5173",
      ORDER_PENDING_TTL_HOURS: String(options.orderPendingTtlHours ?? 48),
    }),
    db,
  });

  const originalInject = app.inject.bind(app);
  app.inject = ((request: unknown) =>
    originalInject(request as never).then(async (res) => {
      // Un 'ahora' algo futuro: en tests no se respeta el backoff y ningún email queda sin enviar por diferencias de reloj.
      await processOutbox(db, mailer, { now: new Date(Date.now() + 60 * 60 * 1000) });
      return res;
    })) as unknown as typeof app.inject;

  return {
    app,
    db,
    sent,
    mailer,
    async close() {
      await app.close();
      await client.end();
    },
  };
}
