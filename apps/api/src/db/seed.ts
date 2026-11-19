import { eq } from "drizzle-orm";
import { hashPassword } from "../auth/password.js";
import { DEFAULT_ROLES, OWNER_ROLE_NAME } from "../domain/permissions.js";
import type { Db } from "./client.js";
import {
  categories,
  currencies,
  products,
  stockMovements,
  storeMembers,
  storeRoles,
  stores,
  users,
} from "./schema/index.js";

export type SeedInput = {
  platformAdminEmail: string;
  platformAdminPassword: string;
};

const DEMO_STORE_SLUG = "casa-roble";
const DEMO_OWNER_EMAIL = "lucia@casa-roble.example";
const DEMO_OWNER_PASSWORD = "demo-owner-123";

const CURRENCIES = [
  { code: "ARS", name: "Peso argentino", minorUnit: 2 },
  { code: "USD", name: "Dólar estadounidense", minorUnit: 2 },
  { code: "EUR", name: "Euro", minorUnit: 2 },
  { code: "BRL", name: "Real brasileño", minorUnit: 2 },
  { code: "UYU", name: "Peso uruguayo", minorUnit: 2 },
];

// Idempotente: se puede correr varias veces sin duplicar datos.
export async function seed(db: Db, input: SeedInput) {
  await db.insert(currencies).values(CURRENCIES).onConflictDoNothing();

  await seedPlatformAdmin(db, input);
  await seedDemoStore(db);
}

async function seedPlatformAdmin(db: Db, input: SeedInput) {
  const existing = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.email, input.platformAdminEmail))
    .limit(1);
  if (existing.length > 0) return;

  await db.insert(users).values({
    email: input.platformAdminEmail,
    fullName: "Administrador general",
    passwordHash: await hashPassword(input.platformAdminPassword),
    platformRole: "platform_admin",
  });
}

async function seedDemoStore(db: Db) {
  const existing = await db
    .select({ id: stores.id })
    .from(stores)
    .where(eq(stores.slug, DEMO_STORE_SLUG))
    .limit(1);
  if (existing.length > 0) return;

  await db.transaction(async (tx) => {
    const [store] = await tx
      .insert(stores)
      .values({ slug: DEMO_STORE_SLUG, name: "Casa Roble", currencyCode: "ARS", status: "active" })
      .returning();
    if (!store) throw new Error("No se creó la tienda demo");

    const roles = await tx
      .insert(storeRoles)
      .values(
        DEFAULT_ROLES.map((role) => ({
          storeId: store.id,
          name: role.name,
          permissions: [...role.permissions],
          isSystem: role.name === OWNER_ROLE_NAME,
        })),
      )
      .returning();
    const ownerRole = roles.find((r) => r.name === OWNER_ROLE_NAME);
    if (!ownerRole) throw new Error("No se creó el rol propietario");

    const [owner] = await tx
      .insert(users)
      .values({
        email: DEMO_OWNER_EMAIL,
        fullName: "Lucía Roble",
        passwordHash: await hashPassword(DEMO_OWNER_PASSWORD),
      })
      .returning();
    if (!owner) throw new Error("No se creó el propietario demo");

    await tx.insert(storeMembers).values({
      storeId: store.id,
      userId: owner.id,
      roleId: ownerRole.id,
      isOwner: true,
    });

    const [cocina] = await tx
      .insert(categories)
      .values({ storeId: store.id, name: "Cocina", slug: "cocina" })
      .returning();
    if (!cocina) throw new Error("No se creó la categoría demo");

    const catalogo = [
      { sku: "TAZ-001", name: "Taza de cerámica artesanal", priceMinor: 450000, stock: 12 },
      { sku: "PLT-002", name: "Plato playo de barro", priceMinor: 680000, stock: 6 },
    ];

    for (const item of catalogo) {
      const [product] = await tx
        .insert(products)
        .values({
          storeId: store.id,
          categoryId: cocina.id,
          sku: item.sku,
          name: item.name,
          priceMinor: item.priceMinor,
          stockOnHand: item.stock,
        })
        .returning();
      if (!product) throw new Error("No se creó el producto demo");

      // El stock inicial queda registrado en el ledger para cumplir el invariante.
      await tx.insert(stockMovements).values({
        storeId: store.id,
        productId: product.id,
        type: "purchase",
        quantityDelta: item.stock,
        reason: "Stock inicial",
        createdByUserId: owner.id,
      });
    }
  });
}
