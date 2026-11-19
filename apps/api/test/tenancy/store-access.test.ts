import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { PERMISSIONS } from "../../src/domain/permissions.js";
import { stores, storeRoles, users } from "../../src/db/schema/index.js";
import { buildTestApp } from "../support/app.js";
import { resetDb } from "../support/db.js";
import {
  addMember,
  createLoginUser,
  createRole,
  createStore,
  seedCurrencies,
} from "../support/fixtures.js";

const PASSWORD = "clave-segura-123";
type StoreListItem = {
  id: string;
  access: { roleName: string; isOwner: boolean };
};

const VENDEDOR_PERMISSIONS = [
  "products:read",
  "stock:read",
  "orders:read",
  "orders:create",
] as const;

describe("acceso a tiendas", () => {
  let ctx: Awaited<ReturnType<typeof buildTestApp>>;
  let storeA: Awaited<ReturnType<typeof createStore>>;
  let storeB: Awaited<ReturnType<typeof createStore>>;
  let vendedorRoleId: string;
  let ownerToken: string;
  let vendedorToken: string;
  let otherStoreToken: string;
  let platformToken: string;

  beforeEach(async () => {
    ctx = await buildTestApp();
    await resetDb(ctx.db);
    await seedCurrencies(ctx.db);

    storeA = await createStore(ctx.db, "tienda-a");
    storeB = await createStore(ctx.db, "tienda-b");

    const ownerRole = await createRole(ctx.db, storeA.id, "Propietario", [...PERMISSIONS]);
    const vendedor = await createRole(ctx.db, storeA.id, "Vendedor", [...VENDEDOR_PERMISSIONS]);
    vendedorRoleId = vendedor.id;
    const roleB = await createRole(ctx.db, storeB.id, "Vendedor", [...VENDEDOR_PERMISSIONS]);

    const owner = await createLoginUser(ctx.db, "owner@example.com", PASSWORD);
    const staff = await createLoginUser(ctx.db, "staff@example.com", PASSWORD);
    const other = await createLoginUser(ctx.db, "otra@example.com", PASSWORD);
    const platform = await createLoginUser(ctx.db, "admin@example.com", PASSWORD);
    await ctx.db
      .update(users)
      .set({ platformRole: "platform_admin" })
      .where(eq(users.id, platform.id));

    await addMember(ctx.db, {
      storeId: storeA.id,
      userId: owner.id,
      roleId: ownerRole.id,
      isOwner: true,
    });
    await addMember(ctx.db, { storeId: storeA.id, userId: staff.id, roleId: vendedor.id });
    await addMember(ctx.db, { storeId: storeB.id, userId: other.id, roleId: roleB.id });

    ownerToken = (await ctx.app.auth.login("owner@example.com", PASSWORD)).token;
    vendedorToken = (await ctx.app.auth.login("staff@example.com", PASSWORD)).token;
    otherStoreToken = (await ctx.app.auth.login("otra@example.com", PASSWORD)).token;
    platformToken = (await ctx.app.auth.login("admin@example.com", PASSWORD)).token;
  });

  afterEach(async () => {
    await ctx.close();
  });

  function get(url: string, token?: string) {
    return ctx.app.inject({
      method: "GET",
      url,
      ...(token ? { cookies: { cc_session: token } } : {}),
    });
  }

  it("el propietario ve su tienda con todos los permisos", async () => {
    const res = await get(`/api/v1/stores/${storeA.id}`, ownerToken);

    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      store: { id: storeA.id, slug: "tienda-a" },
      access: { roleName: "Propietario", isOwner: true },
    });
    expect(res.json<{ access: { permissions: string[] } }>().access.permissions).toEqual(
      expect.arrayContaining([...PERMISSIONS]),
    );
  });

  it("un miembro sin permiso de equipo recibe 403 en roles y 200 en su tienda", async () => {
    const store = await get(`/api/v1/stores/${storeA.id}`, vendedorToken);
    const roles = await get(`/api/v1/stores/${storeA.id}/roles`, vendedorToken);

    expect(store.statusCode).toBe(200);
    expect(roles.statusCode).toBe(403);
    expect(roles.json()).toMatchObject({ code: "FORBIDDEN" });
  });

  it("el propietario lista los roles de su tienda", async () => {
    const res = await get(`/api/v1/stores/${storeA.id}/roles`, ownerToken);

    expect(res.statusCode).toBe(200);
    expect(res.json<{ roles: { name: string }[] }>().roles.map((r) => r.name)).toEqual(
      expect.arrayContaining(["Propietario", "Vendedor"]),
    );
  });

  it("una tienda ajena responde 404, igual que una tienda que no existe", async () => {
    const foreign = await get(`/api/v1/stores/${storeA.id}`, otherStoreToken);
    const missing = await get(
      `/api/v1/stores/00000000-0000-4000-8000-000000000000`,
      otherStoreToken,
    );

    expect(foreign.statusCode).toBe(404);
    expect(foreign.json()).toMatchObject({ code: "STORE_NOT_FOUND" });
    expect(missing.statusCode).toBe(404);
    expect(missing.json()).toMatchObject({ code: "STORE_NOT_FOUND" });
  });

  it("el administrador general no opera datos de tiendas ajenas (Q2)", async () => {
    const res = await get(`/api/v1/stores/${storeA.id}/roles`, platformToken);

    expect(res.statusCode).toBe(404);
  });

  it("sin sesión responde 401", async () => {
    const res = await get(`/api/v1/stores/${storeA.id}`);

    expect(res.statusCode).toBe(401);
  });

  it("un uuid inválido en la ruta responde 400", async () => {
    const res = await get("/api/v1/stores/no-es-uuid", ownerToken);

    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ code: "VALIDATION_ERROR" });
  });

  it("una tienda suspendida bloquea a sus miembros", async () => {
    await ctx.db.update(stores).set({ status: "suspended" }).where(eq(stores.id, storeA.id));

    const res = await get(`/api/v1/stores/${storeA.id}`, vendedorToken);

    expect(res.statusCode).toBe(403);
    expect(res.json()).toMatchObject({ code: "STORE_INACTIVE" });
  });

  it("un cambio de permisos en el rol aplica en la siguiente request", async () => {
    const before = await get(`/api/v1/stores/${storeA.id}/roles`, vendedorToken);
    await ctx.db
      .update(storeRoles)
      .set({ permissions: [...VENDEDOR_PERMISSIONS, "team:manage"] })
      .where(eq(storeRoles.id, vendedorRoleId));
    const after = await get(`/api/v1/stores/${storeA.id}/roles`, vendedorToken);

    expect(before.statusCode).toBe(403);
    expect(after.statusCode).toBe(200);
  });

  it("/me/stores lista solo las tiendas del usuario con su rol", async () => {
    const owner = await get("/api/v1/me/stores", ownerToken);
    const other = await get("/api/v1/me/stores", otherStoreToken);

    const ownerStores = owner.json<{ stores: StoreListItem[] }>().stores;
    const otherStores = other.json<{ stores: StoreListItem[] }>().stores;

    expect(
      ownerStores.map((s) => ({
        id: s.id,
        roleName: s.access.roleName,
        isOwner: s.access.isOwner,
      })),
    ).toEqual([{ id: storeA.id, roleName: "Propietario", isOwner: true }]);
    expect(otherStores.map((s) => s.id)).toEqual([storeB.id]);
  });
});
