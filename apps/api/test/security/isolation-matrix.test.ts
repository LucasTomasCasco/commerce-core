import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildTestApp } from "../support/app.js";
import { call, UNKNOWN_UUID, type Ctx, type Method } from "../support/api.js";
import { resetDb } from "../support/db.js";
import { seedCurrencies } from "../support/fixtures.js";
import {
  createPlatformAdminSession,
  onboardStore,
  type TestContext,
} from "../support/onboarding.js";

// Matriz generada desde el OpenAPI real: recorre TODAS las rutas de tienda y comprueba que un
// usuario de otra tienda nunca obtenga datos ni escriba. Si se agrega una ruta nueva, queda cubierta.
const METHODS = ["get", "post", "patch", "delete"] as const;

type Operation = { method: Method; path: string };

function storeOperations(ctx: Ctx): Operation[] {
  const doc = ctx.app.swagger() as { paths: Record<string, Record<string, unknown>> };
  const ops: Operation[] = [];
  for (const [path, item] of Object.entries(doc.paths)) {
    if (!path.includes("{storeId}") || path.startsWith("/api/v1/platform/")) continue;
    for (const method of METHODS) {
      if (item[method]) ops.push({ method: method.toUpperCase() as Method, path });
    }
  }
  return ops;
}

function fill(path: string, storeId: string): string {
  return path.replace("{storeId}", storeId).replace(/\{(\w+)\}/g, () => UNKNOWN_UUID);
}

describe("matriz de aislamiento entre tiendas (todas las rutas de tienda)", () => {
  let ctx: TestContext;
  let storeA: string;
  let ownerB: string;
  let ops: Operation[];

  beforeEach(async () => {
    ctx = await buildTestApp();
    await resetDb(ctx.db);
    await seedCurrencies(ctx.db);
    const admin = await createPlatformAdminSession(ctx);
    const a = await onboardStore(ctx, {
      adminToken: admin,
      slug: "tienda-matriz-a",
      ownerEmail: "a@matriz.example",
    });
    const b = await onboardStore(ctx, {
      adminToken: admin,
      slug: "tienda-matriz-b",
      ownerEmail: "b@matriz.example",
    });
    storeA = a.store.id;
    ownerB = b.ownerToken;
    ops = storeOperations(ctx);
  });

  afterEach(async () => {
    await ctx.close();
  });

  it("hay rutas de tienda que cubrir", () => {
    expect(ops.length).toBeGreaterThan(20);
  });

  it("un propietario ajeno nunca recibe 2xx ni 5xx sobre otra tienda", async () => {
    const failures: string[] = [];
    for (const op of ops) {
      const res = await call(ctx, op.method, fill(op.path, storeA), ownerB, {});
      const ok = res.statusCode >= 200 && res.statusCode < 300;
      if (ok || res.statusCode >= 500)
        failures.push(`${op.method} ${op.path} -> ${String(res.statusCode)}`);
      expect(res.statusCode, `${op.method} ${op.path}`).toBe(404);
    }
    expect(failures).toEqual([]);
  });

  it("sin sesión toda ruta de tienda responde 401 o 400, nunca datos", async () => {
    const failures: string[] = [];
    for (const op of ops) {
      const res = await call(ctx, op.method, fill(op.path, storeA), null, {});
      if (![400, 401].includes(res.statusCode))
        failures.push(`${op.method} ${op.path} -> ${String(res.statusCode)}`);
    }
    expect(failures).toEqual([]);
  });

  it("los endpoints de plataforma rechazan a un propietario de tienda con 403", async () => {
    const platform = ctx.app.swagger() as { paths: Record<string, Record<string, unknown>> };
    const failures: string[] = [];
    for (const [path, item] of Object.entries(platform.paths)) {
      if (!path.startsWith("/api/v1/platform/")) continue;
      for (const method of METHODS) {
        if (!item[method]) continue;
        const res = await call(ctx, method.toUpperCase() as Method, fill(path, storeA), ownerB, {});
        if (res.statusCode !== 403)
          failures.push(`${method.toUpperCase()} ${path} -> ${String(res.statusCode)}`);
      }
    }
    expect(failures).toEqual([]);
  });

  it("un propietario ajeno no altera los productos de la tienda A", async () => {
    const before = await call(ctx, "GET", `/api/v1/stores/${storeA}/products`, ownerB);
    await call(ctx, "POST", `/api/v1/stores/${storeA}/products`, ownerB, {
      sku: "HACK",
      name: "Intruso",
      priceMinor: 1,
    });
    const after = await call(ctx, "GET", `/api/v1/stores/${storeA}/products`, ownerB);

    expect(before.statusCode).toBe(404);
    expect(after.statusCode).toBe(404);
  });
});
