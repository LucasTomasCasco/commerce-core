import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildTestApp } from "../support/app.js";
import { resetDb } from "../support/db.js";
import { seedCurrencies } from "../support/fixtures.js";
import {
  createPlatformAdminSession,
  onboardStore,
  PASSWORD,
  tokenFrom,
  type TestContext,
} from "../support/onboarding.js";

type Invitation = { id: string; email: string; roleName: string };

describe("invitaciones pendientes", () => {
  let ctx: TestContext;
  let adminToken: string;
  let storeId: string;
  let ownerToken: string;
  let vendedorRoleId: string;

  beforeEach(async () => {
    ctx = await buildTestApp();
    await resetDb(ctx.db);
    await seedCurrencies(ctx.db);
    adminToken = await createPlatformAdminSession(ctx);
    const onboarded = await onboardStore(ctx, {
      adminToken,
      slug: "casa-invita",
      ownerEmail: "owner@invita.example",
    });
    storeId = onboarded.store.id;
    ownerToken = onboarded.ownerToken;
    const roles = await ctx.app.inject({
      method: "GET",
      url: `/api/v1/stores/${storeId}/roles`,
      cookies: { cc_session: ownerToken },
    });
    vendedorRoleId =
      roles
        .json<{ roles: { id: string; name: string }[] }>()
        .roles.find((r) => r.name === "Vendedor")?.id ?? "";
  });

  afterEach(async () => {
    await ctx.close();
  });

  function call(method: "GET" | "DELETE" | "POST", url: string, token: string) {
    return ctx.app.inject({ method, url, cookies: { cc_session: token } });
  }

  async function invite(email: string) {
    await ctx.app.inject({
      method: "POST",
      url: `/api/v1/stores/${storeId}/invitations`,
      cookies: { cc_session: ownerToken },
      payload: { email, roleId: vendedorRoleId },
    });
    return ctx.sent.findLast((m) => m.to === email)?.text;
  }

  async function listed() {
    const res = await call("GET", `/api/v1/stores/${storeId}/invitations`, ownerToken);
    return res.json<{ invitations: Invitation[] }>().invitations;
  }

  it("lista las invitaciones pendientes con su rol", async () => {
    await invite("ana@invita.example");

    const pending = await listed();

    expect(pending).toEqual([
      expect.objectContaining({ email: "ana@invita.example", roleName: "Vendedor" }),
    ]);
  });

  it("revocar una invitación invalida su enlace y la saca de la lista", async () => {
    const text = await invite("ana@invita.example");
    const [invitation] = await listed();

    const revoked = await call(
      "DELETE",
      `/api/v1/stores/${storeId}/invitations/${invitation?.id ?? ""}`,
      ownerToken,
    );
    const accept = await ctx.app.inject({
      method: "POST",
      url: `/api/v1/invitations/${tokenFrom(text)}/accept`,
      payload: { fullName: "Ana", password: PASSWORD },
    });

    expect(revoked.statusCode).toBe(204);
    expect(accept.statusCode).toBe(400);
    expect(await listed()).toEqual([]);
  });

  it("reenviar envía un enlace nuevo, invalida el anterior y el nuevo acepta", async () => {
    const oldText = await invite("ana@invita.example");
    const [invitation] = await listed();

    const resend = await call(
      "POST",
      `/api/v1/stores/${storeId}/invitations/${invitation?.id ?? ""}/resend`,
      ownerToken,
    );
    const newText = ctx.sent.findLast((m) => m.to === "ana@invita.example")?.text;
    const oldAccept = await ctx.app.inject({
      method: "POST",
      url: `/api/v1/invitations/${tokenFrom(oldText)}/accept`,
      payload: { fullName: "Ana", password: PASSWORD },
    });
    const newAccept = await ctx.app.inject({
      method: "POST",
      url: `/api/v1/invitations/${tokenFrom(newText)}/accept`,
      payload: { fullName: "Ana", password: PASSWORD },
    });

    expect(resend.statusCode).toBe(202);
    expect(newText).not.toBe(oldText);
    expect(oldAccept.statusCode).toBe(400);
    expect(newAccept.statusCode).toBe(200);
  });

  it("el administrador general reenvía la invitación del propietario hasta que la acepta", async () => {
    const created = await ctx.app.inject({
      method: "POST",
      url: "/api/v1/platform/stores",
      cookies: { cc_session: adminToken },
      payload: {
        name: "Tienda Reenvío",
        slug: "tienda-reenvio",
        currencyCode: "ARS",
        ownerEmail: "dueno@reenvio.example",
      },
    });
    const storeIdNew = created.json<{ id: string }>().id;
    const oldText = ctx.sent.findLast((m) => m.to === "dueno@reenvio.example")?.text;

    const resend = await ctx.app.inject({
      method: "POST",
      url: `/api/v1/platform/stores/${storeIdNew}/owner-invitation/resend`,
      cookies: { cc_session: adminToken },
    });
    const newText = ctx.sent.findLast((m) => m.to === "dueno@reenvio.example")?.text;
    const oldAccept = await ctx.app.inject({
      method: "POST",
      url: `/api/v1/invitations/${tokenFrom(oldText)}/accept`,
      payload: { fullName: "Dueño", password: PASSWORD },
    });

    expect(resend.statusCode).toBe(202);
    expect(newText).not.toBe(oldText);
    expect(oldAccept.statusCode).toBe(400);

    await ctx.app.inject({
      method: "POST",
      url: `/api/v1/invitations/${tokenFrom(newText)}/accept`,
      payload: { fullName: "Dueño", password: PASSWORD },
    });
    const after = await ctx.app.inject({
      method: "POST",
      url: `/api/v1/platform/stores/${storeIdNew}/owner-invitation/resend`,
      cookies: { cc_session: adminToken },
    });

    expect(after.statusCode).toBe(409);
    expect(after.json()).toMatchObject({ code: "NO_PENDING_OWNER_INVITATION" });
  });
});
