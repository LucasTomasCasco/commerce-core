import { loadEnv } from "../config/env.js";
import { createDb } from "./client.js";
import { seed } from "./seed.js";

const env = loadEnv();
const { client, db } = createDb(env.DATABASE_URL);

try {
  await seed(db, {
    platformAdminEmail: requireEnv("PLATFORM_ADMIN_EMAIL"),
    platformAdminPassword: requireEnv("PLATFORM_ADMIN_PASSWORD"),
  });
  console.log("Seed aplicado");
} finally {
  await client.end();
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Falta la variable ${name}`);
  return value;
}
