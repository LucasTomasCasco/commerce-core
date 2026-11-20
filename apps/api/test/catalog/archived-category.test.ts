import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildTestApp } from "../support/app.js";
import { call, type Ctx } from "../support/api.js";
import { resetDb } from "../support/db.js";
import { seedCurrencies } from "../support/fixtures.js";
import { createPlatformAdminSession, onboardStore } from "../support/onboarding.js";

type Item = { id: string; sku: string };

describe("storefront y categorías archivadas", () => {
  let ctx: Ctx;
  let storeId: string;
  let ownerToken: string;
  let categoryId: string;
  let inCategory: string;

  beforeEach(async () => {
    ctx = await buildTestApp();
    await resetDb(ctx.db);
    await seedCurrencies(ctx.db);
    const onboarded = await onboardStore(ctx, {
      adminToken: await createPlatformAdminSession(ctx),
      slug: "tienda-archivo",
      ownerEmail: "owner@archivo.example",
    });
    storeId = onboarded.store.id;
    ownerToken = onboarded.ownerToken;
    const cat = await call(ctx, "POST", `/api/v1/stores/${storeId}/categories`, ownerToken, {
      name: "Temporada",
      slug: "temporada",
    });
    categoryId = cat.json<{ id: string }>().id;
    inCategory = (
      await call(ctx, "POST", `/api/v1/stores/${storeId}/products`, ownerToken, {
        sku: "EN-CAT",
        name: "Con categoría",
        priceMinor: 100,
        categoryId,
      })
    ).json<{ id: string }>().id;
    await call(ctx, "POST", `/api/v1/stores/${storeId}/products`, ownerToken, {
      sku: "SIN-CAT",
      name: "Sin categoría",
      priceMinor: 100,
    });
  });

  afterEach(async () => {
    await ctx.close();
  });

  const publicList = async () => {
    const res = await ctx.app.inject({
      method: "GET",
      url: "/api/v1/public/stores/tienda-archivo/products",
    });
    return res.json<{ items: Item[] }>().items.map((i) => i.sku);
  };

  it("mientras la categoría está activa sus productos son visibles", async () => {
    expect(await publicList()).toEqual(expect.arrayContaining(["EN-CAT", "SIN-CAT"]));
  });

  it("al archivar la categoría, sus productos desaparecen del storefront y el sin categoría sigue", async () => {
    await call(ctx, "DELETE", `/api/v1/stores/${storeId}/categories/${categoryId}`, ownerToken);
    const skus = await publicList();

    expect(skus).not.toContain("EN-CAT");
    expect(skus).toContain("SIN-CAT");
  });

  it("el detalle público de un producto de categoría archivada responde 404", async () => {
    await call(ctx, "DELETE", `/api/v1/stores/${storeId}/categories/${categoryId}`, ownerToken);
    const res = await ctx.app.inject({
      method: "GET",
      url: `/api/v1/public/stores/tienda-archivo/products/${inCategory}`,
    });

    expect(res.statusCode).toBe(404);
  });

  it("el producto sigue existiendo para el staff aunque su categoría esté archivada", async () => {
    await call(ctx, "DELETE", `/api/v1/stores/${storeId}/categories/${categoryId}`, ownerToken);
    const res = await call(
      ctx,
      "GET",
      `/api/v1/stores/${storeId}/products/${inCategory}`,
      ownerToken,
    );

    expect(res.statusCode).toBe(200);
  });

  it("el storefront filtra por búsqueda y ya no muestra productos de categorías archivadas", async () => {
    await call(ctx, "DELETE", `/api/v1/stores/${storeId}/categories/${categoryId}`, ownerToken);
    const res = await ctx.app.inject({
      method: "GET",
      url: "/api/v1/public/stores/tienda-archivo/products?q=categor",
    });
    const skus = res.json<{ items: Item[] }>().items.map((i) => i.sku);

    expect(skus).toEqual(["SIN-CAT"]);
  });
});

describe("paginación y límites de listados", () => {
  let ctx: Ctx;

  beforeEach(async () => {
    ctx = await buildTestApp();
    await resetDb(ctx.db);
  });

  afterEach(async () => {
    await ctx.close();
  });

  it("rechaza un límite mayor a 100", async () => {
    const res = await ctx.app.inject({
      method: "GET",
      url: "/api/v1/public/stores/x/products?limit=101",
    });
    expect(res.statusCode).toBe(400);
  });

  it("rechaza un offset negativo", async () => {
    const res = await ctx.app.inject({
      method: "GET",
      url: "/api/v1/public/stores/x/products?offset=-1",
    });
    expect(res.statusCode).toBe(400);
  });

  it("un slug de tienda inexistente responde 404 sin revelar nada", async () => {
    const res = await ctx.app.inject({
      method: "GET",
      url: "/api/v1/public/stores/no-existe/products",
    });
    expect(res.statusCode).toBe(404);
    expect(res.json()).toMatchObject({ code: "STORE_NOT_FOUND" });
  });
});
