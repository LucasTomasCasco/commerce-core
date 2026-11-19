import { and, eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { auditLogs, products, storeRoles } from "../../src/db/schema/index.js";
import { buildTestApp } from "../support/app.js";
import { resetDb } from "../support/db.js";
import { addMember, createLoginUser, seedCurrencies } from "../support/fixtures.js";
import {
  createPlatformAdminSession,
  onboardStore,
  PASSWORD,
  type TestContext,
} from "../support/onboarding.js";

type Product = {
  id: string;
  sku: string;
  name: string;
  priceMinor: number;
  active: boolean;
  archivedAt: string | null;
  stockOnHand: number;
};
type Category = { id: string; slug: string; archivedAt: string | null };

describe("catálogo", () => {
  let ctx: TestContext;
  let storeId: string;
  let ownerToken: string;
  let depositoToken: string;

  beforeEach(async () => {
    ctx = await buildTestApp();
    await resetDb(ctx.db);
    await seedCurrencies(ctx.db);
    const adminToken = await createPlatformAdminSession(ctx);
    const onboarded = await onboardStore(ctx, {
      adminToken,
      slug: "casa-catalogo",
      ownerEmail: "owner@catalogo.example",
    });
    storeId = onboarded.store.id;
    ownerToken = onboarded.ownerToken;

    // Staff con rol Depósito (sembrado por defecto): puede leer productos y ajustar stock, no administrar catálogo.
    const [deposito] = await ctx.db
      .select()
      .from(storeRoles)
      .where(and(eq(storeRoles.storeId, storeId), eq(storeRoles.name, "Depósito")));
    if (!deposito) throw new Error("La tienda no tiene el rol Depósito");
    const staff = await createLoginUser(ctx.db, "deposito@catalogo.example", PASSWORD);
    await addMember(ctx.db, { storeId, userId: staff.id, roleId: deposito.id });
    depositoToken = (await ctx.app.services.auth.login("deposito@catalogo.example", PASSWORD))
      .token;
  });

  afterEach(async () => {
    await ctx.close();
  });

  function api(
    method: "GET" | "POST" | "PATCH" | "DELETE",
    url: string,
    token: string | null,
    payload?: unknown,
  ) {
    return ctx.app.inject({
      method,
      url,
      ...(token ? { cookies: { cc_session: token } } : {}),
      ...(payload !== undefined ? { payload: payload as Record<string, unknown> } : {}),
    });
  }

  const storePath = () => `/api/v1/stores/${storeId}`;

  async function createCategory(slug: string) {
    const res = await api("POST", `${storePath()}/categories`, ownerToken, { name: slug, slug });
    return res.json<Category>();
  }

  async function createProduct(input: Record<string, unknown>) {
    const res = await api("POST", `${storePath()}/products`, ownerToken, {
      sku: "SKU-1",
      name: "Producto",
      priceMinor: 1000,
      ...input,
    });
    return { res, product: res.json<Product>() };
  }

  it("crea categorías y rechaza slugs repetidos", async () => {
    await createCategory("cocina");
    const repeated = await api("POST", `${storePath()}/categories`, ownerToken, {
      name: "Otra",
      slug: "cocina",
    });

    expect(repeated.statusCode).toBe(409);
    expect(repeated.json()).toMatchObject({ code: "CATEGORY_SLUG_TAKEN" });
  });

  it("crea productos con categoría y rechaza SKU repetido", async () => {
    const category = await createCategory("cocina");
    const { res } = await createProduct({ sku: "TAZ-1", categoryId: category.id });
    const repeated = await createProduct({ sku: "TAZ-1" });

    expect(res.statusCode).toBe(201);
    expect(res.json()).toMatchObject({ sku: "TAZ-1", categoryId: category.id, stockOnHand: 0 });
    expect(repeated.res.statusCode).toBe(409);
    expect(repeated.res.json()).toMatchObject({ code: "SKU_TAKEN" });
  });

  it("no acepta categorías inexistentes ni archivadas", async () => {
    const category = await createCategory("vieja");
    await api("DELETE", `${storePath()}/categories/${category.id}`, ownerToken);

    const archived = await createProduct({ sku: "A-1", categoryId: category.id });
    const missing = await createProduct({
      sku: "A-2",
      categoryId: "00000000-0000-4000-8000-000000000000",
    });

    expect(archived.res.json()).toMatchObject({ code: "CATEGORY_NOT_FOUND" });
    expect(missing.res.json()).toMatchObject({ code: "CATEGORY_NOT_FOUND" });
  });

  it("rechaza precios negativos", async () => {
    const { res } = await createProduct({ sku: "NEG", priceMinor: -1 });

    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ code: "VALIDATION_ERROR" });
  });

  it("la búsqueda trata % y _ como texto literal", async () => {
    await createProduct({ sku: "P-1", name: "Taza al 100%" });
    await createProduct({ sku: "P-2", name: "Taza al 1000" });

    const res = await api("GET", `${storePath()}/products?q=100%25`, ownerToken);

    expect(res.json<{ items: Product[] }>().items.map((p) => p.sku)).toEqual(["P-1"]);
  });

  it("filtra por categoría y estado activo", async () => {
    const category = await createCategory("cocina");
    await createProduct({ sku: "C-1", categoryId: category.id });
    const { product: inactive } = await createProduct({ sku: "C-2" });
    await api("PATCH", `${storePath()}/products/${inactive.id}`, ownerToken, { active: false });

    const byCategory = await api(
      "GET",
      `${storePath()}/products?categoryId=${category.id}`,
      ownerToken,
    );
    const onlyInactive = await api("GET", `${storePath()}/products?active=false`, ownerToken);

    expect(byCategory.json<{ items: Product[] }>().items.map((p) => p.sku)).toEqual(["C-1"]);
    expect(onlyInactive.json<{ items: Product[] }>().items.map((p) => p.sku)).toEqual(["C-2"]);
  });

  it("archivar un producto lo oculta del listado pero conserva su historial", async () => {
    const { product } = await createProduct({ sku: "ARC-1" });

    const archived = await api("DELETE", `${storePath()}/products/${product.id}`, ownerToken);
    const list = await api("GET", `${storePath()}/products`, ownerToken);
    const detail = await api("GET", `${storePath()}/products/${product.id}`, ownerToken);
    const edit = await api("PATCH", `${storePath()}/products/${product.id}`, ownerToken, {
      name: "Nuevo",
    });

    expect(archived.statusCode).toBe(204);
    expect(list.json<{ items: Product[] }>().items).toEqual([]);
    expect(detail.json<Product>().archivedAt).not.toBeNull();
    expect(edit.statusCode).toBe(409);
    expect(edit.json()).toMatchObject({ code: "PRODUCT_ARCHIVED" });
  });

  it("archivar una categoría la oculta, pero se puede listar incluyendo archivadas", async () => {
    const category = await createCategory("temporada");
    await api("DELETE", `${storePath()}/categories/${category.id}`, ownerToken);

    const visible = await api("GET", `${storePath()}/categories`, ownerToken);
    const all = await api("GET", `${storePath()}/categories?includeArchived=true`, ownerToken);

    expect(visible.json<{ categories: Category[] }>().categories).toEqual([]);
    expect(all.json<{ categories: Category[] }>().categories).toHaveLength(1);
  });

  it("un miembro de depósito puede leer productos pero no crearlos", async () => {
    await createProduct({ sku: "DEP-1" });

    const read = await api("GET", `${storePath()}/products`, depositoToken);
    const create = await api("POST", `${storePath()}/products`, depositoToken, {
      sku: "DEP-2",
      name: "No",
      priceMinor: 1,
    });

    expect(read.statusCode).toBe(200);
    expect(create.statusCode).toBe(403);
  });

  it("una tienda ajena no ve ni modifica los productos", async () => {
    const { product } = await createProduct({ sku: "PRIV-1" });
    const adminToken = await createPlatformAdminSession(ctx);
    const otherStore = await onboardStore(ctx, {
      adminToken,
      slug: "otra-tienda",
      ownerEmail: "otro@catalogo.example",
    });

    const read = await api(
      "GET",
      `/api/v1/stores/${otherStore.store.id}/products/${product.id}`,
      otherStore.ownerToken,
    );
    const edit = await api(
      "PATCH",
      `${storePath()}/products/${product.id}`,
      otherStore.ownerToken,
      { name: "Hack" },
    );

    expect(read.statusCode).toBe(404);
    expect(edit.statusCode).toBe(404);
  });

  it("registra auditoría al crear y editar productos", async () => {
    const { product } = await createProduct({ sku: "AUD-1" });
    await api("PATCH", `${storePath()}/products/${product.id}`, ownerToken, { priceMinor: 2500 });
    const [row] = await ctx.db.select().from(products).where(eq(products.id, product.id));

    expect(row?.priceMinor).toBe(2500);
    const entries = await ctx.db.select().from(auditLogs).where(eq(auditLogs.entityId, product.id));
    expect(entries.map((e) => e.action)).toEqual(
      expect.arrayContaining(["product.created", "product.updated"]),
    );
  });

  describe("storefront público", () => {
    it("muestra solo productos activos y no archivados, con disponibilidad y sin cantidad exacta", async () => {
      await createProduct({ sku: "VIS-1", name: "Visible", priceMinor: 450000 });
      const { product: oculto } = await createProduct({ sku: "OCU-1", name: "Oculto" });
      await api("PATCH", `${storePath()}/products/${oculto.id}`, ownerToken, { active: false });
      await ctx.db.update(products).set({ stockOnHand: 3 }).where(eq(products.sku, "VIS-1"));

      const res = await ctx.app.inject({
        method: "GET",
        url: "/api/v1/public/stores/casa-catalogo/products",
      });
      const items = res.json<{ items: Record<string, unknown>[]; total: number }>().items;

      expect(res.statusCode).toBe(200);
      expect(items).toHaveLength(1);
      expect(items[0]).toMatchObject({
        sku: "VIS-1",
        priceMinor: 450000,
        currencyCode: "ARS",
        inStock: true,
      });
      expect(items[0]).not.toHaveProperty("stockOnHand");
    });

    it("una tienda suspendida no tiene storefront", async () => {
      const { store } = await onboardStore(ctx, {
        adminToken: await createPlatformAdminSession(ctx),
        slug: "tienda-pausada",
        ownerEmail: "pausada@catalogo.example",
      });
      await ctx.db
        .update((await import("../../src/db/schema/index.js")).stores)
        .set({ status: "suspended" })
        .where(eq((await import("../../src/db/schema/index.js")).stores.id, store.id));

      const res = await ctx.app.inject({
        method: "GET",
        url: "/api/v1/public/stores/tienda-pausada/products",
      });

      expect(res.statusCode).toBe(404);
      expect(res.json()).toMatchObject({ code: "STORE_NOT_FOUND" });
    });

    it("el detalle público de un producto archivado responde 404", async () => {
      const { product } = await createProduct({ sku: "GONE-1" });
      await api("DELETE", `${storePath()}/products/${product.id}`, ownerToken);

      const res = await ctx.app.inject({
        method: "GET",
        url: `/api/v1/public/stores/casa-catalogo/products/${product.id}`,
      });

      expect(res.statusCode).toBe(404);
      expect(res.json()).toMatchObject({ code: "PRODUCT_NOT_FOUND" });
    });

    it("lista categorías visibles de la tienda", async () => {
      await createCategory("cocina");
      const archived = await createCategory("oculta");
      await api("DELETE", `${storePath()}/categories/${archived.id}`, ownerToken);

      const res = await ctx.app.inject({
        method: "GET",
        url: "/api/v1/public/stores/casa-catalogo/categories",
      });

      expect(res.json<{ categories: { slug: string }[] }>().categories.map((c) => c.slug)).toEqual([
        "cocina",
      ]);
    });
  });
});
