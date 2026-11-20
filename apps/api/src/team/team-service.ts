import { and, asc, count, desc, eq, isNull } from "drizzle-orm";
import { recordAudit } from "../audit/record.js";
import type { Db, Tx } from "../db/client.js";
import { withDbContext } from "../db/tenant.js";
import {
  invitations as invitationRows,
  storeMembers,
  storeRoles,
  stores,
  users,
} from "../db/schema/index.js";
import { AppError } from "../http/errors.js";
import type { Permission } from "../domain/permissions.js";
import type { InvitationService } from "./invitation-service.js";

export type TeamServiceDeps = {
  db: Db;
  invitations: InvitationService;
};

export type RoleInput = { name: string; permissions: readonly Permission[] };

// Los permisos se escriben solo desde createRole/updateRole, que validan contra PERMISSIONS.
function toRole(row: typeof storeRoles.$inferSelect) {
  return {
    id: row.id,
    name: row.name,
    permissions: row.permissions as Permission[],
    isSystem: row.isSystem,
  };
}

export function createTeamService({ db, invitations }: TeamServiceDeps) {
  async function listMembers(storeId: string) {
    return withDbContext(db, { storeId }, (tx) =>
      tx
        .select({
          id: storeMembers.id,
          userId: users.id,
          email: users.email,
          fullName: users.fullName,
          roleId: storeRoles.id,
          roleName: storeRoles.name,
          isOwner: storeMembers.isOwner,
          createdAt: storeMembers.createdAt,
        })
        .from(storeMembers)
        .innerJoin(users, eq(users.id, storeMembers.userId))
        .innerJoin(storeRoles, eq(storeRoles.id, storeMembers.roleId))
        .where(eq(storeMembers.storeId, storeId))
        .orderBy(asc(users.fullName)),
    );
  }

  async function listRoles(storeId: string) {
    const rows = await withDbContext(db, { storeId }, (tx) =>
      tx
        .select()
        .from(storeRoles)
        .where(eq(storeRoles.storeId, storeId))
        .orderBy(asc(storeRoles.name)),
    );
    return rows.map(toRole);
  }

  async function createRole(input: { storeId: string; actorUserId: string } & RoleInput) {
    return withDbContext(db, { storeId: input.storeId, userId: input.actorUserId }, async (tx) => {
      await assertNameAvailable(tx, input.storeId, input.name);
      const [role] = await tx
        .insert(storeRoles)
        .values({ storeId: input.storeId, name: input.name, permissions: [...input.permissions] })
        .returning();
      if (!role) throw new Error("No se creó el rol");
      await recordAudit(tx, {
        storeId: input.storeId,
        actorUserId: input.actorUserId,
        action: "role.created",
        entity: "store_role",
        entityId: role.id,
        metadata: { name: role.name, permissions: role.permissions },
      });
      return toRole(role);
    });
  }

  async function updateRole(input: {
    storeId: string;
    actorUserId: string;
    roleId: string;
    name?: string | undefined;
    permissions?: readonly Permission[] | undefined;
  }) {
    return withDbContext(db, { storeId: input.storeId, userId: input.actorUserId }, async (tx) => {
      const role = await findRole(tx, input.storeId, input.roleId);
      if (role.isSystem) {
        throw new AppError(409, "SYSTEM_ROLE", "El rol Propietario no se puede modificar");
      }
      if (input.name !== undefined && input.name !== role.name) {
        await assertNameAvailable(tx, input.storeId, input.name);
      }
      const [updated] = await tx
        .update(storeRoles)
        .set({
          ...(input.name !== undefined ? { name: input.name } : {}),
          ...(input.permissions !== undefined ? { permissions: [...input.permissions] } : {}),
        })
        .where(eq(storeRoles.id, role.id))
        .returning();
      if (!updated) throw new Error("No se actualizó el rol");
      await recordAudit(tx, {
        storeId: input.storeId,
        actorUserId: input.actorUserId,
        action: "role.updated",
        entity: "store_role",
        entityId: role.id,
        metadata: { name: updated.name, permissions: updated.permissions },
      });
      return toRole(updated);
    });
  }

  async function deleteRole(input: { storeId: string; actorUserId: string; roleId: string }) {
    await withDbContext(db, { storeId: input.storeId, userId: input.actorUserId }, async (tx) => {
      const role = await findRole(tx, input.storeId, input.roleId);
      if (role.isSystem) {
        throw new AppError(409, "SYSTEM_ROLE", "El rol Propietario no se puede eliminar");
      }
      const [inUse] = await tx
        .select({ total: count() })
        .from(storeMembers)
        .where(eq(storeMembers.roleId, role.id));
      if (inUse && inUse.total > 0) {
        throw new AppError(
          409,
          "ROLE_IN_USE",
          "Hay miembros con este rol. Cámbialos antes de eliminarlo",
        );
      }
      await tx.delete(storeRoles).where(eq(storeRoles.id, role.id));
      await recordAudit(tx, {
        storeId: input.storeId,
        actorUserId: input.actorUserId,
        action: "role.deleted",
        entity: "store_role",
        entityId: role.id,
        metadata: { name: role.name },
      });
    });
  }

  async function inviteStaff(input: {
    storeId: string;
    actorUserId: string;
    email: string;
    roleId: string;
  }) {
    const { token, storeName, roleName } = await withDbContext(
      db,
      { storeId: input.storeId, userId: input.actorUserId },
      async (tx) => {
        const role = await findRole(tx, input.storeId, input.roleId);
        if (role.isSystem) {
          throw new AppError(400, "INVALID_ROLE", "No se puede invitar como propietario");
        }
        const [member] = await tx
          .select({ id: storeMembers.id })
          .from(storeMembers)
          .innerJoin(users, eq(users.id, storeMembers.userId))
          .where(and(eq(storeMembers.storeId, input.storeId), eq(users.email, input.email)))
          .limit(1);
        if (member)
          throw new AppError(409, "ALREADY_MEMBER", "Esa persona ya es miembro de la tienda");

        const [store] = await tx
          .select({ name: stores.name })
          .from(stores)
          .where(eq(stores.id, input.storeId))
          .limit(1);
        if (!store) throw new AppError(404, "STORE_NOT_FOUND", "Tienda no encontrada");

        const token = await invitations.createInvitation(tx, {
          storeId: input.storeId,
          email: input.email,
          roleId: role.id,
          createdByUserId: input.actorUserId,
        });
        await recordAudit(tx, {
          storeId: input.storeId,
          actorUserId: input.actorUserId,
          action: "invitation.created",
          entity: "invitation",
          entityId: input.email,
          metadata: { roleId: role.id },
        });
        return { token, storeName: store.name, roleName: role.name };
      },
    );
    await invitations.sendInvitationEmail({ email: input.email, storeName, roleName, token });
  }

  async function changeMemberRole(input: {
    storeId: string;
    actorUserId: string;
    memberId: string;
    roleId: string;
  }) {
    await withDbContext(db, { storeId: input.storeId, userId: input.actorUserId }, async (tx) => {
      const member = await findMember(tx, input.storeId, input.memberId);
      if (member.isOwner) {
        throw new AppError(409, "OWNER_PROTECTED", "El propietario no se puede modificar");
      }
      const role = await findRole(tx, input.storeId, input.roleId);
      if (role.isSystem) {
        throw new AppError(400, "INVALID_ROLE", "No se puede asignar el rol Propietario");
      }
      await tx.update(storeMembers).set({ roleId: role.id }).where(eq(storeMembers.id, member.id));
      await recordAudit(tx, {
        storeId: input.storeId,
        actorUserId: input.actorUserId,
        action: "member.role_changed",
        entity: "store_member",
        entityId: member.userId,
        metadata: { roleId: role.id },
      });
    });
  }

  async function removeMember(input: { storeId: string; actorUserId: string; memberId: string }) {
    await withDbContext(db, { storeId: input.storeId, userId: input.actorUserId }, async (tx) => {
      const member = await findMember(tx, input.storeId, input.memberId);
      if (member.isOwner) {
        throw new AppError(
          409,
          "OWNER_PROTECTED",
          "El propietario no se puede quitar de la tienda",
        );
      }
      await tx.delete(storeMembers).where(eq(storeMembers.id, member.id));
      await recordAudit(tx, {
        storeId: input.storeId,
        actorUserId: input.actorUserId,
        action: "member.removed",
        entity: "store_member",
        entityId: member.userId,
      });
    });
  }

  // Invitaciones aún no aceptadas ni revocadas (incluye las vencidas, que se pueden reenviar).
  async function listInvitations(storeId: string) {
    return withDbContext(db, { storeId }, (tx) =>
      tx
        .select({
          id: invitationRows.id,
          email: invitationRows.email,
          roleName: storeRoles.name,
          expiresAt: invitationRows.expiresAt,
          createdAt: invitationRows.createdAt,
        })
        .from(invitationRows)
        .innerJoin(storeRoles, eq(storeRoles.id, invitationRows.roleId))
        .where(
          and(
            eq(invitationRows.storeId, storeId),
            isNull(invitationRows.acceptedAt),
            isNull(invitationRows.revokedAt),
          ),
        )
        .orderBy(desc(invitationRows.createdAt)),
    );
  }

  async function revokeInvitation(input: {
    storeId: string;
    actorUserId: string;
    invitationId: string;
  }) {
    await withDbContext(db, { storeId: input.storeId, userId: input.actorUserId }, async (tx) => {
      const invitation = await findPendingInvitation(tx, input.storeId, input.invitationId);
      await tx
        .update(invitationRows)
        .set({ revokedAt: new Date() })
        .where(eq(invitationRows.id, invitation.id));
      await recordAudit(tx, {
        storeId: input.storeId,
        actorUserId: input.actorUserId,
        action: "invitation.revoked",
        entity: "invitation",
        entityId: invitation.id,
        metadata: { email: invitation.email },
      });
    });
  }

  // Reenviar revoca el enlace anterior y envía uno nuevo: el viejo deja de funcionar.
  async function resendInvitation(input: {
    storeId: string;
    actorUserId: string;
    invitationId: string;
  }) {
    const sent = await withDbContext(
      db,
      { storeId: input.storeId, userId: input.actorUserId },
      async (tx) => {
        const invitation = await findPendingInvitation(tx, input.storeId, input.invitationId);
        const [store] = await tx
          .select({ name: stores.name })
          .from(stores)
          .where(eq(stores.id, input.storeId))
          .limit(1);
        const [role] = await tx
          .select({ name: storeRoles.name })
          .from(storeRoles)
          .where(eq(storeRoles.id, invitation.roleId))
          .limit(1);
        if (!store || !role) throw new Error("La invitación apunta a una tienda o rol inexistente");

        await tx
          .update(invitationRows)
          .set({ revokedAt: new Date() })
          .where(eq(invitationRows.id, invitation.id));
        const token = await invitations.createInvitation(tx, {
          storeId: input.storeId,
          email: invitation.email,
          roleId: invitation.roleId,
          createdByUserId: input.actorUserId,
        });
        await recordAudit(tx, {
          storeId: input.storeId,
          actorUserId: input.actorUserId,
          action: "invitation.resent",
          entity: "invitation",
          entityId: invitation.id,
          metadata: { email: invitation.email },
        });
        return { token, email: invitation.email, storeName: store.name, roleName: role.name };
      },
    );
    await invitations.sendInvitationEmail(sent);
  }

  return {
    listInvitations,
    revokeInvitation,
    resendInvitation,
    listMembers,
    listRoles,
    createRole,
    updateRole,
    deleteRole,
    inviteStaff,
    changeMemberRole,
    removeMember,
  };
}

