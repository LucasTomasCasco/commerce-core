import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { users } from "../../src/db/schema/index.js";
import { buildTestApp } from "../support/app.js";
import { resetDb } from "../support/db.js";
import { createLoginUser } from "../support/fixtures.js";

const PASSWORD = "clave-segura-123";
const NEW_PASSWORD = "clave-nueva-456";

describe("autenticación", () => {
  let ctx: Awaited<ReturnType<typeof buildTestApp>>;

  beforeEach(async () => {
    ctx = await buildTestApp();
    await resetDb(ctx.db);
    await createLoginUser(ctx.db, "ana@example.com", PASSWORD);
  });

  afterEach(async () => {
    await ctx.close();
  });

  function login(email: string, password: string) {
    return ctx.app.inject({
      method: "POST",
      url: "/api/v1/auth/login",
      payload: { email, password },
    });
  }

  function sessionCookie(res: { cookies: { name: string; value: string }[] }) {
    const cookie = res.cookies.find((c) => c.name === "cc_session");
    if (!cookie) throw new Error("La respuesta no trae cookie de sesión");
    return cookie.value;
  }

  it("inicia sesión y entrega la cookie de sesión httpOnly", async () => {
    const res = await login("ana@example.com", PASSWORD);

    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      user: { email: "ana@example.com", isPlatformAdmin: false },
    });
    expect(res.headers["set-cookie"]).toEqual(expect.stringContaining("HttpOnly"));
    expect(res.headers["set-cookie"]).toEqual(expect.stringContaining("SameSite=Lax"));
  });

  it("responde igual con contraseña incorrecta o email inexistente", async () => {
    const wrongPassword = await login("ana@example.com", "otra-clave-123");
    const unknownEmail = await login("nadie@example.com", PASSWORD);

    expect(wrongPassword.statusCode).toBe(401);
    expect(unknownEmail.statusCode).toBe(401);
    expect(wrongPassword.json()).toMatchObject({ code: "INVALID_CREDENTIALS" });
    expect(unknownEmail.json()).toMatchObject({ code: "INVALID_CREDENTIALS" });
  });

  it("no inicia sesión a usuarios desactivados", async () => {
    await ctx.db.update(users).set({ isActive: false }).where(eq(users.email, "ana@example.com"));

    const res = await login("ana@example.com", PASSWORD);

    expect(res.statusCode).toBe(401);
  });

  it("/me requiere sesión", async () => {
    const res = await ctx.app.inject({ method: "GET", url: "/api/v1/auth/me" });

    expect(res.statusCode).toBe(401);
    expect(res.json()).toMatchObject({ code: "UNAUTHENTICATED" });
  });

  it("/me devuelve el usuario de la sesión", async () => {
    const session = await login("ana@example.com", PASSWORD);

    const res = await ctx.app.inject({
      method: "GET",
      url: "/api/v1/auth/me",
      cookies: { cc_session: sessionCookie(session) },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ user: { email: "ana@example.com" } });
  });

  it("logout revoca la sesión", async () => {
    const session = await login("ana@example.com", PASSWORD);
    const cookies = { cc_session: sessionCookie(session) };

    const logout = await ctx.app.inject({ method: "POST", url: "/api/v1/auth/logout", cookies });
    const me = await ctx.app.inject({ method: "GET", url: "/api/v1/auth/me", cookies });

    expect(logout.statusCode).toBe(204);
    expect(me.statusCode).toBe(401);
  });

  it("forgot-password envía el enlace solo a emails existentes y responde igual", async () => {
    const existing = await ctx.app.inject({
      method: "POST",
      url: "/api/v1/auth/forgot-password",
      payload: { email: "ana@example.com" },
    });
    const unknown = await ctx.app.inject({
      method: "POST",
      url: "/api/v1/auth/forgot-password",
      payload: { email: "nadie@example.com" },
    });

    expect(existing.statusCode).toBe(202);
    expect(unknown.statusCode).toBe(202);
    expect(ctx.sent).toHaveLength(1);
    expect(ctx.sent[0]?.to).toBe("ana@example.com");
  });

  it("reset-password cambia la contraseña, revoca sesiones y el enlace es de un solo uso", async () => {
    const session = await login("ana@example.com", PASSWORD);
    await ctx.app.inject({
      method: "POST",
      url: "/api/v1/auth/forgot-password",
      payload: { email: "ana@example.com" },
    });
    const token = /token=([\w-]+)/.exec(ctx.sent[0]?.text ?? "")?.[1];
    if (!token) throw new Error("El correo no trae token");

    const reset = await ctx.app.inject({
      method: "POST",
      url: "/api/v1/auth/reset-password",
      payload: { token, password: NEW_PASSWORD },
    });
    const oldSession = await ctx.app.inject({
      method: "GET",
      url: "/api/v1/auth/me",
      cookies: { cc_session: sessionCookie(session) },
    });
    const oldPassword = await login("ana@example.com", PASSWORD);
    const newPassword = await login("ana@example.com", NEW_PASSWORD);
    const reused = await ctx.app.inject({
      method: "POST",
      url: "/api/v1/auth/reset-password",
      payload: { token, password: "otra-clave-789" },
    });

    expect(reset.statusCode).toBe(204);
    expect(oldSession.statusCode).toBe(401);
    expect(oldPassword.statusCode).toBe(401);
    expect(newPassword.statusCode).toBe(200);
    expect(reused.statusCode).toBe(400);
    expect(reused.json()).toMatchObject({ code: "INVALID_TOKEN" });
  });

  it("reset-password rechaza tokens inventados", async () => {
    const res = await ctx.app.inject({
      method: "POST",
      url: "/api/v1/auth/reset-password",
      payload: { token: "token-inventado", password: NEW_PASSWORD },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ code: "INVALID_TOKEN" });
  });

  it("rechaza contraseñas cortas con error de validación", async () => {
    const res = await ctx.app.inject({
      method: "POST",
      url: "/api/v1/auth/reset-password",
      payload: { token: "x", password: "corta" },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ code: "VALIDATION_ERROR" });
  });
});

describe("rate limit de autenticación", () => {
  it("bloquea después del máximo de intentos de login", async () => {
    const limited = await buildTestApp({ rateLimitMax: 2 });
    try {
      await resetDb(limited.db);
      await createLoginUser(limited.db, "ana@example.com", PASSWORD);
      for (let i = 0; i < 2; i++) {
        await limited.app.inject({
          method: "POST",
          url: "/api/v1/auth/login",
          payload: { email: "ana@example.com", password: PASSWORD },
        });
      }

      const blocked = await limited.app.inject({
        method: "POST",
        url: "/api/v1/auth/login",
        payload: { email: "ana@example.com", password: PASSWORD },
      });

      expect(blocked.statusCode).toBe(429);
    } finally {
      await limited.close();
    }
  });
});
