import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildTestApp } from "../support/app.js";
import { call, type Ctx } from "../support/api.js";
import { resetDb } from "../support/db.js";
import { createLoginUser } from "../support/fixtures.js";
import { PASSWORD } from "../support/onboarding.js";

describe("tutorial de primer ingreso", () => {
  let ctx: Ctx;
  let token: string;

  beforeEach(async () => {
    ctx = await buildTestApp();
    await resetDb(ctx.db);
    await createLoginUser(ctx.db, "nuevo@onboarding.example", PASSWORD);
    token = (await ctx.app.services.auth.login("nuevo@onboarding.example", PASSWORD)).token;
  });

  afterEach(async () => {
    await ctx.close();
  });

  it("un usuario nuevo todavía no completó el tutorial", async () => {
    const res = await call(ctx, "GET", "/api/v1/auth/me", token);
    expect(res.json()).toMatchObject({ user: { onboardingCompleted: false } });
  });

  it("completarlo lo marca para siempre y no se repite", async () => {
    const done = await call(ctx, "POST", "/api/v1/auth/onboarding/complete", token);
    const again = await call(ctx, "POST", "/api/v1/auth/onboarding/complete", token);
    const me = await call(ctx, "GET", "/api/v1/auth/me", token);

    expect(done.statusCode).toBe(204);
    expect(again.statusCode).toBe(204);
    expect(me.json()).toMatchObject({ user: { onboardingCompleted: true } });
  });

  it("requiere sesión", async () => {
    const res = await call(ctx, "POST", "/api/v1/auth/onboarding/complete", null);
    expect(res.statusCode).toBe(401);
  });

  it("vale en cualquier sesión del mismo usuario", async () => {
    await call(ctx, "POST", "/api/v1/auth/onboarding/complete", token);
    const other = (await ctx.app.services.auth.login("nuevo@onboarding.example", PASSWORD)).token;
    const me = await call(ctx, "GET", "/api/v1/auth/me", other);

    expect(me.json()).toMatchObject({ user: { onboardingCompleted: true } });
  });
});
