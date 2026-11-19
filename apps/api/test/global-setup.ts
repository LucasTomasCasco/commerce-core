import postgres from "postgres";
import { runMigrations } from "../src/db/migrate.js";
import { TEST_DATABASE_URL } from "./support/db.js";

const ADMIN_URL =
  process.env.TEST_ADMIN_URL ?? "postgres://commerce:commerce@localhost:5432/postgres";
const TEST_DB_NAME = new URL(TEST_DATABASE_URL).pathname.slice(1);

// Crea la base de tests si no existe y aplica las migraciones una vez por corrida.
export default async function setup() {
  const admin = postgres(ADMIN_URL, { max: 1 });
  try {
    const exists = await admin`SELECT 1 FROM pg_database WHERE datname = ${TEST_DB_NAME}`;
    if (exists.length === 0) {
      await admin.unsafe(`CREATE DATABASE "${TEST_DB_NAME}"`);
    }
  } finally {
    await admin.end();
  }
  await runMigrations(TEST_DATABASE_URL);
}
