import { buildApp } from "../../src/app.js";
import type { MailMessage } from "../../src/auth/mailer.js";
import { loadEnv } from "../../src/config/env.js";
import { createTestDb, TEST_DATABASE_URL } from "./db.js";

export async function buildTestApp(options: { rateLimitMax?: number } = {}) {
  const { client, db } = createTestDb();
  const sent: MailMessage[] = [];
  const app = await buildApp({
    env: loadEnv({
      DATABASE_URL: TEST_DATABASE_URL,
      LOG_LEVEL: "silent",
      AUTH_RATE_LIMIT_MAX: String(options.rateLimitMax ?? 1000),
    }),
    db,
    mailer: {
      send(message) {
        sent.push(message);
        return Promise.resolve();
      },
    },
  });

  return {
    app,
    db,
    sent,
    async close() {
      await app.close();
      await client.end();
    },
  };
}
