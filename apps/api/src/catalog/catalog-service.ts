import { and, asc, count, eq, ilike, isNull, or, sql, type SQL } from "drizzle-orm";
import { recordAudit } from "../audit/record.js";
import type { Db, Tx } from "../db/client.js";
import { withDbContext } from "../db/tenant.js";
import { categories, products, stores } from "../db/schema/index.js";
import { AppError } from "../http/errors.js";

export type CatalogServiceDeps = { db: Db };

export type ProductFilters = {
  categoryId?: string | undefined;
  active?: boolean | undefined;
  q?: string | undefined;
  includeArchived?: boolean | undefined;
  limit: number;
  offset: number;
};

// Escapa los comodines de LIKE para que la búsqueda sea literal.
function likePattern(term: string): string {
  return `%${term.replace(/[\\%_]/g, "\\$&")}%`;
}

export function createCatalogService({ db }: CatalogServiceDeps) {
  // ---- Categorías ----

  async function listCategories(input: { storeId: string; includeArchived?: boolean | undefined }) {
    return withDbContext(db, { storeId: input.storeId }, (tx) =>
      tx
        .select()
        .from(categories)
        .where(
          and(
            eq(categories.storeId, input.storeId),
            input.includeArchived ? undefined : isNull(categories.archivedAt),
          ),
        )
        .orderBy(asc(categories.name)),
    );
  }

  async function createCategory(input: {
    storeId: string;
    actorUserId: string;
    name: string;
    slug: string;
  }) {
    return withDbContext(db, { storeId: input.storeId, userId: input.actorUserId }, async (tx) => {
      await assertCategorySlugAvailable(tx, input.storeId, input.slug);
      const [category] = await tx
        .insert(categories)
        .values({ storeId: input.storeId, name: input.name, slug: input.slug })
        .returning();
      if (!category) throw new Error("No se creó la categoría");
      await recordAudit(tx, {
        storeId: input.storeId,
        actorUserId: input.actorUserId,
        action: "category.created",
        entity: "category",
        entityId: category.id,
        metadata: { slug: category.slug },
      });
      return category;
    });
  }

  async function updateCategory(input: {
    storeId: string;
    actorUserId: string;
    categoryId: string;
    name?: string | undefined;
    slug?: string | undefined;
  }) {
    return withDbContext(db, { storeId: input.storeId, userId: input.actorUserId }, async (tx) => {
      const category = await findCategory(tx, input.storeId, input.categoryId);
      if (input.slug !== undefined && input.slug !== category.slug) {
        await assertCategorySlugAvailable(tx, input.storeId, input.slug);
      }
      const [updated] = await tx
        .update(categories)
        .set({
          updatedAt: new Date(),
          ...(input.name !== undefined ? { name: input.name } : {}),
          ...(input.slug !== undefined ? { slug: input.slug } : {}),
        })
        .where(eq(categories.id, category.id))
        .returning();
      if (!updated) throw new Error("No se actualizó la categoría");
      await recordAudit(tx, {
        storeId: input.storeId,
        actorUserId: input.actorUserId,
        action: "category.updated",
        entity: "category",
        entityId: category.id,
      });
      return updated;
    });
  }

  async function archiveCategory(input: {
    storeId: string;
    actorUserId: string;
    categoryId: string;
  }) {
    await withDbContext(db, { storeId: input.storeId, userId: input.actorUserId }, async (tx) => {
      const category = await findCategory(tx, input.storeId, input.categoryId);
      await tx
        .update(categories)
        .set({ archivedAt: new Date(), updatedAt: new Date() })
        .where(eq(categories.id, category.id));
      await recordAudit(tx, {
        storeId: input.storeId,
        actorUserId: input.actorUserId,
        action: "category.archived",
        entity: "category",
        entityId: category.id,
      });
    });
  }

  // ---- Productos ----

  async function listProducts(input: { storeId: string } & ProductFilters) {
    const where = productFilterSql(input);
    const [items, [total]] = await withDbContext(db, { storeId: input.storeId }, (tx) =>
      Promise.all([
        tx
          .select()
          .from(products)
          .where(where)
          .orderBy(asc(products.name))
          .limit(input.limit)
          .offset(input.offset),
        tx.select({ total: count() }).from(products).where(where),
      ]),
    );
    return { items, total: total?.total ?? 0, limit: input.limit, offset: input.offset };
  }

  async function getProduct(input: { storeId: string; productId: string }) {
    return withDbContext(db, { storeId: input.storeId }, (tx) =>
      findProduct(tx, input.storeId, input.productId),
    );
  }

  async function createProduct(input: {
    storeId: string;
    actorUserId: string;
    sku: string;
    name: string;
    description?: string | undefined;
    categoryId?: string | undefined;
    priceMinor: number;
  }) {
    return withDbContext(db, { storeId: input.storeId, userId: input.actorUserId }, async (tx) => {
      await assertSkuAvailable(tx, input.storeId, input.sku);
      if (input.categoryId) await assertCategoryUsable(tx, input.storeId, input.categoryId);
      const [product] = await tx
        .insert(products)
        .values({
          storeId: input.storeId,
          sku: input.sku,
          name: input.name,
          description: input.description ?? null,
          categoryId: input.categoryId ?? null,
          priceMinor: input.priceMinor,
        })
        .returning();
      if (!product) throw new Error("No se creó el producto");
      await recordAudit(tx, {
        storeId: input.storeId,
        actorUserId: input.actorUserId,
        action: "product.created",
        entity: "product",
        entityId: product.id,
        metadata: { sku: product.sku, priceMinor: product.priceMinor },
      });
      return product;
    });
  }

  async function updateProduct(input: {
    storeId: string;
    actorUserId: string;
    productId: string;
    sku?: string | undefined;
    name?: string | undefined;
    description?: string | null | undefined;
    categoryId?: string | null | undefined;
    priceMinor?: number | undefined;
    active?: boolean | undefined;
  }) {
    return withDbContext(db, { storeId: input.storeId, userId: input.actorUserId }, async (tx) => {
      const product = await findProduct(tx, input.storeId, input.productId);
      if (product.archivedAt) {
        throw new AppError(409, "PRODUCT_ARCHIVED", "El producto está archivado");
      }
      if (input.sku !== undefined && input.sku !== product.sku) {
        await assertSkuAvailable(tx, input.storeId, input.sku);
      }
      if (input.categoryId) await assertCategoryUsable(tx, input.storeId, input.categoryId);

      const [updated] = await tx
        .update(products)
        .set({
          updatedAt: new Date(),
          ...(input.sku !== undefined ? { sku: input.sku } : {}),
          ...(input.name !== undefined ? { name: input.name } : {}),
          ...(input.description !== undefined ? { description: input.description } : {}),
          ...(input.categoryId !== undefined ? { categoryId: input.categoryId } : {}),
          ...(input.priceMinor !== undefined ? { priceMinor: input.priceMinor } : {}),
          ...(input.active !== undefined ? { active: input.active } : {}),
        })
        .where(eq(products.id, product.id))
        .returning();
      if (!updated) throw new Error("No se actualizó el producto");
      await recordAudit(tx, {
        storeId: input.storeId,
        actorUserId: input.actorUserId,
        action: "product.updated",
        entity: "product",
        entityId: product.id,
        metadata: { priceMinor: updated.priceMinor, active: updated.active },
      });
      return updated;
    });
  }

  // Archivar oculta el producto de la venta pero conserva pedidos y movimientos que lo referencian.
  async function archiveProduct(input: {
    storeId: string;
    actorUserId: string;
    productId: string;
  }) {
    await withDbContext(db, { storeId: input.storeId, userId: input.actorUserId }, async (tx) => {
      const product = await findProduct(tx, input.storeId, input.productId);
      await tx
        .update(products)
        .set({ archivedAt: new Date(), active: false, updatedAt: new Date() })
        .where(eq(products.id, product.id));
      await recordAudit(tx, {
        storeId: input.storeId,
        actorUserId: input.actorUserId,
        action: "product.archived",
        entity: "product",
        entityId: product.id,
      });
    });
  }

  // ---- Storefront público ----

  async function findPublicStore(slug: string) {
    const [store] = await db
      .select()
      .from(stores)
      .where(and(eq(stores.slug, slug), eq(stores.status, "active")))
      .limit(1);
    if (!store) throw new AppError(404, "STORE_NOT_FOUND", "Tienda no encontrada");
    return store;
  }

  async function listPublicCategories(slug: string) {
    const store = await findPublicStore(slug);
    return withDbContext(db, { storeId: store.id }, (tx) =>
      tx
        .select({ id: categories.id, name: categories.name, slug: categories.slug })
        .from(categories)
        .where(and(eq(categories.storeId, store.id), isNull(categories.archivedAt)))
        .orderBy(asc(categories.name)),
    );
  }

  async function listPublicProducts(
    slug: string,
    filters: Omit<ProductFilters, "active" | "includeArchived">,
  ) {
    const store = await findPublicStore(slug);
    const where = and(
      productFilterSql({
        ...filters,
        storeId: store.id,
        active: true,
        includeArchived: false,
      }),
      visibleInPublicCatalog(store.id),
    );
    const [items, [total]] = await withDbContext(db, { storeId: store.id }, (tx) =>
      Promise.all([
        tx
          .select()
          .from(products)
          .where(where)
          .orderBy(asc(products.name))
          .limit(filters.limit)
          .offset(filters.offset),
        tx.select({ total: count() }).from(products).where(where),
      ]),
    );
    return {
      items: items.map((p) => toPublicProduct(p, store.currencyCode)),
      total: total?.total ?? 0,
      limit: filters.limit,
      offset: filters.offset,
    };
  }

  async function getPublicProduct(slug: string, productId: string) {
    const store = await findPublicStore(slug);
    const product = await withDbContext(db, { storeId: store.id }, async (tx) => {
      const [row] = await tx
        .select()
        .from(products)
        .where(
          and(
            eq(products.storeId, store.id),
            eq(products.id, productId),
            eq(products.active, true),
            isNull(products.archivedAt),
            visibleInPublicCatalog(store.id),
          ),
        )
        .limit(1);
      return row;
    });
    if (!product) throw new AppError(404, "PRODUCT_NOT_FOUND", "Producto no encontrado");
    return toPublicProduct(product, store.currencyCode);
  }

  return {
    listCategories,
    createCategory,
    updateCategory,
    archiveCategory,
    listProducts,
    getProduct,
    createProduct,
    updateProduct,
    archiveProduct,
    findPublicStore,
    listPublicCategories,
    listPublicProducts,
    getPublicProduct,
  };
}

