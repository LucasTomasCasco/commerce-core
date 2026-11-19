import { and, eq, gt, isNull, sql } from "drizzle-orm";
import { createSession, type AuthUser } from "../auth/auth-service.js";
import type { Mailer } from "../auth/mailer.js";
import { hashPassword } from "../auth/password.js";
import { generateToken, hashToken } from "../auth/tokens.js";
import { recordAudit } from "../audit/record.js";
import type { Db, Tx } from "../db/client.js";
import { withDbContext } from "../db/tenant.js";
import { invitations, storeMembers, storeRoles, stores, users } from "../db/schema/index.js";
import { AppError } from "../http/errors.js";

const INVITATION_TTL_DAYS = 7;

export type InvitationServiceDeps = {
  db: Db;
  mailer: Mailer;
  sessionTtlDays: number;
  appOrigin: string;
};

export function createInvitationService({
  db,
  mailer,
  sessionTtlDays,
  appOrigin,
}: InvitationServiceDeps) {
  // Registra la invitación dentro de la transacción de la tienda y devuelve el token en claro.
  // El token solo viaja por email; en base queda su hash.
  async function createInvitation(
    tx: Tx,
    input: { storeId: string; email: string; roleId: string; createdByUserId: string },
  ): Promise<string> {
    const token = generateToken();
    await tx.insert(invitations).values({
      storeId: input.storeId,
      email: input.email,
      roleId: input.roleId,
      tokenHash: hashToken(token),
      expiresAt: new Date(Date.now() + INVITATION_TTL_DAYS * 24 * 60 * 60 * 1000),
      createdByUserId: input.createdByUserId,
    });
    return token;
  }

  async function sendInvitationEmail(input: {
    email: string;
    storeName: string;
    roleName: string;
    token: string;
  }): Promise<void> {
    await mailer.send({
      to: input.email,
      subject: `Te invitaron a ${input.storeName}`,
      text: `Te invitaron a ${input.storeName} como ${input.roleName}.\n\nPara aceptar ingresa a ${appOrigin}/invitacion?token=${input.token}\n\nEl enlace vence en ${String(INVITATION_TTL_DAYS)} días.`,
    });
  }

  async function findPending(token: string) {
    const [invitation] = await db
      .select()
      .from(invitations)
      .where(
        and(
          eq(invitations.tokenHash, hashToken(token)),
          isNull(invitations.acceptedAt),
          gt(invitations.expiresAt, new Date()),
        ),
      )
      .limit(1);
    if (!invitation) {
      throw new AppError(400, "INVALID_TOKEN", "La invitación no es válida o ya venció");
    }
    return invitation;
  }

  // Datos para la pantalla de aceptación: qué tienda, qué rol y si el email ya tiene cuenta.
  async function preview(token: string) {
    const invitation = await findPending(token);
    const [names, existing] = await Promise.all([
      withDbContext(db, { storeId: invitation.storeId }, async (tx) => {
        const [row] = await tx
          .select({ storeName: stores.name, roleName: storeRoles.name })
          .from(storeRoles)
          .innerJoin(stores, eq(stores.id, storeRoles.storeId))
          .where(eq(storeRoles.id, invitation.roleId))
          .limit(1);
        if (!row) throw new Error("La invitación apunta a un rol inexistente");
        return row;
      }),
      findUserByEmail(invitation.email),
    ]);
    return {
      email: invitation.email,
      storeName: names.storeName,
      roleName: names.roleName,
      accountExists: existing !== undefined,
    };
  }

  // Acepta la invitación. Si el email ya tiene cuenta, debe aceptar la sesión de esa cuenta.
  // Si no la tiene, crea la cuenta con nombre y contraseña y devuelve una sesión nueva.
  async function accept(
    token: string,
    input: {
      sessionUser: AuthUser | null;
      fullName?: string | undefined;
      password?: string | undefined;
    },
  ): Promise<{ storeId: string; sessionToken: string | null }> {
    const invitation = await findPending(token);
    const existing = await findUserByEmail(invitation.email);

    if (existing && input.sessionUser?.id !== existing.id) {
      throw new AppError(
        403,
        "INVITATION_EMAIL_MISMATCH",
        `Inicia sesión con ${invitation.email} para aceptar la invitación`,
      );
    }
    let userId = existing?.id;
    if (!userId) {
      if (!input.fullName || !input.password) {
        throw new AppError(400, "PROFILE_REQUIRED", "Indica tu nombre y una contraseña");
      }
      const [created] = await db
        .insert(users)
        .values({
          email: invitation.email,
          fullName: input.fullName,
          passwordHash: await hashPassword(input.password),
        })
        .returning({ id: users.id });
      if (!created) throw new Error("No se creó la cuenta de la invitación");
      userId = created.id;
    }

    await withDbContext(db, { storeId: invitation.storeId, userId }, async (tx) => {
      const [role] = await tx
        .select()
        .from(storeRoles)
        .where(eq(storeRoles.id, invitation.roleId))
        .limit(1);
      if (!role) throw new AppError(400, "INVALID_TOKEN", "La invitación no es válida o ya venció");

      const [member] = await tx
        .select({ id: storeMembers.id })
        .from(storeMembers)
        .where(eq(storeMembers.userId, userId))
        .limit(1);
      if (member) throw new AppError(409, "ALREADY_MEMBER", "Ya eres miembro de esta tienda");

      // En v1 el único rol de sistema es Propietario.
      await tx.insert(storeMembers).values({
        storeId: invitation.storeId,
        userId,
        roleId: role.id,
        isOwner: role.isSystem,
      });
      await tx
        .update(invitations)
        .set({ acceptedAt: new Date() })
        .where(eq(invitations.id, invitation.id));
      await recordAudit(tx, {
        storeId: invitation.storeId,
        actorUserId: userId,
        action: "member.joined",
        entity: "store_member",
        entityId: userId,
        metadata: { roleId: role.id },
      });
    });

    const sessionToken = existing
      ? null
      : await createSession(db, { userId, ttlDays: sessionTtlDays });
    return { storeId: invitation.storeId, sessionToken };
  }

  async function findUserByEmail(email: string) {
    const [user] = await db
      .select()
      .from(users)
      .where(and(eq(sql`lower(${users.email})`, email.toLowerCase()), eq(users.isActive, true)))
      .limit(1);
    return user;
  }

  return {
    createInvitation,
    sendInvitationEmail,
    preview,
    accept,
  };
}

export type InvitationService = ReturnType<typeof createInvitationService>;
