import { buildApp } from "./app.js";
import { createSmtpMailer } from "./auth/mailer.js";
import { loadEnv } from "./config/env.js";
import { createDb } from "./db/client.js";

const env = loadEnv();
const { client, db } = createDb(env.DATABASE_URL);
const mailer = createSmtpMailer(env.SMTP_URL, env.MAIL_FROM);
const app = await buildApp({ env, db, mailer });

app.addHook("onClose", async () => {
  await client.end();
});

await app.listen({ port: env.PORT, host: "0.0.0.0" });