export type CatalogService = ReturnType<typeof createCatalogService>;

function productFilterSql(input: { storeId: string } & Partial<ProductFilters>): SQL | undefined {
  const conditions: (SQL | undefined)[] = [eq(products.storeId, input.storeId)];
  if (input.categoryId) conditions.push(eq(products.categoryId, input.categoryId));
  if (input.active !== undefined) conditions.push(eq(products.active, input.active));
  if (!input.includeArchived) conditions.push(isNull(products.archivedAt));
  if (input.q) {
    const pattern = likePattern(input.q);
    conditions.push(or(ilike(products.name, pattern), ilike(products.sku, pattern)));
  }
  return and(...conditions);
}

// Un producto sin categoría o cuya categoría sigue activa es visible en el storefront.
// Archivar una categoría la oculta junto con sus productos, sin tocar los datos del producto.
function visibleInPublicCatalog(storeId: string): SQL {
  return sql`(${products.categoryId} IS NULL OR ${products.categoryId} IN (
    SELECT ${categories.id} FROM ${categories}
    WHERE ${categories.storeId} = ${storeId} AND ${categories.archivedAt} IS NULL
  ))`;
}

// Público: sin cantidades exactas de stock, solo disponibilidad.
function toPublicProduct(product: typeof products.$inferSelect, currencyCode: string) {
  return {
    id: product.id,
    sku: product.sku,
    name: product.name,
    description: product.description,
    categoryId: product.categoryId,
    priceMinor: product.priceMinor,
    currencyCode,
    inStock: product.stockOnHand > 0,
  };
}

