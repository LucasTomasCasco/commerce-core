import { and, eq, gt, isNull, sql } from "drizzle-orm";
import type { Db } from "../db/client.js";
import { passwordResets, sessions, users } from "../db/schema/index.js";
import { AppError } from "../http/errors.js";
import type { Mailer } from "./mailer.js";
import { hashPassword, verifyPassword } from "./password.js";
import { generateToken, hashToken } from "./tokens.js";

export type AuthUser = {
  id: string;
  email: string;
  fullName: string;
  isPlatformAdmin: boolean;
};

export type AuthServiceDeps = {
  db: Db;
  mailer: Mailer;
  sessionTtlDays: number;
  appOrigin: string;
};

const RESET_TTL_MINUTES = 60;

export function createAuthService({ db, mailer, sessionTtlDays, appOrigin }: AuthServiceDeps) {
  // Hash de referencia: se verifica aunque el email no exista, para no revelar cuentas por tiempo de respuesta.
  const referenceHash = hashPassword(generateToken());

  async function createSession(userId: string): Promise<string> {
    const token = generateToken();
    await db.insert(sessions).values({
      userId,
      tokenHash: hashToken(token),
      expiresAt: new Date(Date.now() + sessionTtlDays * 24 * 60 * 60 * 1000),
    });
    return token;
  }

  async function login(email: string, password: string) {
    const [user] = await db
      .select()
      .from(users)
      .where(and(eq(sql`lower(${users.email})`, email.toLowerCase()), eq(users.isActive, true)))
      .limit(1);

    const valid = await verifyPassword(user?.passwordHash ?? (await referenceHash), password);
    if (!user?.passwordHash || !valid) {
      throw new AppError(401, "INVALID_CREDENTIALS", "Email o contraseña incorrectos");
    }

    const token = await createSession(user.id);
    return { user: toAuthUser(user), token };
  }

  async function getUserByToken(token: string): Promise<AuthUser | null> {
    const [row] = await db
      .select({ user: users })
      .from(sessions)
      .innerJoin(users, eq(users.id, sessions.userId))
      .where(
        and(
          eq(sessions.tokenHash, hashToken(token)),
          isNull(sessions.revokedAt),
          gt(sessions.expiresAt, new Date()),
          eq(users.isActive, true),
        ),
      )
      .limit(1);
    return row ? toAuthUser(row.user) : null;
  }

  async function logout(token: string): Promise<void> {
    await db
      .update(sessions)
      .set({ revokedAt: new Date() })
      .where(eq(sessions.tokenHash, hashToken(token)));
  }

  // Responde igual exista o no el email: nunca revela si la cuenta existe.
  async function requestPasswordReset(email: string): Promise<void> {
    const [user] = await db
      .select()
      .from(users)
      .where(and(eq(sql`lower(${users.email})`, email.toLowerCase()), eq(users.isActive, true)))
      .limit(1);
    if (!user) return;

    const token = generateToken();
    await db.insert(passwordResets).values({
      userId: user.id,
      tokenHash: hashToken(token),
      expiresAt: new Date(Date.now() + RESET_TTL_MINUTES * 60 * 1000),
    });

    await mailer.send({
      to: user.email,
      subject: "Restablecer tu contraseña",
      text: `Para elegir una nueva contraseña ingresa a ${appOrigin}/restablecer?token=${token}\n\nEl enlace vence en ${String(RESET_TTL_MINUTES)} minutos.`,
    });
  }

  async function resetPassword(token: string, newPassword: string): Promise<void> {
    const passwordHash = await hashPassword(newPassword);

    await db.transaction(async (tx) => {
      const [reset] = await tx
        .update(passwordResets)
        .set({ usedAt: new Date() })
        .where(
          and(
            eq(passwordResets.tokenHash, hashToken(token)),
            isNull(passwordResets.usedAt),
            gt(passwordResets.expiresAt, new Date()),
          ),
        )
        .returning({ userId: passwordResets.userId });
      if (!reset) {
        throw new AppError(400, "INVALID_TOKEN", "El enlace no es válido o ya venció");
      }

      await tx.update(users).set({ passwordHash }).where(eq(users.id, reset.userId));
      await tx
        .update(sessions)
        .set({ revokedAt: new Date() })
        .where(and(eq(sessions.userId, reset.userId), isNull(sessions.revokedAt)));
    });
  }

  return { login, logout, getUserByToken, requestPasswordReset, resetPassword };
}

export type AuthService = ReturnType<typeof createAuthService>;

function toAuthUser(user: typeof users.$inferSelect): AuthUser {
  return {
    id: user.id,
    email: user.email,
    fullName: user.fullName,
    isPlatformAdmin: user.platformRole === "platform_admin",
  };
}
