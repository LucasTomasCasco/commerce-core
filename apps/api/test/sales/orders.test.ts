import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { products } from "../../src/db/schema/index.js";
import { buildTestApp } from "../support/app.js";
import { resetDb } from "../support/db.js";
import { ledgerMismatches } from "../support/ledger.js";
import { createLoginUser, seedCurrencies, addMember } from "../support/fixtures.js";
import {
  createPlatformAdminSession,
  onboardStore,
  PASSWORD,
  type TestContext,
} from "../support/onboarding.js";
import { storeRoles } from "../../src/db/schema/index.js";

type Order = {
  id: string;
  code: string;
  status: string;
  totalMinor: number;
  items: { productId: string; quantity: number; nameSnapshot: string; unitPriceMinor: number }[];
};

describe("pedidos", () => {
  let ctx: TestContext;
  let storeId: string;
  let ownerToken: string;
  let taza: string;
  let plato: string;

  beforeEach(async () => {
    ctx = await buildTestApp();
    await resetDb(ctx.db);
    await seedCurrencies(ctx.db);
    const onboarded = await onboardStore(ctx, {
      adminToken: await createPlatformAdminSession(ctx),
      slug: "casa-pedidos",
      ownerEmail: "owner@pedidos.example",
    });
    storeId = onboarded.store.id;
    ownerToken = onboarded.ownerToken;

    taza = await createProduct("TAZ-1", "Taza", 450000, 5);
    plato = await createProduct("PLT-1", "Plato", 250000, 2);
  });

  afterEach(async () => {
    await ctx.close();
  });

  function api(
    method: "GET" | "POST" | "DELETE",
    url: string,
    token: string,
    payload?: unknown,
    headers?: Record<string, string>,
  ) {
    return ctx.app.inject({
      method,
      url: `/api/v1/stores/${storeId}${url}`,
      cookies: { cc_session: token },
      ...(headers ? { headers } : {}),
      ...(payload !== undefined ? { payload: payload as Record<string, unknown> } : {}),
    });
  }

  async function createProduct(sku: string, name: string, priceMinor: number, stock: number) {
    const created = await api("POST", "/products", ownerToken, { sku, name, priceMinor });
    const id = created.json<{ id: string }>().id;
    await api("POST", "/stock-movements", ownerToken, {
      productId: id,
      type: "purchase",
      quantityDelta: stock,
    });
    return id;
  }

  async function stockOf(id: string): Promise<number> {
    const [row] = await ctx.db.select().from(products).where(eq(products.id, id));
    return row?.stockOnHand ?? -1;
  }

  function orderBody(
    items: { productId: string; quantity: number }[],
    extra: Record<string, unknown> = {},
  ) {
    return {
      customerName: "María Pérez",
      customerPhone: "+54 11 5555-1234",
      note: "Entregar por la tarde",
      items,
      ...extra,
    };
  }

  it("crea un pedido con snapshots, total y descuento de stock", async () => {
    const res = await api(
      "POST",
      "/orders",
      ownerToken,
      orderBody([
        { productId: taza, quantity: 2 },
        { productId: plato, quantity: 1 },
      ]),
    );
    const order = res.json<Order>();

    expect(res.statusCode).toBe(201);
    expect(order).toMatchObject({ code: "ORD-000001", status: "pending", totalMinor: 1150000 });
    expect(order.items.map((i) => i.nameSnapshot).sort()).toEqual(["Plato", "Taza"]);
    expect(await stockOf(taza)).toBe(3);
    expect(await stockOf(plato)).toBe(1);
    expect(await ledgerMismatches(ctx.db, storeId)).toEqual([]);
  });

  it("numera los pedidos por tienda de forma consecutiva", async () => {
    await api("POST", "/orders", ownerToken, orderBody([{ productId: taza, quantity: 1 }]));
    const second = await api(
      "POST",
      "/orders",
      ownerToken,
      orderBody([{ productId: taza, quantity: 1 }]),
    );

    expect(second.json<Order>().code).toBe("ORD-000002");
  });

  it("rechaza sobreventa sin crear pedido, sin consumir número ni tocar stock", async () => {
    const res = await api(
      "POST",
      "/orders",
      ownerToken,
      orderBody([{ productId: plato, quantity: 3 }]),
    );
    const next = await api(
      "POST",
      "/orders",
      ownerToken,
      orderBody([{ productId: taza, quantity: 1 }]),
    );

    expect(res.statusCode).toBe(409);
    expect(res.json()).toMatchObject({ code: "INSUFFICIENT_STOCK" });
    expect(await stockOf(plato)).toBe(2);
    expect(next.json<Order>().code).toBe("ORD-000001");
  });

  it("no vende productos archivados", async () => {
    await api("DELETE", `/products/${plato}`, ownerToken);

    const res = await api(
      "POST",
      "/orders",
      ownerToken,
      orderBody([{ productId: plato, quantity: 1 }]),
    );

    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ code: "PRODUCT_UNAVAILABLE" });
  });

  it("con la misma Idempotency-Key un reintento devuelve el mismo pedido sin descontar dos veces", async () => {
    const headers = { "idempotency-key": "pedido-123" };
    const first = await api(
      "POST",
      "/orders",
      ownerToken,
      orderBody([{ productId: taza, quantity: 2 }]),
      headers,
    );
    const retry = await api(
      "POST",
      "/orders",
      ownerToken,
      orderBody([{ productId: taza, quantity: 2 }]),
      headers,
    );

    expect(first.statusCode).toBe(201);
    expect(retry.statusCode).toBe(201);
    expect(retry.json<Order>().id).toBe(first.json<Order>().id);
    expect(await stockOf(taza)).toBe(3);
  });

  it("reusar una Idempotency-Key con otro contenido responde 422", async () => {
    const headers = { "idempotency-key": "pedido-456" };
    await api(
      "POST",
      "/orders",
      ownerToken,
      orderBody([{ productId: taza, quantity: 1 }]),
      headers,
    );

    const different = await api(
      "POST",
      "/orders",
      ownerToken,
      orderBody([{ productId: taza, quantity: 2 }]),
      headers,
    );

    expect(different.statusCode).toBe(422);
    expect(different.json()).toMatchObject({ code: "IDEMPOTENCY_KEY_REUSED" });
  });

  it("avanza pending → confirmed → fulfilled y rechaza saltos", async () => {
    const order = (
      await api("POST", "/orders", ownerToken, orderBody([{ productId: taza, quantity: 1 }]))
    ).json<Order>();

    const skip = await api("POST", `/orders/${order.id}/fulfill`, ownerToken);
    const confirm = await api("POST", `/orders/${order.id}/confirm`, ownerToken);
    const again = await api("POST", `/orders/${order.id}/confirm`, ownerToken);
    const fulfill = await api("POST", `/orders/${order.id}/fulfill`, ownerToken);

    expect(skip.statusCode).toBe(409);
    expect(skip.json()).toMatchObject({ code: "INVALID_TRANSITION" });
    expect(confirm.json<Order>().status).toBe("confirmed");
    expect(again.statusCode).toBe(409);
    expect(fulfill.json<Order>().status).toBe("fulfilled");
  });

  it("cancelar un pedido pendiente o confirmado devuelve el stock", async () => {
    const pending = (
      await api("POST", "/orders", ownerToken, orderBody([{ productId: taza, quantity: 2 }]))
    ).json<Order>();
    const confirmed = (
      await api("POST", "/orders", ownerToken, orderBody([{ productId: taza, quantity: 1 }]))
    ).json<Order>();
    await api("POST", `/orders/${confirmed.id}/confirm`, ownerToken);

    const cancelPending = await api("POST", `/orders/${pending.id}/cancel`, ownerToken);
    const cancelConfirmed = await api("POST", `/orders/${confirmed.id}/cancel`, ownerToken);

    expect(cancelPending.json<Order>().status).toBe("cancelled");
    expect(cancelConfirmed.json<Order>().status).toBe("cancelled");
    expect(await stockOf(taza)).toBe(5);
    expect(await ledgerMismatches(ctx.db, storeId)).toEqual([]);
  });

  it("no se puede cancelar un pedido entregado ni cancelado dos veces", async () => {
    const order = (
      await api("POST", "/orders", ownerToken, orderBody([{ productId: taza, quantity: 1 }]))
    ).json<Order>();
    await api("POST", `/orders/${order.id}/confirm`, ownerToken);
    await api("POST", `/orders/${order.id}/fulfill`, ownerToken);

    const cancelFulfilled = await api("POST", `/orders/${order.id}/cancel`, ownerToken);

    expect(cancelFulfilled.statusCode).toBe(409);
    expect(cancelFulfilled.json()).toMatchObject({ code: "INVALID_TRANSITION" });
    expect(await stockOf(taza)).toBe(4);
  });

  it("con concurrencia nunca se vende más stock del disponible", async () => {
    // 10 pedidos de 1 unidad sobre un producto con 5 en stock.
    const attempts = await Promise.all(
      Array.from({ length: 10 }, () =>
        api("POST", "/orders", ownerToken, orderBody([{ productId: plato, quantity: 1 }])),
      ),
    );
    const accepted = attempts.filter((r) => r.statusCode === 201);
    const rejected = attempts.filter((r) => r.statusCode === 409);

    expect(accepted).toHaveLength(2);
    expect(rejected).toHaveLength(8);
    expect(await stockOf(plato)).toBe(0);
    expect(await ledgerMismatches(ctx.db, storeId)).toEqual([]);
  });

  it("un vendedor crea pedidos pero no puede cancelarlos", async () => {
    const [vendedor] = await ctx.db
      .select()
      .from(storeRoles)
      .where(eq(storeRoles.name, "Vendedor"))
      .limit(1);
    const staff = await createLoginUser(ctx.db, "vendedor@pedidos.example", PASSWORD);
    await addMember(ctx.db, { storeId, userId: staff.id, roleId: vendedor?.id ?? "" });
    const { token } = await ctx.app.services.auth.login("vendedor@pedidos.example", PASSWORD);

    const created = await api(
      "POST",
      "/orders",
      token,
      orderBody([{ productId: taza, quantity: 1 }]),
    );
    const cancelled = await api("POST", `/orders/${created.json<Order>().id}/cancel`, token);

    expect(created.statusCode).toBe(201);
    expect(cancelled.statusCode).toBe(403);
  });

  it("lista pedidos filtrando por estado y no los muestra a otra tienda", async () => {
    await api("POST", "/orders", ownerToken, orderBody([{ productId: taza, quantity: 1 }]));
    const pending = await api("GET", "/orders?status=pending", ownerToken);
    const confirmed = await api("GET", "/orders?status=confirmed", ownerToken);

    const otherToken = (
      await onboardStore(ctx, {
        adminToken: await createPlatformAdminSession(ctx),
        slug: "tienda-vecina",
        ownerEmail: "vecina@pedidos.example",
      })
    ).ownerToken;
    const foreign = await ctx.app.inject({
      method: "GET",
      url: `/api/v1/stores/${storeId}/orders`,
      cookies: { cc_session: otherToken },
    });

    expect(pending.json<{ total: number }>().total).toBe(1);
    expect(confirmed.json<{ total: number }>().total).toBe(0);
    expect(foreign.statusCode).toBe(404);
  });
});
