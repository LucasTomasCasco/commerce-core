import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildTestApp } from "./support/app.js";
import type { TestContext } from "./support/onboarding.js";

describe("documentación OpenAPI", () => {
  let ctx: TestContext;

  beforeEach(async () => {
    ctx = await buildTestApp();
  });

  afterEach(async () => {
    await ctx.close();
  });

  it("publica un documento OpenAPI 3 con las rutas principales", async () => {
    const res = await ctx.app.inject({ method: "GET", url: "/openapi.json" });
    const doc = res.json<{ openapi: string; paths: Record<string, unknown> }>();

    expect(res.statusCode).toBe(200);
    expect(doc.openapi).toMatch(/^3\./);
    expect(Object.keys(doc.paths)).toEqual(
      expect.arrayContaining([
        "/api/v1/auth/login",
        "/api/v1/stores/{storeId}/orders",
        "/api/v1/stores/{storeId}/products",
        "/api/v1/public/stores/{slug}/products",
        "/api/v1/platform/stores",
      ]),
    );
  });

  it("sirve Swagger UI en /docs", async () => {
    const res = await ctx.app.inject({ method: "GET", url: "/docs/" });

    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toContain("text/html");
  });
});
