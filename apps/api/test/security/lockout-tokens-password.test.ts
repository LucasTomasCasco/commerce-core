import { eq, sql } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { assertRowLevelSecurityEnforced } from "../../src/db/guard.js";
import {
  authFailures,
  invitations,
  passwordResets,
  sessions,
  users,
} from "../../src/db/schema/index.js";
import { buildTestApp } from "../support/app.js";
import { call, type Ctx } from "../support/api.js";
import { resetDb } from "../support/db.js";
import { createLoginUser, seedCurrencies } from "../support/fixtures.js";
import {
  createPlatformAdminSession,
  onboardStore,
  PASSWORD,
  tokenFrom,
} from "../support/onboarding.js";

describe("bloqueo de cuenta por intentos fallidos", () => {
  let ctx: Ctx;

  beforeEach(async () => {
    ctx = await buildTestApp({ loginMaxFailures: 3, loginLockMinutes: 15 });
    await resetDb(ctx.db);
    await createLoginUser(ctx.db, "victima@example.com", PASSWORD);
  });

  afterEach(async () => {
    await ctx.close();
  });

  const login = (email: string, password: string) =>
    call(ctx, "POST", "/api/v1/auth/login", null, { email, password });

  it("tras el máximo de fallos, ni la contraseña correcta entra hasta que venza el bloqueo", async () => {
    for (let i = 0; i < 3; i++) await login("victima@example.com", "incorrecta-123");
    const locked = await login("victima@example.com", PASSWORD);

    expect(locked.statusCode).toBe(429);
    expect(locked.json()).toMatchObject({ code: "ACCOUNT_LOCKED" });
  });

  it("el bloqueo vence y el login vuelve a funcionar", async () => {
    for (let i = 0; i < 3; i++) await login("victima@example.com", "incorrecta-123");
    await ctx.db
      .update(authFailures)
      .set({ lockedUntil: new Date(Date.now() - 1000) })
      .where(eq(authFailures.emailKey, "victima@example.com"));

    expect((await login("victima@example.com", PASSWORD)).statusCode).toBe(200);
  });

  it("un login exitoso reinicia el contador de fallos", async () => {
    await login("victima@example.com", "incorrecta-123");
    await login("victima@example.com", "incorrecta-123");
    await login("victima@example.com", PASSWORD);
    await login("victima@example.com", "incorrecta-123");
    const res = await login("victima@example.com", PASSWORD);

    expect(res.statusCode).toBe(200);
  });

  it("el bloqueo aplica sin importar mayúsculas en el email", async () => {
    for (let i = 0; i < 3; i++) await login("VICTIMA@example.com", "incorrecta-123");

    expect((await login("victima@EXAMPLE.com", PASSWORD)).statusCode).toBe(429);
  });

  it("un email inexistente también se bloquea, sin revelar que la cuenta no existe", async () => {
    for (let i = 0; i < 3; i++) await login("fantasma@example.com", "incorrecta-123");
    const res = await login("fantasma@example.com", "incorrecta-123");

    expect(res.statusCode).toBe(429);
  });

  it("el estado de bloqueo vive en base: otra instancia lo respeta", async () => {
    for (let i = 0; i < 3; i++) await login("victima@example.com", "incorrecta-123");
    const rows = await ctx.db
      .select()
      .from(authFailures)
      .where(eq(authFailures.emailKey, "victima@example.com"));

    expect(rows[0]?.lockedUntil).toBeInstanceOf(Date);
  });
});

describe("tokens: solo hash en base y nunca en la URL", () => {
  let ctx: Ctx;

  beforeEach(async () => {
    ctx = await buildTestApp();
    await resetDb(ctx.db);
    await seedCurrencies(ctx.db);
  });

  afterEach(async () => {
    await ctx.close();
  });

  it("la invitación se guarda como hash SHA-256 y no contiene el token en claro", async () => {
    const admin = await createPlatformAdminSession(ctx);
    await onboardStore(ctx, {
      adminToken: admin,
      slug: "tienda-hash",
      ownerEmail: "hash@example.com",
    });
    const token = tokenFrom(ctx.sent.find((m) => m.to === "hash@example.com")?.text);
    const [row] = await ctx.db.select().from(invitations).limit(1);

    expect(row?.tokenHash).toMatch(/^[0-9a-f]{64}$/);
    expect(row?.tokenHash).not.toBe(token);
  });

  it("el reseteo de contraseña también se guarda como hash", async () => {
    await createLoginUser(ctx.db, "reset@example.com", PASSWORD);
    await call(ctx, "POST", "/api/v1/auth/forgot-password", null, { email: "reset@example.com" });
    const token = tokenFrom(ctx.sent.find((m) => m.to === "reset@example.com")?.text);
    const [row] = await ctx.db.select().from(passwordResets).limit(1);

    expect(row?.tokenHash).toMatch(/^[0-9a-f]{64}$/);
    expect(row?.tokenHash).not.toBe(token);
  });

  it("el token de invitación ya no se acepta por la URL (ruta antigua eliminada)", async () => {
    const res = await call(ctx, "POST", "/api/v1/invitations/token-cualquiera/accept", null, {});
    expect(res.statusCode).toBe(404);
  });

  it("la vista previa de invitación no acepta GET con token en la URL", async () => {
    const res = await call(ctx, "GET", "/api/v1/invitations/token-cualquiera", null);
    expect(res.statusCode).toBe(404);
  });

  it("un token de invitación inventado en el body responde 400 con código de token inválido", async () => {
    const res = await call(ctx, "POST", "/api/v1/invitations/preview", null, {
      token: "inventado",
    });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ code: "INVALID_TOKEN" });
  });
});