async function findCategory(tx: Tx, storeId: string, categoryId: string) {
  const [category] = await tx
    .select()
    .from(categories)
    .where(and(eq(categories.storeId, storeId), eq(categories.id, categoryId)))
    .limit(1);
  if (!category) throw new AppError(404, "CATEGORY_NOT_FOUND", "Categoría no encontrada");
  return category;
}

async function findProduct(tx: Tx, storeId: string, productId: string) {
  const [product] = await tx
    .select()
    .from(products)
    .where(and(eq(products.storeId, storeId), eq(products.id, productId)))
    .limit(1);
  if (!product) throw new AppError(404, "PRODUCT_NOT_FOUND", "Producto no encontrado");
  return product;
}

async function assertCategoryUsable(tx: Tx, storeId: string, categoryId: string) {
  const [category] = await tx
    .select({ id: categories.id })
    .from(categories)
    .where(
      and(
        eq(categories.storeId, storeId),
        eq(categories.id, categoryId),
        isNull(categories.archivedAt),
      ),
    )
    .limit(1);
  if (!category)
    throw new AppError(400, "CATEGORY_NOT_FOUND", "La categoría no existe o está archivada");
}

async function assertCategorySlugAvailable(tx: Tx, storeId: string, slug: string) {
  const [existing] = await tx
    .select({ id: categories.id })
    .from(categories)
    .where(and(eq(categories.storeId, storeId), eq(categories.slug, slug)))
    .limit(1);
  if (existing)
    throw new AppError(409, "CATEGORY_SLUG_TAKEN", "Ya existe una categoría con ese slug");
}

async function assertSkuAvailable(tx: Tx, storeId: string, sku: string) {
  const [existing] = await tx
    .select({ id: products.id })
    .from(products)
    .where(and(eq(products.storeId, storeId), eq(products.sku, sku)))
    .limit(1);
  if (existing) throw new AppError(409, "SKU_TAKEN", "Ya existe un producto con ese SKU");
}
