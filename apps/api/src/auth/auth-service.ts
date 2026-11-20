import { and, eq, gt, isNull, sql } from "drizzle-orm";
import type { Db } from "../db/client.js";
import { authFailures, passwordResets, sessions, users } from "../db/schema/index.js";
import { AppError } from "../http/errors.js";
import { enqueueEmail } from "../outbox/outbox.js";
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
  sessionTtlDays: number;
  appOrigin: string;
  loginMaxFailures: number;
  loginLockMinutes: number;
};

const RESET_TTL_MINUTES = 60;
const FAILURE_WINDOW_MINUTES = 15;

export async function createSession(
  db: Db,
  input: { userId: string; ttlDays: number },
): Promise<string> {
  const token = generateToken();
  await db.insert(sessions).values({
    userId: input.userId,
    tokenHash: hashToken(token),
    expiresAt: new Date(Date.now() + input.ttlDays * 24 * 60 * 60 * 1000),
  });
  return token;
}

// Clave del bloqueo: el email normalizado, exista o no la cuenta.
export function failureKey(email: string): string {
  return email.trim().toLowerCase();
}

export function createAuthService({
  db,
  sessionTtlDays,
  appOrigin,
  loginMaxFailures,
  loginLockMinutes,
}: AuthServiceDeps) {
  // Hash de referencia: se verifica aunque el email no exista, para no revelar cuentas por tiempo de respuesta.
  const referenceHash = hashPassword(generateToken());

  async function assertNotLocked(key: string, now: Date) {
    const [row] = await db
      .select()
      .from(authFailures)
      .where(eq(authFailures.emailKey, key))
      .limit(1);
    if (row?.lockedUntil && row.lockedUntil > now) {
      throw new AppError(
        429,
        "ACCOUNT_LOCKED",
        "Demasiados intentos fallidos. Probá de nuevo en unos minutos",
      );
    }
  }

  // Cuenta fallos dentro de una ventana; al llegar al máximo bloquea la clave por un tiempo.
  async function registerFailure(key: string, now: Date) {
    const [row] = await db
      .select()
      .from(authFailures)
      .where(eq(authFailures.emailKey, key))
      .limit(1);
    const windowExpired =
      !row || now.getTime() - row.windowStartedAt.getTime() > FAILURE_WINDOW_MINUTES * 60 * 1000;
    const failures = windowExpired ? 1 : row.failures + 1;
    const lockedUntil =
      failures >= loginMaxFailures ? new Date(now.getTime() + loginLockMinutes * 60 * 1000) : null;

    await db
      .insert(authFailures)
      .values({
        emailKey: key,
        failures,
        windowStartedAt: windowExpired ? now : row.windowStartedAt,
        lockedUntil,
      })
      .onConflictDoUpdate({
        target: authFailures.emailKey,
        set: { failures, windowStartedAt: windowExpired ? now : row.windowStartedAt, lockedUntil },
      });
  }

  async function clearFailures(key: string) {
    await db.delete(authFailures).where(eq(authFailures.emailKey, key));
  }

  async function login(email: string, password: string) {
    const now = new Date();
    const key = failureKey(email);
    await assertNotLocked(key, now);

    const [user] = await db
      .select()
      .from(users)
      .where(and(eq(sql`lower(${users.email})`, key), eq(users.isActive, true)))
      .limit(1);

    const valid = await verifyPassword(user?.passwordHash ?? (await referenceHash), password);
    if (!user?.passwordHash || !valid) {
      await registerFailure(key, now);
      throw new AppError(401, "INVALID_CREDENTIALS", "Email o contraseña incorrectos");
    }

    await clearFailures(key);
    const token = await createSession(db, { userId: user.id, ttlDays: sessionTtlDays });
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

  // Cierra todas las sesiones del usuario, incluida la actual: "salir de todos los dispositivos".
  async function logoutAll(userId: string): Promise<void> {
    await db
      .update(sessions)
      .set({ revokedAt: new Date() })
      .where(and(eq(sessions.userId, userId), isNull(sessions.revokedAt)));
  }

  // Responde igual exista o no el email: nunca revela si la cuenta existe.
  async function requestPasswordReset(email: string): Promise<void> {
    const [user] = await db
      .select()
      .from(users)
      .where(and(eq(sql`lower(${users.email})`, failureKey(email)), eq(users.isActive, true)))
      .limit(1);
    if (!user) return;

    const token = generateToken();
    await db.insert(passwordResets).values({
      userId: user.id,
      tokenHash: hashToken(token),
      expiresAt: new Date(Date.now() + RESET_TTL_MINUTES * 60 * 1000),
    });

    await enqueueEmail(db, {
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

  return {
    login,
    logout,
    logoutAll,
    getUserByToken,
    requestPasswordReset,
    resetPassword,
  };
}

export type AuthService = ReturnType<typeof createAuthService>;

export function toAuthUser(user: typeof users.$inferSelect): AuthUser {
  return {
    id: user.id,
    email: user.email,
    fullName: user.fullName,
    isPlatformAdmin: user.platformRole === "platform_admin",
  };
}
