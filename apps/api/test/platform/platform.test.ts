import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { auditLogs, currencies, storeRoles, stores } from "../../src/db/schema/index.js";
import { buildTestApp } from "../support/app.js";
import { resetDb } from "../support/db.js";
import { createLoginUser, seedCurrencies } from "../support/fixtures.js";
import {
  createPlatformAdminSession,
  onboardStore,
  PASSWORD,
  tokenFrom,
  type TestContext,
} from "../support/onboarding.js";

describe("administración de plataforma", () => {
  let ctx: TestContext;
  let adminToken: string;

  beforeEach(async () => {
    ctx = await buildTestApp();
    await resetDb(ctx.db);
    await seedCurrencies(ctx.db);
    adminToken = await createPlatformAdminSession(ctx);
  });

  afterEach(async () => {
    await ctx.close();
  });

  function createStore(token: string, payload: Record<string, unknown>) {
    return ctx.app.inject({
      method: "POST",
      url: "/api/v1/platform/stores",
      cookies: { cc_session: token },
      payload: {
        name: "Librería Norte",
        slug: "libreria-norte",
        currencyCode: "ARS",
        ownerEmail: "dueno@example.com",
        ...payload,
      },
    });
  }

  it("crea la tienda con sus roles por defecto y envía la invitación al propietario", async () => {
    const res = await createStore(adminToken, {});

    expect(res.statusCode).toBe(201);
    expect(res.json()).toMatchObject({
      slug: "libreria-norte",
      status: "active",
      currencyCode: "ARS",
    });
    const storeId = res.json<{ id: string }>().id;
    const roles = await ctx.db.select().from(storeRoles).where(eq(storeRoles.storeId, storeId));
    expect(roles.map((r) => r.name).sort()).toEqual(["Depósito", "Propietario", "Vendedor"]);
    expect(roles.find((r) => r.name === "Propietario")?.isSystem).toBe(true);
    expect(ctx.sent).toHaveLength(1);
    expect(ctx.sent[0]).toMatchObject({
      to: "dueno@example.com",
      subject: "Te invitaron a Librería Norte",
    });
  });

  it("registra la creación en auditoría", async () => {
    const res = await createStore(adminToken, {});
    const storeId = res.json<{ id: string }>().id;

    const entries = await ctx.db.select().from(auditLogs).where(eq(auditLogs.storeId, storeId));

    expect(entries.map((e) => e.action)).toContain("store.created");
  });

  it("rechaza slugs repetidos, slugs inválidos y monedas no disponibles", async () => {
    await createStore(adminToken, {});
    const repeated = await createStore(adminToken, { ownerEmail: "otro@example.com" });
    const invalidSlug = await createStore(adminToken, { slug: "Libreria Norte!" });
    await ctx.db.update(currencies).set({ isActive: false }).where(eq(currencies.code, "USD"));
    const inactive = await createStore(adminToken, { slug: "tienda-usd", currencyCode: "USD" });

    expect(repeated.statusCode).toBe(409);
    expect(repeated.json()).toMatchObject({ code: "SLUG_TAKEN" });
    expect(invalidSlug.statusCode).toBe(400);
    expect(inactive.statusCode).toBe(400);
    expect(inactive.json()).toMatchObject({ code: "CURRENCY_NOT_AVAILABLE" });
  });

  it("el propietario acepta la invitación, crea su cuenta y queda con acceso total", async () => {
    await createStore(adminToken, {});
    const token = tokenFrom(ctx.sent[0]?.text);

    const preview = await ctx.app.inject({ method: "GET", url: `/api/v1/invitations/${token}` });
    const accept = await ctx.app.inject({
      method: "POST",
      url: `/api/v1/invitations/${token}/accept`,
      payload: { fullName: "Dueña", password: PASSWORD },
    });
    const storeId = accept.json<{ storeId: string }>().storeId;
    const access = await ctx.app.inject({
      method: "GET",
      url: `/api/v1/stores/${storeId}`,
      cookies: { cc_session: accept.cookies[0]?.value ?? "" },
    });

    expect(preview.json()).toMatchObject({
      email: "dueno@example.com",
      storeName: "Librería Norte",
      roleName: "Propietario",
      accountExists: false,
    });
    expect(accept.statusCode).toBe(200);
    expect(access.json()).toMatchObject({ access: { isOwner: true, roleName: "Propietario" } });
  });

  it("una invitación ya usada no se puede aceptar de nuevo", async () => {
    await createStore(adminToken, {});
    const token = tokenFrom(ctx.sent[0]?.text);
    await ctx.app.inject({
      method: "POST",
      url: `/api/v1/invitations/${token}/accept`,
      payload: { fullName: "Dueña", password: PASSWORD },
    });

    const again = await ctx.app.inject({
      method: "POST",
      url: `/api/v1/invitations/${token}/accept`,
      payload: { fullName: "Dueña", password: PASSWORD },
    });

    expect(again.statusCode).toBe(400);
    expect(again.json()).toMatchObject({ code: "INVALID_TOKEN" });
  });

  it("una cuenta existente debe aceptar la invitación desde su propia sesión", async () => {
    await createLoginUser(ctx.db, "dueno@example.com", PASSWORD);
    await createStore(adminToken, {});
    const token = tokenFrom(ctx.sent[0]?.text);

    const anonymous = await ctx.app.inject({
      method: "POST",
      url: `/api/v1/invitations/${token}/accept`,
      payload: {},
    });
    const { token: ownSession } = await ctx.app.services.auth.login("dueno@example.com", PASSWORD);
    const owned = await ctx.app.inject({
      method: "POST",
      url: `/api/v1/invitations/${token}/accept`,
      cookies: { cc_session: ownSession },
      payload: {},
    });

    expect(anonymous.statusCode).toBe(403);
    expect(anonymous.json()).toMatchObject({ code: "INVITATION_EMAIL_MISMATCH" });
    expect(owned.statusCode).toBe(200);
  });

  it("solo el administrador general puede usar la administración de plataforma", async () => {
    await createLoginUser(ctx.db, "cliente@example.com", PASSWORD);
    const { token } = await ctx.app.services.auth.login("cliente@example.com", PASSWORD);

    const res = await ctx.app.inject({
      method: "GET",
      url: "/api/v1/platform/stores",
      cookies: { cc_session: token },
    });
    const anonymous = await ctx.app.inject({ method: "GET", url: "/api/v1/platform/stores" });

    expect(res.statusCode).toBe(403);
    expect(anonymous.statusCode).toBe(401);
  });

  it("suspender una tienda bloquea a su propietario y reactivarla lo restaura", async () => {
    const { store, ownerToken } = await onboardStore(ctx, {
      adminToken,
      slug: "tienda-suspension",
      ownerEmail: "suspension@example.com",
    });

    const suspend = await ctx.app.inject({
      method: "PATCH",
      url: `/api/v1/platform/stores/${store.id}`,
      cookies: { cc_session: adminToken },
      payload: { status: "suspended" },
    });
    const blocked = await ctx.app.inject({
      method: "GET",
      url: `/api/v1/stores/${store.id}`,
      cookies: { cc_session: ownerToken },
    });
    await ctx.app.inject({
      method: "PATCH",
      url: `/api/v1/platform/stores/${store.id}`,
      cookies: { cc_session: adminToken },
      payload: { status: "active" },
    });
    const restored = await ctx.app.inject({
      method: "GET",
      url: `/api/v1/stores/${store.id}`,
      cookies: { cc_session: ownerToken },
    });

    expect(suspend.statusCode).toBe(200);
    expect(blocked.json()).toMatchObject({ code: "STORE_INACTIVE" });
    expect(restored.statusCode).toBe(200);
  });

  it("lista tiendas con paginación y agrega monedas", async () => {
    await createStore(adminToken, {});
    await createStore(adminToken, {
      slug: "otra-tienda",
      ownerEmail: "otro@example.com",
      name: "Otra",
    });

    const list = await ctx.app.inject({
      method: "GET",
      url: "/api/v1/platform/stores?limit=1&offset=0",
      cookies: { cc_session: adminToken },
    });
    const currency = await ctx.app.inject({
      method: "POST",
      url: "/api/v1/platform/currencies",
      cookies: { cc_session: adminToken },
      payload: { code: "GBP", name: "Libra esterlina", minorUnit: 2 },
    });
    const repeated = await ctx.app.inject({
      method: "POST",
      url: "/api/v1/platform/currencies",
      cookies: { cc_session: adminToken },
      payload: { code: "GBP", name: "Libra esterlina", minorUnit: 2 },
    });

    expect(list.json()).toMatchObject({ total: 2, limit: 1, offset: 0 });
    expect(list.json<{ items: unknown[] }>().items).toHaveLength(1);
    expect(currency.statusCode).toBe(201);
    expect(repeated.json()).toMatchObject({ code: "CURRENCY_EXISTS" });
  });

  it("no permite cambiar el estado de una tienda a draft", async () => {
    const { store } = await onboardStore(ctx, {
      adminToken,
      slug: "tienda-draft",
      ownerEmail: "draft@example.com",
    });

    const res = await ctx.app.inject({
      method: "PATCH",
      url: `/api/v1/platform/stores/${store.id}`,
      cookies: { cc_session: adminToken },
      payload: { status: "draft" },
    });
    const [row] = await ctx.db.select().from(stores).where(eq(stores.id, store.id));

    expect(res.statusCode).toBe(400);
    expect(row?.status).toBe("active");
  });
});
