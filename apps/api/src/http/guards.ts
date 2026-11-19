import type { preHandlerAsyncHookHandler, preHandlerHookHandler } from "fastify";
import type { Db } from "../db/client.js";
import type { Permission } from "../domain/permissions.js";
import { resolveStoreAccess } from "../tenancy/store-access.js";
import { AppError } from "./errors.js";

// Requiere membresía en la tienda de :storeId y, si se indica, el permiso.
// Debe ir después de requireSession. Deja el acceso resuelto en request.store.
export function requireStoreAccess(db: Db, permission?: Permission): preHandlerAsyncHookHandler {
  return async (request) => {
    if (!request.auth) {
      throw new AppError(401, "UNAUTHENTICATED", "Necesitas iniciar sesión");
    }
    // La ruta valida :storeId como uuid antes de llegar al guard.
    const { storeId } = request.params as { storeId: string };

    const access = await resolveStoreAccess(db, { storeId, userId: request.auth.user.id });
    if (!access) {
      throw new AppError(404, "STORE_NOT_FOUND", "Tienda no encontrada");
    }
    if (access.store.status !== "active") {
      throw new AppError(403, "STORE_INACTIVE", "La tienda no está activa");
    }
    if (permission && !access.permissions.includes(permission)) {
      throw new AppError(403, "FORBIDDEN", "No tienes permiso para esta acción");
    }

    request.store = access;
  };
}

export function requirePlatformAdmin(): preHandlerHookHandler {
  return (request, _reply, done) => {
    if (!request.auth?.user.isPlatformAdmin) {
      done(new AppError(403, "FORBIDDEN", "Solo el administrador general puede hacer esto"));
      return;
    }
    done();
  };
}
