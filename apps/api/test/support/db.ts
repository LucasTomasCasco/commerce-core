import { sql } from "drizzle-orm";
import { createDb, type Db } from "../../src/db/client.js";

export const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ?? "postgres://commerce:commerce@localhost:5432/commerce_core_test";

export function createTestDb() {
  return createDb(TEST_DATABASE_URL);
}

// Vacía todas las tablas de negocio entre tests. Las migraciones se conservan.
export async function resetDb(db: Db) {
  const rows = await db.execute<{ tablename: string }>(
    sql`SELECT tablename FROM pg_tables WHERE schemaname = 'public'`,
  );
  const tables = rows.map((r) => `"${r.tablename}"`).join(", ");
  await db.execute(sql.raw(`TRUNCATE ${tables} CASCADE`));
}

// Drizzle envuelve el error de Postgres; el mensaje útil está en `cause`.
export async function expectDbError(promise: Promise<unknown>, pattern: RegExp) {
  const error: unknown = await promise.then(
    () => undefined,
    (e: unknown) => e,
  );
  if (!(error instanceof Error)) {
    throw new Error("Se esperaba un error de base de datos y la operación fue exitosa");
  }
  const cause = (error as Error & { cause?: unknown }).cause;
  const message = cause instanceof Error ? cause.message : error.message;
  if (!pattern.test(message)) {
    throw new Error(`El error "${message}" no coincide con ${pattern.source}`);
  }
}
