import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { sessions, users } from "../../src/db/schema/index.js";
import { buildTestApp } from "../support/app.js";
import { call, type Ctx } from "../support/api.js";
import { resetDb } from "../support/db.js";
import { createLoginUser } from "../support/fixtures.js";
import { PASSWORD as PASSWORD_FIXTURE } from "../support/onboarding.js";

describe("casos de borde de autenticación", () => {
  let ctx: Ctx;

  beforeEach(async () => {
    ctx = await buildTestApp();
    await resetDb(ctx.db);
    await createLoginUser(ctx.db, "borde@example.com", PASSWORD_FIXTURE);
  });

  afterEach(async () => {
    await ctx.close();
  });

  it("una sesión vencida no sirve aunque la cookie exista", async () => {
    const { token } = await ctx.app.services.auth.login("borde@example.com", PASSWORD_FIXTURE);
    await ctx.db.update(sessions).set({ expiresAt: new Date(Date.now() - 1000) });

    expect((await call(ctx, "GET", "/api/v1/auth/me", token)).statusCode).toBe(401);
  });

  it("un usuario desactivado pierde sus sesiones activas", async () => {
    const { token } = await ctx.app.services.auth.login("borde@example.com", PASSWORD_FIXTURE);
    await ctx.db.update(users).set({ isActive: false }).where(eq(users.email, "borde@example.com"));

    expect((await call(ctx, "GET", "/api/v1/auth/me", token)).statusCode).toBe(401);
  });

  it("el logout invalida la cookie para siempre", async () => {
    const { token } = await ctx.app.services.auth.login("borde@example.com", PASSWORD_FIXTURE);
    await call(ctx, "POST", "/api/v1/auth/logout", token);

    expect((await call(ctx, "GET", "/api/v1/auth/me", token)).statusCode).toBe(401);
  });

  it("una cookie inventada responde 401", async () => {
    expect((await call(ctx, "GET", "/api/v1/auth/me", "cookie-inventada")).statusCode).toBe(401);
  });

  it("el login acepta el email sin importar mayúsculas", async () => {
    const res = await call(ctx, "POST", "/api/v1/auth/login", null, {
      email: "BORDE@example.com",
      password: PASSWORD_FIXTURE,
    });
    expect(res.statusCode).toBe(200);
  });

  it("un email con espacios no es un email válido y responde 400", async () => {
    const res = await call(ctx, "POST", "/api/v1/auth/login", null, {
      email: "  borde@example.com ",
      password: PASSWORD_FIXTURE,
    });
    expect(res.statusCode).toBe(400);
  });

  it("el body de login sin contraseña responde 400", async () => {
    const res = await call(ctx, "POST", "/api/v1/auth/login", null, { email: "borde@example.com" });
    expect(res.statusCode).toBe(400);
  });

  it("una ruta inexistente responde 404 en formato problem+json", async () => {
    const res = await call(ctx, "GET", "/api/v1/no-existe", null);
    expect(res.statusCode).toBe(404);
    expect(res.headers["content-type"]).toContain("application/problem+json");
  });

  it("los errores 500 no exponen detalles internos", async () => {
    const res = await call(ctx, "GET", "/api/v1/health", null);
    expect(res.statusCode).toBe(200);
    expect(JSON.stringify(res.json())).not.toMatch(/stack|postgres|SQL/i);
  });
});
