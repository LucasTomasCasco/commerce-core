import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { storeRoles } from "../../src/db/schema/index.js";
import { buildTestApp } from "../support/app.js";
import { call, type Ctx } from "../support/api.js";
import { resetDb } from "../support/db.js";
import { addMember, createLoginUser, seedCurrencies } from "../support/fixtures.js";
import { createPlatformAdminSession, onboardStore, PASSWORD } from "../support/onboarding.js";

// Matriz de permisos: un rol con UN solo permiso debe poder lo suyo y nada más.
type Case = { permission: string; allowed: [string, string]; denied: [string, string, unknown?][] };

describe("matriz de permisos por rol", () => {
  let ctx: Ctx;
  let storeId: string;
  let ownerToken: string;
  let productId: string;

  beforeEach(async () => {
    ctx = await buildTestApp();
    await resetDb(ctx.db);
    await seedCurrencies(ctx.db);
    const onboarded = await onboardStore(ctx, {
      adminToken: await createPlatformAdminSession(ctx),
      slug: "tienda-permisos",
      ownerEmail: "owner@permisos.example",
    });
    storeId = onboarded.store.id;
    ownerToken = onboarded.ownerToken;
    const created = await call(ctx, "POST", `/api/v1/stores/${storeId}/products`, ownerToken, {
      sku: "PERM-1",
      name: "Producto permisos",
      priceMinor: 100,
    });
    productId = created.json<{ id: string }>().id;
  });

  afterEach(async () => {
    await ctx.close();
  });

  // Crea un rol con exactamente `permissions`, asigna un usuario y devuelve su sesión.
  async function sessionWith(permissions: string[], email: string): Promise<string> {
    const [role] = await ctx.db
      .insert(storeRoles)
      .values({ storeId, name: `Rol ${email}`, permissions })
      .returning();
    const user = await createLoginUser(ctx.db, email, PASSWORD);
    await addMember(ctx.db, { storeId, userId: user.id, roleId: role?.id ?? "" });
    const { token } = await ctx.app.services.auth.login(email, PASSWORD);
    return token;
  }

  const cases: Case[] = [
    {
      permission: "products:read",
      allowed: ["GET", "/products"],
      denied: [["POST", "/products", { sku: "X", name: "X", priceMinor: 1 }]],
    },
    {
      permission: "products:manage",
      allowed: ["POST", "/products"],
      denied: [["GET", "/roles"]],
    },
    {
      permission: "categories:manage",
      allowed: ["POST", "/categories"],
      denied: [["POST", "/products", { sku: "Y", name: "Y", priceMinor: 1 }]],
    },
    {
      permission: "stock:read",
      allowed: ["GET", "/stock-movements"],
      denied: [["GET", "/roles"]],
    },
    {
      permission: "stock:adjust",
      allowed: ["POST", "/stock-movements"],
      denied: [["GET", "/stock-movements"]],
    },
    {
      permission: "orders:read",
      allowed: ["GET", "/orders"],
      denied: [["GET", "/audit"]],
    },
    {
      permission: "orders:create",
      allowed: ["POST", "/orders"],
      denied: [["GET", "/roles"]],
    },
    {
      permission: "orders:update_status",
      allowed: ["POST", "/orders/00000000-0000-4000-8000-000000000000/confirm"],
      denied: [["POST", "/orders/00000000-0000-4000-8000-000000000000/cancel"]],
    },
    {
      permission: "orders:cancel",
      allowed: ["POST", "/orders/00000000-0000-4000-8000-000000000000/cancel"],
      denied: [["POST", "/orders/00000000-0000-4000-8000-000000000000/fulfill"]],
    },
    {
      permission: "team:manage",
      allowed: ["GET", "/members"],
      denied: [["GET", "/audit"]],
    },
    {
      permission: "store:settings",
      allowed: ["PATCH", ""],
      denied: [["GET", "/members"]],
    },
    {
      permission: "audit:read",
      allowed: ["GET", "/audit"],
      denied: [["GET", "/members"]],
    },
  ];

  for (const c of cases) {
    it(`el permiso ${c.permission} habilita lo suyo y bloquea lo ajeno`, async () => {
      const token = await sessionWith(
        [c.permission],
        `solo-${c.permission.replace(/[^a-z]/g, "")}@permisos.example`,
      );
      const path = (suffix: string) => `/api/v1/stores/${storeId}${suffix}`;

      const [method, suffix] = c.allowed;
      const body =
        c.permission === "store:settings"
          ? { name: "Nuevo nombre" }
          : c.permission === "products:manage"
            ? { sku: "NEW-1", name: "Nuevo", priceMinor: 1 }
            : c.permission === "categories:manage"
              ? { name: "Cat", slug: "cat-perm" }
              : c.permission === "stock:adjust"
                ? { productId, type: "purchase", quantityDelta: 1 }
                : c.permission === "orders:create"
                  ? {
                      customerName: "Ana",
                      customerPhone: "+54 11 1111",
                      items: [{ productId, quantity: 1 }],
                    }
                  : undefined;
      const allowed = await call(ctx, method as "GET", path(suffix), token, body);
      expect(allowed.statusCode, `${c.permission} debería permitir ${method} ${suffix}`).not.toBe(
        403,
      );
      expect(allowed.statusCode).not.toBe(401);

      for (const [dMethod, dSuffix] of c.denied) {
        const denied = await call(ctx, dMethod as "GET", path(dSuffix), token, {});
        expect(denied.statusCode, `${c.permission} NO debería permitir ${dMethod} ${dSuffix}`).toBe(
          403,
        );
      }
    });
  }

  it("un rol sin permisos de lectura no ve el detalle de productos", async () => {
    const token = await sessionWith(["stock:read"], "sin-lectura@permisos.example");
    const res = await call(ctx, "GET", `/api/v1/stores/${storeId}/products/${productId}`, token);
    expect(res.statusCode).toBe(403);
  });

  it("quitar un permiso del rol lo revoca en la siguiente request", async () => {
    const token = await sessionWith(["audit:read"], "revocable@permisos.example");
    const [role] = await ctx.db
      .select()
      .from(storeRoles)
      .where(eq(storeRoles.name, "Rol revocable@permisos.example"));
    const before = await call(ctx, "GET", `/api/v1/stores/${storeId}/audit`, token);
    await ctx.db
      .update(storeRoles)
      .set({ permissions: [] })
      .where(eq(storeRoles.id, role?.id ?? ""));
    const after = await call(ctx, "GET", `/api/v1/stores/${storeId}/audit`, token);

    expect(before.statusCode).toBe(200);
    expect(after.statusCode).toBe(403);
  });
});
