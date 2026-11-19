import {
  categories,
  currencies,
  orders,
  products,
  storeMembers,
  storeRoles,
  stores,
  users,
} from "../../src/db/schema/index.js";
import type { Db } from "../../src/db/client.js";

export async function seedCurrencies(db: Db) {
  await db.insert(currencies).values([
    { code: "ARS", name: "Peso argentino", minorUnit: 2 },
    { code: "USD", name: "Dólar estadounidense", minorUnit: 2 },
  ]);
}

export async function createStore(db: Db, slug: string) {
  const [store] = await db
    .insert(stores)
    .values({ slug, name: `Tienda ${slug}`, currencyCode: "ARS", status: "active" })
    .returning();
  if (!store) throw new Error("No se creó la tienda de prueba");
  return store;
}

export async function createUser(db: Db, email: string) {
  const [user] = await db.insert(users).values({ email, fullName: email }).returning();
  if (!user) throw new Error("No se creó el usuario de prueba");
  return user;
}

export async function createRole(db: Db, storeId: string, name: string, permissions: string[]) {
  const [role] = await db.insert(storeRoles).values({ storeId, name, permissions }).returning();
  if (!role) throw new Error("No se creó el rol de prueba");
  return role;
}

export async function addMember(
  db: Db,
  input: { storeId: string; userId: string; roleId: string; isOwner?: boolean },
) {
  const [member] = await db
    .insert(storeMembers)
    .values({
      storeId: input.storeId,
      userId: input.userId,
      roleId: input.roleId,
      isOwner: input.isOwner ?? false,
    })
    .returning();
  if (!member) throw new Error("No se creó la membresía de prueba");
  return member;
}

export async function createCategory(db: Db, storeId: string, slug: string) {
  const [category] = await db.insert(categories).values({ storeId, name: slug, slug }).returning();
  if (!category) throw new Error("No se creó la categoría de prueba");
  return category;
}

export async function createProduct(
  db: Db,
  input: {
    storeId: string;
    sku: string;
    categoryId?: string | null;
    priceMinor?: number;
    stockOnHand?: number;
  },
) {
  const [product] = await db
    .insert(products)
    .values({
      storeId: input.storeId,
      sku: input.sku,
      name: input.sku,
      categoryId: input.categoryId ?? null,
      priceMinor: input.priceMinor ?? 1000,
      stockOnHand: input.stockOnHand ?? 0,
    })
    .returning();
  if (!product) throw new Error("No se creó el producto de prueba");
  return product;
}

export async function createOrder(
  db: Db,
  input: { storeId: string; createdByUserId: string; code?: string; totalMinor?: number },
) {
  const [order] = await db
    .insert(orders)
    .values({
      storeId: input.storeId,
      code: input.code ?? "ORD-000001",
      customerName: "Cliente de prueba",
      customerPhone: "+54 11 5555-0000",
      currencyCode: "ARS",
      totalMinor: input.totalMinor ?? 2000,
      createdByUserId: input.createdByUserId,
    })
    .returning();
  if (!order) throw new Error("No se creó el pedido de prueba");
  return order;
}
