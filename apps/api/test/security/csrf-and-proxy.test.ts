import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildTestApp } from "../support/app.js";
import { call, type Ctx } from "../support/api.js";
import { resetDb } from "../support/db.js";
import { createLoginUser } from "../support/fixtures.js";
import { PASSWORD } from "../support/onboarding.js";

describe("protección CSRF por Origin", () => {
  let ctx: Ctx;

  beforeEach(async () => {
    ctx = await buildTestApp({ appOrigin: "https://tienda.example" });
    await resetDb(ctx.db);
    await createLoginUser(ctx.db, "csrf@example.com", PASSWORD);
  });

  afterEach(async () => {
    await ctx.close();
  });

  const post = (origin: string | undefined) =>
    ctx.app.inject({
      method: "POST",
      url: "/api/v1/auth/login",
      headers: origin === undefined ? {} : { origin },
      payload: { email: "csrf@example.com", password: PASSWORD },
    });

  it("rechaza un POST con Origin de otro sitio", async () => {
    const res = await post("https://evil.example");
    expect(res.statusCode).toBe(403);
    expect(res.json()).toMatchObject({ code: "CSRF_ORIGIN_MISMATCH" });
  });

  it("acepta un POST con el Origin propio de la aplicación", async () => {
    expect((await post("https://tienda.example")).statusCode).toBe(200);
  });

  it("acepta requests sin Origin (servidor a servidor, curl)", async () => {
    expect((await post(undefined)).statusCode).toBe(200);
  });

  it("rechaza Origin 'null' (iframes y contextos sandbox)", async () => {
    expect((await post("null")).statusCode).toBe(403);
  });

  it("no bloquea métodos seguros aunque traigan otro Origin", async () => {
    const res = await ctx.app.inject({
      method: "GET",
      url: "/api/v1/health",
      headers: { origin: "https://evil.example" },
    });
    expect(res.statusCode).toBe(200);
  });

  it("también protege las mutaciones autenticadas", async () => {
    const { token } = await ctx.app.services.auth.login("csrf@example.com", PASSWORD);
    const res = await ctx.app.inject({
      method: "POST",
      url: "/api/v1/auth/logout-all",
      headers: { origin: "https://evil.example" },
      cookies: { cc_session: token },
    });
    expect(res.statusCode).toBe(403);
    const still = await call(ctx, "GET", "/api/v1/auth/me", token);
    expect(still.statusCode).toBe(200);
  });
});

describe("trustProxy y rate limit por cliente real", () => {
  let ctx: Ctx;

  beforeEach(async () => {
    ctx = await buildTestApp({ trustProxy: 1, rateLimitMax: 2 });
    await resetDb(ctx.db);
  });

  afterEach(async () => {
    await ctx.close();
  });

  const health = (ip: string) =>
    ctx.app.inject({
      method: "POST",
      url: "/api/v1/auth/login",
      remoteAddress: "10.0.0.1",
      headers: { "x-forwarded-for": ip },
      payload: { email: "nadie@example.com", password: "x".repeat(12) },
    });

  it("con un proxy de confianza, cada cliente real tiene su propio límite", async () => {
    await health("203.0.113.5");
    await health("203.0.113.5");
    const blockedA = await health("203.0.113.5");
    const otherClient = await health("198.51.100.7");

    expect(blockedA.statusCode).toBe(429);
    expect(otherClient.statusCode).not.toBe(429);
  });
});

describe("sin proxy de confianza, X-Forwarded-For se ignora", () => {
  let ctx: Ctx;

  beforeEach(async () => {
    ctx = await buildTestApp({ trustProxy: 0, rateLimitMax: 2 });
    await resetDb(ctx.db);
  });

  afterEach(async () => {
    await ctx.close();
  });

  it("un atacante no puede saltarse el límite falsificando X-Forwarded-For", async () => {
    const attempt = (ip: string) =>
      ctx.app.inject({
        method: "POST",
        url: "/api/v1/auth/login",
        remoteAddress: "10.0.0.9",
        headers: { "x-forwarded-for": ip },
        payload: { email: "nadie@example.com", password: "x".repeat(12) },
      });
    await attempt("1.1.1.1");
    await attempt("2.2.2.2");
    const third = await attempt("3.3.3.3");

    expect(third.statusCode).toBe(429);
  });
});