describe("política de contraseñas", () => {
  let ctx: Ctx;

  beforeEach(async () => {
    ctx = await buildTestApp();
    await resetDb(ctx.db);
    await createLoginUser(ctx.db, "clave@example.com", PASSWORD);
    await call(ctx, "POST", "/api/v1/auth/forgot-password", null, { email: "clave@example.com" });
  });

  afterEach(async () => {
    await ctx.close();
  });

  const reset = (password: string) => {
    const token = tokenFrom(ctx.sent.findLast((m) => m.to === "clave@example.com")?.text);
    return call(ctx, "POST", "/api/v1/auth/reset-password", null, { token, password });
  };

  it("rechaza contraseñas sin números", async () => {
    const res = await reset("solo-letras-sin-numero");
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ code: "VALIDATION_ERROR" });
  });

  it("rechaza contraseñas sin letras", async () => {
    expect((await reset("1234567890123")).statusCode).toBe(400);
  });

  it("rechaza contraseñas de menos de 10 caracteres", async () => {
    expect((await reset("abc123")).statusCode).toBe(400);
  });

  it("acepta una contraseña que cumple la política", async () => {
    expect((await reset("nueva-clave-456")).statusCode).toBe(204);
  });
});

describe("logout en todos los dispositivos", () => {
  let ctx: Ctx;

  beforeEach(async () => {
    ctx = await buildTestApp();
    await resetDb(ctx.db);
    await createLoginUser(ctx.db, "multi@example.com", PASSWORD);
  });

  afterEach(async () => {
    await ctx.close();
  });

  it("revoca todas las sesiones del usuario y deja las de otros usuarios intactas", async () => {
    const first = (await ctx.app.services.auth.login("multi@example.com", PASSWORD)).token;
    const second = (await ctx.app.services.auth.login("multi@example.com", PASSWORD)).token;
    await createLoginUser(ctx.db, "otro@example.com", PASSWORD);
    const other = (await ctx.app.services.auth.login("otro@example.com", PASSWORD)).token;

    const res = await call(ctx, "POST", "/api/v1/auth/logout-all", first);

    expect(res.statusCode).toBe(204);
    expect((await call(ctx, "GET", "/api/v1/auth/me", first)).statusCode).toBe(401);
    expect((await call(ctx, "GET", "/api/v1/auth/me", second)).statusCode).toBe(401);
    expect((await call(ctx, "GET", "/api/v1/auth/me", other)).statusCode).toBe(200);
  });

  it("requiere sesión", async () => {
    expect((await call(ctx, "POST", "/api/v1/auth/logout-all", null)).statusCode).toBe(401);
  });

  it("las sesiones revocadas quedan marcadas en base", async () => {
    const token = (await ctx.app.services.auth.login("multi@example.com", PASSWORD)).token;
    await call(ctx, "POST", "/api/v1/auth/logout-all", token);
    const [user] = await ctx.db.select().from(users).where(eq(users.email, "multi@example.com"));
    const rows = await ctx.db
      .select()
      .from(sessions)
      .where(eq(sessions.userId, user?.id ?? ""));

    expect(rows.every((r) => r.revokedAt !== null)).toBe(true);
  });
});

describe("guard de superusuario (RLS)", () => {
  let ctx: Ctx;

  beforeEach(async () => {
    ctx = await buildTestApp();
  });

  afterEach(async () => {
    await ctx.close();
  });

  it("rechaza una conexión con rol superusuario, que saltaría RLS", async () => {
    await expect(assertRowLevelSecurityEnforced(ctx.db)).rejects.toThrow(/superusuario/);
  });

  it("el rol de aplicación commerce_app no tiene BYPASSRLS", async () => {
    const rows = await ctx.db.execute<{ rolbypassrls: boolean; rolsuper: boolean }>(
      sql`SELECT rolbypassrls, rolsuper FROM pg_roles WHERE rolname = 'commerce_app'`,
    );
    expect(rows[0]).toMatchObject({ rolbypassrls: false, rolsuper: false });
  });
});
