import { and, eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { auditLogs, storeRoles } from "../../src/db/schema/index.js";
import { buildTestApp } from "../support/app.js";
import { resetDb } from "../support/db.js";
import { addMember, createLoginUser, seedCurrencies } from "../support/fixtures.js";
import {
  createPlatformAdminSession,
  onboardStore,
  PASSWORD,
  type TestContext,
} from "../support/onboarding.js";

describe("datos de la tienda", () => {
  let ctx: TestContext;
  let storeId: string;
  let ownerToken: string;

  beforeEach(async () => {
    ctx = await buildTestApp();
    await resetDb(ctx.db);
    await seedCurrencies(ctx.db);
    const onboarded = await onboardStore(ctx, {
      adminToken: await createPlatformAdminSession(ctx),
      slug: "casa-ajustes",
      ownerEmail: "owner@ajustes.example",
    });
    storeId = onboarded.store.id;
    ownerToken = onboarded.ownerToken;
  });

  afterEach(async () => {
    await ctx.close();
  });

  function rename(token: string, name: string) {
    return ctx.app.inject({
      method: "PATCH",
      url: `/api/v1/stores/${storeId}`,
      cookies: { cc_session: token },
      payload: { name },
    });
  }

  it("el propietario cambia el nombre y queda auditado", async () => {
    const res = await rename(ownerToken, "Casa Ajustes Renovada");
    const entries = await ctx.db
      .select()
      .from(auditLogs)
      .where(and(eq(auditLogs.storeId, storeId), eq(auditLogs.action, "store.renamed")));

    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ name: "Casa Ajustes Renovada" });
    expect(entries).toHaveLength(1);
  });

  it("un miembro sin store:settings no puede editar la tienda", async () => {
    const [vendedor] = await ctx.db
      .select()
      .from(storeRoles)
      .where(and(eq(storeRoles.storeId, storeId), eq(storeRoles.name, "Vendedor")));
    const staff = await createLoginUser(ctx.db, "vendedor@ajustes.example", PASSWORD);
    await addMember(ctx.db, { storeId, userId: staff.id, roleId: vendedor?.id ?? "" });
    const { token } = await ctx.app.services.auth.login("vendedor@ajustes.example", PASSWORD);

    const res = await rename(token, "Intento");

    expect(res.statusCode).toBe(403);
    expect(res.json()).toMatchObject({ code: "FORBIDDEN" });
  });

  it("rechaza nombres vacíos", async () => {
    const res = await rename(ownerToken, "   ");

    expect(res.statusCode).toBe(400);
  });
});
