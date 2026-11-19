import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { products, storeRoles } from "../../src/db/schema/index.js";
import { buildTestApp } from "../support/app.js";
import { resetDb } from "../support/db.js";
import { ledgerMismatches } from "../support/ledger.js";
import { addMember, createLoginUser, seedCurrencies } from "../support/fixtures.js";
import {
  createPlatformAdminSession,
  onboardStore,
  PASSWORD,
  type TestContext,
} from "../support/onboarding.js";

type Movement = { type: string; quantityDelta: number };

describe("stock y ledger", () => {
  let ctx: TestContext;
  let storeId: string;
  let ownerToken: string;
  let productId: string;

  beforeEach(async () => {
    ctx = await buildTestApp();
    await resetDb(ctx.db);
    await seedCurrencies(ctx.db);
    const onboarded = await onboardStore(ctx, {
      adminToken: await createPlatformAdminSession(ctx),
      slug: "casa-stock",
      ownerEmail: "owner@stock.example",
    });
    storeId = onboarded.store.id;
    ownerToken = onboarded.ownerToken;

    const created = await api("POST", "/products", ownerToken, {
      sku: "STK-1",
      name: "Taza",
      priceMinor: 1000,
    });
    productId = created.json<{ id: string }>().id;
  });

  afterEach(async () => {
    await ctx.close();
  });

  function api(method: "GET" | "POST", url: string, token: string, payload?: unknown) {
    return ctx.app.inject({
      method,
      url: `/api/v1/stores/${storeId}${url}`,
      cookies: { cc_session: token },
      ...(payload !== undefined ? { payload: payload as Record<string, unknown> } : {}),
    });
  }

  async function stockOf(id: string): Promise<number> {
    const [row] = await ctx.db.select().from(products).where(eq(products.id, id));
    return row?.stockOnHand ?? -1;
  }

  it("una entrada suma stock, registra el movimiento y mantiene el ledger", async () => {
    const res = await api("POST", "/stock-movements", ownerToken, {
      productId,
      type: "purchase",
      quantityDelta: 7,
    });

    expect(res.statusCode).toBe(201);
    expect(res.json()).toMatchObject({
      stockOnHand: 7,
      movement: { type: "purchase", quantityDelta: 7 },
    });
    expect(await ledgerMismatches(ctx.db, storeId)).toEqual([]);
  });

  it("un ajuste exige motivo y puede restar sin dejar stock negativo", async () => {
    await api("POST", "/stock-movements", ownerToken, {
      productId,
      type: "purchase",
      quantityDelta: 3,
    });

    const withoutReason = await api("POST", "/stock-movements", ownerToken, {
      productId,
      type: "adjustment",
      quantityDelta: -1,
    });
    const tooMuch = await api("POST", "/stock-movements", ownerToken, {
      productId,
      type: "adjustment",
      quantityDelta: -10,
      reason: "Rotura",
    });
    const valid = await api("POST", "/stock-movements", ownerToken, {
      productId,
      type: "adjustment",
      quantityDelta: -2,
      reason: "Rotura de una taza",
    });

    expect(withoutReason.json()).toMatchObject({ code: "INVALID_MOVEMENT" });
    expect(tooMuch.statusCode).toBe(409);
    expect(tooMuch.json()).toMatchObject({ code: "INSUFFICIENT_STOCK" });
    expect(valid.statusCode).toBe(201);
    expect(await stockOf(productId)).toBe(1);
    expect(await ledgerMismatches(ctx.db, storeId)).toEqual([]);
  });

  it("una entrada no puede restar stock", async () => {
    const res = await api("POST", "/stock-movements", ownerToken, {
      productId,
      type: "purchase",
      quantityDelta: -2,
    });

    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ code: "INVALID_MOVEMENT" });
  });

  it("lista los movimientos de un producto", async () => {
    await api("POST", "/stock-movements", ownerToken, {
      productId,
      type: "purchase",
      quantityDelta: 4,
    });

    const res = await api("GET", `/stock-movements?productId=${productId}`, ownerToken);

    expect(res.json<{ items: Movement[] }>().items.map((m) => m.quantityDelta)).toEqual([4]);
  });

  it("un miembro con Vendedor no puede ajustar stock", async () => {
    const [vendedor] = await ctx.db
      .select()
      .from(storeRoles)
      .where(eq(storeRoles.name, "Vendedor"))
      .limit(1);
    const staff = await createLoginUser(ctx.db, "vendedor@stock.example", PASSWORD);
    await addMember(ctx.db, { storeId, userId: staff.id, roleId: vendedor?.id ?? "" });
    const { token } = await ctx.app.services.auth.login("vendedor@stock.example", PASSWORD);

    const res = await api("POST", "/stock-movements", token, {
      productId,
      type: "purchase",
      quantityDelta: 5,
    });

    expect(res.statusCode).toBe(403);
  });
});
