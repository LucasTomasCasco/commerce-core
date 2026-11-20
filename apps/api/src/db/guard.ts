import { sql } from "drizzle-orm";
import type { Db } from "./client.js";

// Confirma que el rol con el que corre la API no salta RLS. Un superusuario o un rol con BYPASSRLS
// ignora las políticas aunque la tabla tenga FORCE, así que un error de filtrado quedaría sin red.
export async function assertRowLevelSecurityEnforced(db: Db): Promise<void> {
  const rows = await db.execute<{ rolsuper: boolean; rolbypassrls: boolean }>(
    sql`SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname = current_user`,
  );
  const role = rows[0];
  if (!role) throw new Error("No se pudo leer el rol de la conexión");
  if (role.rolsuper || role.rolbypassrls) {
    throw new Error(
      "La API no puede correr con un rol superusuario o BYPASSRLS: usar un rol de aplicación dueño de las tablas sin esos privilegios",
    );
  }
}
