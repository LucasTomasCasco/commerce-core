import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { auditLogs } from "../../src/db/schema/index.js";
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

type Member = { email: string; isOwner: boolean; roleName: string };
type Role = { id: string; name: string; isSystem: boolean };

describe("transferencia de propiedad", () => {
  let ctx: Ctx;
  let adminToken: string;
  let storeId: string;
  let oldOwnerToken: string;
  let vendedorId: string;

  beforeEach(async () => {
    ctx = await buildTestApp();
    await resetDb(ctx.db);
    await seedCurrencies(ctx.db);
    adminToken = await createPlatformAdminSession(ctx);
    const onboarded = await onboardStore(ctx, {
      adminToken,
      slug: "tienda-traspaso",
      ownerEmail: "viejo@traspaso.example",
    });
    storeId = onboarded.store.id;
    oldOwnerToken = onboarded.ownerToken;
    const roles = await call(ctx, "GET", `/api/v1/stores/${storeId}/roles`, oldOwnerToken);
    vendedorId = roles.json<{ roles: Role[] }>().roles.find((r) => r.name === "Vendedor")?.id ?? "";
  });

  afterEach(async () => {
    await ctx.close();
  });

  const transfer = (email: string, demoteToRoleId: string) =>
    call(ctx, "POST", `/api/v1/platform/stores/${storeId}/owner-transfer`, adminToken, {
      ownerEmail: email,
      demoteToRoleId,
    });

  async function members(token: string): Promise<Member[]> {
    const res = await call(ctx, "GET", `/api/v1/stores/${storeId}/members`, token);
    return res.json<{ members: Member[] }>().members;
  }

  it("envía la invitación al nuevo propietario y la tienda sigue con el actual hasta que acepte", async () => {
    const res = await transfer("nuevo@traspaso.example", vendedorId);
    const list = await members(oldOwnerToken);

    expect(res.statusCode).toBe(202);
    expect(ctx.sent.some((m) => m.to === "nuevo@traspaso.example")).toBe(true);
    expect(list.find((m) => m.email === "viejo@traspaso.example")?.isOwner).toBe(true);
    expect(list.find((m) => m.email === "nuevo@traspaso.example")).toBeUndefined();
  });

  it("al aceptar, el nuevo queda como único propietario y el anterior pasa al rol elegido", async () => {
    await transfer("nuevo@traspaso.example", vendedorId);
    const token = tokenFrom(ctx.sent.findLast((m) => m.to === "nuevo@traspaso.example")?.text);
    const accept = await call(ctx, "POST", "/api/v1/invitations/accept", null, {
      token,
      fullName: "Nueva Dueña",
      password: PASSWORD,
    });
    const newOwnerToken = accept.cookies.find((c) => c.name === "cc_session")?.value ?? "";
    const list = await members(newOwnerToken);

    expect(accept.statusCode).toBe(200);
    expect(list.find((m) => m.email === "nuevo@traspaso.example")).toMatchObject({ isOwner: true });
    expect(list.find((m) => m.email === "viejo@traspaso.example")).toMatchObject({
      isOwner: false,
      roleName: "Vendedor",
    });
    expect(list.filter((m) => m.isOwner)).toHaveLength(1);
  });

  it("el propietario anterior pierde la administración y conserva el acceso con su nuevo rol", async () => {
    await transfer("nuevo@traspaso.example", vendedorId);
    const token = tokenFrom(ctx.sent.findLast((m) => m.to === "nuevo@traspaso.example")?.text);
    await call(ctx, "POST", "/api/v1/invitations/accept", null, {
      token,
      fullName: "Nueva",
      password: PASSWORD,
    });

    const access = await call(ctx, "GET", `/api/v1/stores/${storeId}`, oldOwnerToken);
    const roles = await call(ctx, "GET", `/api/v1/stores/${storeId}/roles`, oldOwnerToken);

    expect(access.statusCode).toBe(200);
    expect(access.json()).toMatchObject({ access: { roleName: "Vendedor", isOwner: false } });
    expect(roles.statusCode).toBe(403);
  });

  it("registra la transferencia y la degradación en auditoría", async () => {
    await transfer("nuevo@traspaso.example", vendedorId);
    const token = tokenFrom(ctx.sent.findLast((m) => m.to === "nuevo@traspaso.example")?.text);
    await call(ctx, "POST", "/api/v1/invitations/accept", null, {
      token,
      fullName: "Nueva",
      password: PASSWORD,
    });
    const entries = await ctx.db.select().from(auditLogs).where(eq(auditLogs.storeId, storeId));
    const actions = entries.map((e) => e.action);

    expect(actions).toEqual(expect.arrayContaining(["owner.transfer_requested", "owner.demoted"]));
  });

  it("una segunda transferencia revoca la invitación pendiente de la primera", async () => {
    await transfer("primero@traspaso.example", vendedorId);
    const firstToken = tokenFrom(
      ctx.sent.findLast((m) => m.to === "primero@traspaso.example")?.text,
    );
    await transfer("segundo@traspaso.example", vendedorId);

    const stale = await call(ctx, "POST", "/api/v1/invitations/preview", null, {
      token: firstToken,
    });

    expect(stale.statusCode).toBe(400);
    expect(stale.json()).toMatchObject({ code: "INVALID_TOKEN" });
  });

  it("no se puede degradar al propietario a un rol de sistema", async () => {
    const roles = await call(ctx, "GET", `/api/v1/platform/stores/${storeId}/roles`, adminToken);
    expect(roles.json<{ roles: Role[] }>().roles.map((r) => r.name)).not.toContain("Propietario");

    const ownerRole = (await call(ctx, "GET", `/api/v1/stores/${storeId}/roles`, oldOwnerToken))
      .json<{ roles: Role[] }>()
      .roles.find((r) => r.isSystem);
    const res = await transfer("otro@traspaso.example", ownerRole?.id ?? "");

    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ code: "INVALID_ROLE" });
  });

  it("transferir una tienda inexistente responde 404", async () => {
    const res = await call(
      ctx,
      "POST",
      "/api/v1/platform/stores/00000000-0000-4000-8000-000000000000/owner-transfer",
      adminToken,
      { ownerEmail: "x@traspaso.example", demoteToRoleId: vendedorId },
    );
    expect(res.statusCode).toBe(404);
  });

  it("solo el administrador general puede transferir la propiedad", async () => {
    const res = await call(
      ctx,
      "POST",
      `/api/v1/platform/stores/${storeId}/owner-transfer`,
      oldOwnerToken,
      {
        ownerEmail: "x@traspaso.example",
        demoteToRoleId: vendedorId,
      },
    );
    expect(res.statusCode).toBe(403);
  });

  it("quien no es el email invitado no puede aceptar la transferencia aunque tenga sesión", async () => {
    // Si el email invitado ya tiene cuenta, solo esa cuenta puede aceptar.
    await createLoginUser(ctx.db, "nuevo@traspaso.example", PASSWORD);
    await transfer("nuevo@traspaso.example", vendedorId);
    const token = tokenFrom(ctx.sent.findLast((m) => m.to === "nuevo@traspaso.example")?.text);
    await createLoginUser(ctx.db, "intruso@traspaso.example", PASSWORD);
    const { token: intruso } = await ctx.app.services.auth.login(
      "intruso@traspaso.example",
      PASSWORD,
    );

    const res = await call(ctx, "POST", "/api/v1/invitations/accept", intruso, { token });

    expect(res.statusCode).toBe(403);
    expect(res.json()).toMatchObject({ code: "INVITATION_EMAIL_MISMATCH" });
  });
});
