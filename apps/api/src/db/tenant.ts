import { sql } from "drizzle-orm";
import type { Db, Tx } from "./client.js";

export type DbContext = {
  storeId?: string;
  userId?: string;
};

// Ejecuta fn en una transacción con el rol de aplicación (sin BYPASSRLS) y el contexto
// que leen las políticas RLS. set_config con is_local=true limita el valor a la transacción.
export function withDbContext<T>(
  db: Db,
  context: DbContext,
  fn: (tx: Tx) => Promise<T>,
): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`SET LOCAL ROLE commerce_app`);
    if (context.storeId) {
      await tx.execute(sql`SELECT set_config('app.store_id', ${context.storeId}, true)`);
    }
    if (context.userId) {
      await tx.execute(sql`SELECT set_config('app.user_id', ${context.userId}, true)`);
    }
    return fn(tx);
  });
}
