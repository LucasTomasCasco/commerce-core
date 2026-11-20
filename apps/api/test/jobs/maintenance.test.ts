import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { idempotencyKeys, orders, products } from "../../src/db/schema/index.js";
import { cleanupIdempotencyKeys, expireStalePendingOrders } from "../../src/jobs/maintenance.js";
import { buildTestApp } from "../support/app.js";
import { call, type Ctx } from "../support/api.js";
import { ledgerMismatches } from "../support/ledger.js";
import { resetDb } from "../support/db.js";
import { seedCurrencies } from "../support/fixtures.js";
import { createPlatformAdminSession, onboardStore } from "../support/onboarding.js";

const HOURS = 60 * 60 * 1000;

describe("jobs de mantenimiento", () => {
  let ctx: Ctx;
  let storeId: string;
  let ownerToken: string;
  let productId: string;

  beforeEach(async () => {
    ctx = await buildTestApp({ orderPendingTtlHours: 48 });
    await resetDb(ctx.db);
    await seedCurrencies(ctx.db);
    const onboarded = await onboardStore(ctx, {
      adminToken: await createPlatformAdminSession(ctx),
      slug: "tienda-jobs",
      ownerEmail: "owner@jobs.example",
    });
    storeId = onboarded.store.id;
    ownerToken = onboarded.ownerToken;
    const p = await call(ctx, "POST", `/api/v1/stores/${storeId}/products`, ownerToken, {
      sku: "JOB-1",
      name: "Producto jobs",
      priceMinor: 500,
    });
    productId = p.json<{ id: string }>().id;
    await call(ctx, "POST", `/api/v1/stores/${storeId}/stock-movements`, ownerToken, {
      productId,
      type: "purchase",
      quantityDelta: 10,
    });
  });

  afterEach(async () => {
    await ctx.close();
  });

  async function createOrder(key?: string) {
    const res = await ctx.app.inject({
      method: "POST",
      url: `/api/v1/stores/${storeId}/orders`,
      cookies: { cc_session: ownerToken },
      headers: key ? { "idempotency-key": key } : {},
      payload: {
        customerName: "Cliente",
        customerPhone: "+54 11 2222",
        items: [{ productId, quantity: 3 }],
      },
    });
    return res.json<{ id: string; status: string }>();
  }

  async function stock(): Promise<number> {
    const [row] = await ctx.db.select().from(products).where(eq(products.id, productId));
    return row?.stockOnHand ?? -1;
  }

  it("un pedido pendiente vencido se cancela y devuelve su stock", async () => {
    const order = await createOrder();
    expect(await stock()).toBe(7);
    const expired = await expireStalePendingOrders(ctx.db, {
      now: new Date(Date.now() + 49 * HOURS),
      ttlHours: 48,
    });
    const [row] = await ctx.db.select().from(orders).where(eq(orders.id, order.id));

    expect(expired).toBe(1);
    expect(row?.status).toBe("cancelled");
    expect(await stock()).toBe(10);
    expect(await ledgerMismatches(ctx.db, storeId)).toEqual([]);
  });

  it("un pedido pendiente reciente no se toca", async () => {
    await createOrder();
    const expired = await expireStalePendingOrders(ctx.db, {
      now: new Date(Date.now() + 1 * HOURS),
      ttlHours: 48,
    });

    expect(expired).toBe(0);
    expect(await stock()).toBe(7);
  });

  it("un pedido confirmado nunca vence, aunque sea viejo", async () => {
    const order = await createOrder();
    await call(ctx, "POST", `/api/v1/stores/${storeId}/orders/${order.id}/confirm`, ownerToken);
    const expired = await expireStalePendingOrders(ctx.db, {
      now: new Date(Date.now() + 500 * HOURS),
      ttlHours: 48,
    });
    const [row] = await ctx.db.select().from(orders).where(eq(orders.id, order.id));

    expect(expired).toBe(0);
    expect(row?.status).toBe("confirmed");
  });

  it("la expiración queda auditada", async () => {
    const order = await createOrder();
    await expireStalePendingOrders(ctx.db, {
      now: new Date(Date.now() + 49 * HOURS),
      ttlHours: 48,
    });
    const res = await call(ctx, "GET", `/api/v1/stores/${storeId}/audit`, ownerToken);
    const actions = res.json<{ items: { action: string; entityId: string }[] }>().items;

    expect(actions.some((a) => a.action === "order.expired" && a.entityId === order.id)).toBe(true);
  });

  it("la expiración no se repite sobre un pedido ya cancelado", async () => {
    await createOrder();
    const now = new Date(Date.now() + 49 * HOURS);
    await expireStalePendingOrders(ctx.db, { now, ttlHours: 48 });
    const again = await expireStalePendingOrders(ctx.db, { now, ttlHours: 48 });

    expect(again).toBe(0);
    expect(await stock()).toBe(10);
  });

  it("borra claves de idempotencia vencidas y conserva las recientes", async () => {
    await createOrder("clave-vieja");
    await createOrder("clave-nueva");
    await ctx.db
      .update(idempotencyKeys)
      .set({ createdAt: new Date(Date.now() - 48 * HOURS) })
      .where(eq(idempotencyKeys.key, "clave-vieja"));

    const deleted = await cleanupIdempotencyKeys(ctx.db, { now: new Date(), retentionHours: 24 });
    const remaining = await ctx.db.select().from(idempotencyKeys);

    expect(deleted).toBe(1);
    expect(remaining.map((r) => r.key)).toEqual(["clave-nueva"]);
  });

  it("tras borrar la clave, reintentar con la misma clave crea un pedido nuevo", async () => {
    await createOrder("reutilizable");
    await ctx.db
      .update(idempotencyKeys)
      .set({ createdAt: new Date(Date.now() - 48 * HOURS) })
      .where(eq(idempotencyKeys.key, "reutilizable"));
    await cleanupIdempotencyKeys(ctx.db, { now: new Date(), retentionHours: 24 });

    const second = await createOrder("reutilizable");
    expect(second.id).toBeTruthy();
  });
});
