import { and, eq } from "drizzle-orm";
import type { Db } from "../db/client.js";
import { withDbContext } from "../db/tenant.js";
import { storeRoles, storeMembers, stores } from "../db/schema/index.js";
import type { Permission } from "../domain/permissions.js";

export type StoreAccess = {
  store: {
    id: string;
    slug: string;
    name: string;
    status: "draft" | "active" | "suspended";
    currencyCode: string;
  };
  roleName: string;
  isOwner: boolean;
  permissions: Permission[];
};

// Devuelve la membresía del usuario en la tienda, o null si no es miembro.
// La consulta corre con contexto de tienda: RLS impide ver membresías ajenas.
export async function resolveStoreAccess(
  db: Db,
  input: { storeId: string; userId: string },
): Promise<StoreAccess | null> {
  const [row] = await withDbContext(db, { storeId: input.storeId }, (tx) =>
    tx
      .select({ store: stores, member: storeMembers, role: storeRoles })
      .from(storeMembers)
      .innerJoin(stores, eq(stores.id, storeMembers.storeId))
      .innerJoin(
        storeRoles,
        and(eq(storeRoles.storeId, storeMembers.storeId), eq(storeRoles.id, storeMembers.roleId)),
      )
      .where(and(eq(storeMembers.storeId, input.storeId), eq(storeMembers.userId, input.userId)))
      .limit(1),
  );
  if (!row) return null;

  return {
    store: {
      id: row.store.id,
      slug: row.store.slug,
      name: row.store.name,
      status: row.store.status,
      currencyCode: row.store.currencyCode,
    },
    roleName: row.role.name,
    isOwner: row.member.isOwner,
    // Los permisos solo se escriben desde la API de roles, que valida contra PERMISSIONS.
    permissions: row.role.permissions as Permission[],
  };
}