export type TeamService = ReturnType<typeof createTeamService>;

async function findRole(tx: Tx, storeId: string, roleId: string) {
  const [role] = await tx
    .select()
    .from(storeRoles)
    .where(and(eq(storeRoles.storeId, storeId), eq(storeRoles.id, roleId)))
    .limit(1);
  if (!role) throw new AppError(404, "ROLE_NOT_FOUND", "Rol no encontrado");
  return role;
}

async function findMember(tx: Tx, storeId: string, memberId: string) {
  const [member] = await tx
    .select()
    .from(storeMembers)
    .where(and(eq(storeMembers.storeId, storeId), eq(storeMembers.id, memberId)))
    .limit(1);
  if (!member) throw new AppError(404, "MEMBER_NOT_FOUND", "Miembro no encontrado");
  return member;
}

async function assertNameAvailable(tx: Tx, storeId: string, name: string) {
  const [existing] = await tx
    .select({ id: storeRoles.id })
    .from(storeRoles)
    .where(and(eq(storeRoles.storeId, storeId), eq(storeRoles.name, name)))
    .limit(1);
  if (existing) throw new AppError(409, "ROLE_NAME_TAKEN", "Ya existe un rol con ese nombre");
}

async function findPendingInvitation(tx: Tx, storeId: string, invitationId: string) {
  const [invitation] = await tx
    .select()
    .from(invitationRows)
    .where(
      and(
        eq(invitationRows.storeId, storeId),
        eq(invitationRows.id, invitationId),
        isNull(invitationRows.acceptedAt),
        isNull(invitationRows.revokedAt),
      ),
    )
    .limit(1);
  if (!invitation)
    throw new AppError(
      404,
      "INVITATION_NOT_FOUND",
      "Invitación no encontrada o ya no está pendiente",
    );
  return invitation;
}
