import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildTestApp } from "./support/app.js";

describe("app", () => {
  let ctx: Awaited<ReturnType<typeof buildTestApp>>;

  beforeEach(async () => {
    ctx = await buildTestApp();
  });

  afterEach(async () => {
    await ctx.close();
  });

  it("responde ok en /api/v1/health", async () => {
    const res = await ctx.app.inject({ method: "GET", url: "/api/v1/health" });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: "ok" });
  });

  it("/api/v1/ready verifica la conexión a la base", async () => {
    const res = await ctx.app.inject({ method: "GET", url: "/api/v1/ready" });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: "ready" });
  });

  it("responde problem+json en rutas inexistentes", async () => {
    const res = await ctx.app.inject({ method: "GET", url: "/no-existe" });

    expect(res.statusCode).toBe(404);
    expect(res.headers["content-type"]).toContain("application/problem+json");
    expect(res.json()).toMatchObject({ status: 404, code: "NOT_FOUND" });
  });
});
