import { writeFile } from "node:fs/promises";
import { buildApp } from "./app.js";
import { createSmtpMailer } from "./auth/mailer.js";
import { loadEnv } from "./config/env.js";
import { createDb } from "./db/client.js";

// Genera openapi.json desde las rutas reales. CI falla si el archivo versionado no coincide.
const env = loadEnv();
const { client, db } = createDb(env.DATABASE_URL);
const app = await buildApp({ env, db, mailer: createSmtpMailer(env.SMTP_URL, env.MAIL_FROM) });

try {
  await app.ready();
  await writeFile(
    new URL("../openapi.json", import.meta.url),
    `${JSON.stringify(app.swagger(), null, 2)}\n`,
  );
  console.log("openapi.json actualizado");
} finally {
  await app.close();
  await client.end();
}
