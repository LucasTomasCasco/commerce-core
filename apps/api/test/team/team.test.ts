import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { auditLogs, storeMembers, storeRoles } from "../../src/db/schema/index.js";
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

type Member = { id: string; userId: string; email: string; roleName: string; isOwner: boolean };
type Role = { id: string; name: string; permissions: string[]; isSystem: boolean };

describe("equipo, roles e invitaciones de staff", () => {
  let ctx: TestContext;
  let adminToken: string;
  let storeId: string;
  let ownerToken: string;
  let ownerMemberId: string;
  let vendedorRoleId: string;

  beforeEach(async () => {
    ctx = await buildTestApp();
    await resetDb(ctx.db);
    await seedCurrencies(ctx.db);
    adminToken = await createPlatformAdminSession(ctx);
    const onboarded = await onboardStore(ctx, {
      adminToken,
      slug: "casa-equipo",
      ownerEmail: "owner@equipo.example",
    });
    storeId = onboarded.store.id;
    ownerToken = onboarded.ownerToken;

    const [owner] = await ctx.db
      .select()
      .from(storeMembers)
      .where(eq(storeMembers.storeId, storeId));
    ownerMemberId = owner?.id ?? "";

    const roles = await roleList(ownerToken);
    vendedorRoleId = roles.find((r) => r.name === "Vendedor")?.id ?? "";
  });

  afterEach(async () => {
    await ctx.close();
  });

  function call(
    method: "GET" | "POST" | "PATCH" | "DELETE",
    url: string,
    token: string,
    payload?: unknown,
  ) {
    return ctx.app.inject({
      method,
      url: `/api/v1/stores/${storeId}${url}`,
      cookies: { cc_session: token },
      ...(payload !== undefined ? { payload: payload as Record<string, unknown> } : {}),
    });
  }

  async function roleList(token: string): Promise<Role[]> {
    const res = await call("GET", "/roles", token);
    return res.json<{ roles: Role[] }>().roles;
  }

  async function members(token: string): Promise<Member[]> {
    const res = await call("GET", "/members", token);
    return res.json<{ members: Member[] }>().members;
  }

  // Invita a un staff, acepta la invitación con cuenta nueva y devuelve su sesión.
  async function hireStaff(email: string, roleId: string) {
    const invite = await call("POST", "/invitations", ownerToken, { email, roleId });
    expect(invite.statusCode).toBe(202);
    const sent = ctx.sent.findLast((m) => m.to === email);
    const accept = await ctx.app.inject({
      method: "POST",
      url: "/api/v1/invitations/accept",
      payload: { token: tokenFrom(sent?.text), fullName: email, password: PASSWORD },
    });
    expect(accept.statusCode).toBe(200);
    return accept.cookies.find((c) => c.name === "cc_session")?.value ?? "";
  }

  it("el propietario invita a un staff y el staff aparece en el equipo con su rol", async () => {
    const staffToken = await hireStaff("ana@equipo.example", vendedorRoleId);

    const list = await members(ownerToken);
    const staff = list.find((m) => m.email === "ana@equipo.example");

    expect(staff).toMatchObject({ roleName: "Vendedor", isOwner: false });
    expect(staffToken).not.toBe("");
  });

  it("un staff sin permiso de equipo no puede invitar", async () => {
    const staffToken = await hireStaff("ana@equipo.example", vendedorRoleId);

    const res = await call("POST", "/invitations", staffToken, {
      email: "otra@equipo.example",
      roleId: vendedorRoleId,
    });

    expect(res.statusCode).toBe(403);
    expect(res.json()).toMatchObject({ code: "FORBIDDEN" });
  });

  it("no se puede invitar como propietario", async () => {
    const ownerRole = (await roleList(ownerToken)).find((r) => r.isSystem);

    const res = await call("POST", "/invitations", ownerToken, {
      email: "intruso@equipo.example",
      roleId: ownerRole?.id,
    });

    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ code: "INVALID_ROLE" });
  });

  it("cambia el rol de un miembro y el cambio se ve en el equipo", async () => {
    await hireStaff("ana@equipo.example", vendedorRoleId);
    const staff = (await members(ownerToken)).find((m) => m.email === "ana@equipo.example");
    const depositoRoleId = (await roleList(ownerToken)).find((r) => r.name === "Depósito")?.id;

    const res = await call("PATCH", `/members/${staff?.id ?? ""}`, ownerToken, {
      roleId: depositoRoleId,
    });

    expect(res.statusCode).toBe(204);
    expect(
      (await members(ownerToken)).find((m) => m.email === "ana@equipo.example")?.roleName,
    ).toBe("Depósito");
  });

  it("el propietario no se puede modificar ni quitar", async () => {
    const changed = await call("PATCH", `/members/${ownerMemberId}`, ownerToken, {
      roleId: vendedorRoleId,
    });
    const removed = await call("DELETE", `/members/${ownerMemberId}`, ownerToken);

    expect(changed.statusCode).toBe(409);
    expect(changed.json()).toMatchObject({ code: "OWNER_PROTECTED" });
    expect(removed.statusCode).toBe(409);
  });

  it("quitar a un miembro le corta el acceso a la tienda", async () => {
    const staffToken = await hireStaff("ana@equipo.example", vendedorRoleId);
    const staff = (await members(ownerToken)).find((m) => m.email === "ana@equipo.example");

    const removed = await call("DELETE", `/members/${staff?.id ?? ""}`, ownerToken);
    const access = await call("GET", "", staffToken);

    expect(removed.statusCode).toBe(204);
    expect(access.statusCode).toBe(404);
  });

  it("crea un rol a medida y lo asigna a un staff", async () => {
    const created = await call("POST", "/roles", ownerToken, {
      name: "Caja",
      permissions: ["orders:create", "orders:read"],
    });
    const cajaId = created.json<Role>().id;
    const staffToken = await hireStaff("caja@equipo.example", cajaId);
    const access = await call("POST", "/roles", staffToken, {
      name: "Otro",
      permissions: ["orders:read"],
    });

    expect(created.statusCode).toBe(201);
    expect(created.json()).toMatchObject({ name: "Caja", isSystem: false });
    expect(access.statusCode).toBe(403);
  });

  it("rechaza nombres de rol repetidos y permisos fuera del catálogo", async () => {
    const repeated = await call("POST", "/roles", ownerToken, {
      name: "Vendedor",
      permissions: ["orders:read"],
    });
    const unknown = await call("POST", "/roles", ownerToken, {
      name: "Raro",
      permissions: ["super:power"],
    });

    expect(repeated.statusCode).toBe(409);
    expect(repeated.json()).toMatchObject({ code: "ROLE_NAME_TAKEN" });
    expect(unknown.statusCode).toBe(400);
  });

  it("el rol Propietario no se puede editar ni eliminar", async () => {
    const ownerRole = (await roleList(ownerToken)).find((r) => r.isSystem);

    const edited = await call("PATCH", `/roles/${ownerRole?.id ?? ""}`, ownerToken, {
      permissions: ["orders:read"],
    });
    const deleted = await call("DELETE", `/roles/${ownerRole?.id ?? ""}`, ownerToken);

    expect(edited.statusCode).toBe(409);
    expect(edited.json()).toMatchObject({ code: "SYSTEM_ROLE" });
    expect(deleted.statusCode).toBe(409);
  });

  it("no elimina un rol con miembros asignados y sí elimina uno sin uso", async () => {
    await hireStaff("ana@equipo.example", vendedorRoleId);

    const inUse = await call("DELETE", `/roles/${vendedorRoleId}`, ownerToken);
    const created = await call("POST", "/roles", ownerToken, {
      name: "Temporal",
      permissions: ["stock:read"],
    });
    const unused = await call("DELETE", `/roles/${created.json<Role>().id}`, ownerToken);

    expect(inUse.statusCode).toBe(409);
    expect(inUse.json()).toMatchObject({ code: "ROLE_IN_USE" });
    expect(unused.statusCode).toBe(204);
    const remaining = await ctx.db
      .select({ id: storeRoles.id })
      .from(storeRoles)
      .where(eq(storeRoles.storeId, storeId));
    expect(remaining).toHaveLength(3);
  });

  it("editar los permisos de un rol cambia el acceso de sus miembros", async () => {
    const staffToken = await hireStaff("ana@equipo.example", vendedorRoleId);

    const before = await call("GET", "/roles", staffToken);
    await call("PATCH", `/roles/${vendedorRoleId}`, ownerToken, {
      permissions: ["products:read", "team:manage"],
    });
    const after = await call("GET", "/roles", staffToken);

    expect(before.statusCode).toBe(403);
    expect(after.statusCode).toBe(200);
  });

  it("registra auditoría de altas, cambios y bajas de roles", async () => {
    const created = await call("POST", "/roles", ownerToken, {
      name: "Auditado",
      permissions: ["stock:read"],
    });
    await call("DELETE", `/roles/${created.json<Role>().id}`, ownerToken);

    const entries = await ctx.db.select().from(auditLogs).where(eq(auditLogs.storeId, storeId));

    expect(entries.map((e) => e.action)).toEqual(
      expect.arrayContaining(["role.created", "role.deleted"]),
    );
  });
});
