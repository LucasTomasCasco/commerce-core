import { randomUUID } from "node:crypto";
import { and, asc, count, desc, eq, isNull } from "drizzle-orm";
import { recordAudit } from "../audit/record.js";
import type { Db } from "../db/client.js";
import { withDbContext } from "../db/tenant.js";
import {
  currencies,
  invitations as invitationRows,
  storeRoles,
  stores,
} from "../db/schema/index.js";
import { AppError } from "../http/errors.js";
import { DEFAULT_ROLES, OWNER_ROLE_NAME } from "../domain/permissions.js";
import type { InvitationService } from "../team/invitation-service.js";
import type { TeamService } from "../team/team-service.js";

export type PlatformServiceDeps = {
  db: Db;
  invitations: InvitationService;
  team: TeamService;
};

export function createPlatformService({ db, invitations, team }: PlatformServiceDeps) {
  // Crea la tienda con sus roles por defecto y una invitación para el owner, todo en una transacción.
  async function createStore(input: {
    actorUserId: string;
    name: string;
    slug: string;
    currencyCode: string;
    ownerEmail: string;
  }) {
    const [currency] = await db
      .select({ code: currencies.code })
      .from(currencies)
      .where(and(eq(currencies.code, input.currencyCode), eq(currencies.isActive, true)))
      .limit(1);
    if (!currency) {
      throw new AppError(400, "CURRENCY_NOT_AVAILABLE", "La moneda no está disponible");
    }

    const [taken] = await db
      .select({ id: stores.id })
      .from(stores)
      .where(eq(stores.slug, input.slug))
      .limit(1);
    if (taken) throw new AppError(409, "SLUG_TAKEN", "Ya existe una tienda con esa dirección");

    const storeId = randomUUID();
    const { store, token, ownerRoleName } = await withDbContext(
      db,
      { storeId, userId: input.actorUserId },
      async (tx) => {
        const [store] = await tx
          .insert(stores)
          .values({
            id: storeId,
            name: input.name,
            slug: input.slug,
            currencyCode: input.currencyCode,
            status: "active",
          })
          .returning();
        if (!store) throw new Error("No se creó la tienda");

        const roles = await tx
          .insert(storeRoles)
          .values(
            DEFAULT_ROLES.map((role) => ({
              storeId,
              name: role.name,
              permissions: [...role.permissions],
              isSystem: role.name === OWNER_ROLE_NAME,
            })),
          )
          .returning();
        const ownerRole = roles.find((r) => r.isSystem);
        if (!ownerRole) throw new Error("No se creó el rol propietario");

        const token = await invitations.createInvitation(tx, {
          storeId,
          email: input.ownerEmail,
          roleId: ownerRole.id,
          createdByUserId: input.actorUserId,
        });
        await recordAudit(tx, {
          storeId,
          actorUserId: input.actorUserId,
          action: "store.created",
          entity: "store",
          entityId: storeId,
          metadata: { slug: store.slug, ownerEmail: input.ownerEmail },
        });
        return { store, token, ownerRoleName: ownerRole.name };
      },
    );

    await invitations.sendInvitationEmail({
      email: input.ownerEmail,
      storeName: store.name,
      roleName: ownerRoleName,
      token,
    });
    return store;
  }

  async function listStores(input: { limit: number; offset: number }) {
    const [items, [total]] = await Promise.all([
      db.select().from(stores).orderBy(asc(stores.name)).limit(input.limit).offset(input.offset),
      db.select({ total: count() }).from(stores),
    ]);
    return { items, total: total?.total ?? 0, limit: input.limit, offset: input.offset };
  }

  async function getStore(storeId: string) {
    const [store] = await db.select().from(stores).where(eq(stores.id, storeId)).limit(1);
    if (!store) throw new AppError(404, "STORE_NOT_FOUND", "Tienda no encontrada");
    return store;
  }

  async function updateStore(input: {
    actorUserId: string;
    storeId: string;
    name?: string | undefined;
    status?: "active" | "suspended" | undefined;
  }) {
    await getStore(input.storeId);
    return withDbContext(db, { storeId: input.storeId, userId: input.actorUserId }, async (tx) => {
      const [updated] = await tx
        .update(stores)
        .set({
          updatedAt: new Date(),
          ...(input.name !== undefined ? { name: input.name } : {}),
          ...(input.status !== undefined ? { status: input.status } : {}),
        })
        .where(eq(stores.id, input.storeId))
        .returning();
      if (!updated) throw new Error("No se actualizó la tienda");
      if (input.name !== undefined) {
        await recordAudit(tx, {
          storeId: input.storeId,
          actorUserId: input.actorUserId,
          action: "store.renamed",
          entity: "store",
          entityId: input.storeId,
          metadata: { name: input.name },
        });
      }
      if (input.status !== undefined) {
        await recordAudit(tx, {
          storeId: input.storeId,
          actorUserId: input.actorUserId,
          action: "store.status_changed",
          entity: "store",
          entityId: input.storeId,
          metadata: { status: input.status },
        });
      }
      return updated;
    });
  }

  async function listCurrencies() {
    return db.select().from(currencies).orderBy(asc(currencies.code));
  }

  async function createCurrency(input: { code: string; name: string; minorUnit: number }) {
    const [existing] = await db
      .select({ code: currencies.code })
      .from(currencies)
      .where(eq(currencies.code, input.code))
      .limit(1);
    if (existing) throw new AppError(409, "CURRENCY_EXISTS", "La moneda ya existe");

    const [created] = await db.insert(currencies).values(input).returning();
    if (!created) throw new Error("No se creó la moneda");
    return created;
  }

  async function updateCurrency(input: {
    code: string;
    name?: string | undefined;
    isActive?: boolean | undefined;
  }) {
    const [updated] = await db
      .update(currencies)
      .set({
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
      })
      .where(eq(currencies.code, input.code))
      .returning();
    if (!updated) throw new AppError(404, "CURRENCY_NOT_FOUND", "Moneda no encontrada");
    return updated;
  }

  // Reenvía la invitación del propietario pendiente (por ejemplo, si el email se perdió).
  async function resendOwnerInvitation(input: { actorUserId: string; storeId: string }) {
    await getStore(input.storeId);
    const [pending] = await withDbContext(
      db,
      { storeId: input.storeId, userId: input.actorUserId },
      (tx) =>
        tx
          .select({ id: invitationRows.id })
          .from(invitationRows)
          .innerJoin(
            storeRoles,
            and(
              eq(storeRoles.storeId, invitationRows.storeId),
              eq(storeRoles.id, invitationRows.roleId),
            ),
          )
          .where(
            and(
              eq(invitationRows.storeId, input.storeId),
              eq(storeRoles.isSystem, true),
              isNull(invitationRows.acceptedAt),
              isNull(invitationRows.revokedAt),
            ),
          )
          .orderBy(desc(invitationRows.createdAt))
          .limit(1),
    );
    if (!pending) {
      throw new AppError(
        409,
        "NO_PENDING_OWNER_INVITATION",
        "El propietario ya aceptó la invitación",
      );
    }
    await team.resendInvitation({
      storeId: input.storeId,
      actorUserId: input.actorUserId,
      invitationId: pending.id,
    });
  }

  return {
    resendOwnerInvitation,
    createStore,
    listStores,
    getStore,
    updateStore,
    listCurrencies,
    createCurrency,
    updateCurrency,
  };
}

export type PlatformService = ReturnType<typeof createPlatformService>;
