import { afterAll, beforeEach, describe, it } from "vitest";
import { orderItems, stockMovements, storeMembers, users } from "../../src/db/schema/index.js";
import { createTestDb, expectDbError, resetDb } from "../support/db.js";
import {
  addMember,
  createCategory,
  createOrder,
  createProduct,
  createRole,
  createStore,
  createUser,
  seedCurrencies,
} from "../support/fixtures.js";

describe("integridad en la base de datos", () => {
  const { client, db } = createTestDb();

  beforeEach(async () => {
    await resetDb(db);
    await seedCurrencies(db);
  });

  afterAll(async () => {
    await client.end();
  });

  it("un producto no puede usar una categoría de otra tienda", async () => {
    const storeA = await createStore(db, "tienda-a");
    const storeB = await createStore(db, "tienda-b");
    const categoryB = await createCategory(db, storeB.id, "tazas");

    await expectDbError(
      createProduct(db, { storeId: storeA.id, sku: "TAZA-1", categoryId: categoryB.id }),
      /products_category_fk/,
    );
  });

  it("un producto sin categoría es válido", async () => {
    const storeA = await createStore(db, "tienda-a");

    const product = await createProduct(db, { storeId: storeA.id, sku: "SIN-CAT" });

    if (product.categoryId !== null) throw new Error("Se esperaba categoryId nulo");
  });

  it("el stock no puede quedar negativo", async () => {
    const storeA = await createStore(db, "tienda-a");

    await expectDbError(
      createProduct(db, { storeId: storeA.id, sku: "NEG", stockOnHand: -1 }),
      /products_stock_non_negative/,
    );
  });

  it("el precio no puede ser negativo", async () => {
    const storeA = await createStore(db, "tienda-a");

    await expectDbError(
      createProduct(db, { storeId: storeA.id, sku: "PRECIO", priceMinor: -5 }),
      /products_price_non_negative/,
    );
  });

  it("el signo del movimiento debe coincidir con su tipo", async () => {
    const storeA = await createStore(db, "tienda-a");
    const ana = await createUser(db, "ana@example.com");
    const product = await createProduct(db, { storeId: storeA.id, sku: "MOV" });

    await expectDbError(
      db.insert(stockMovements).values({
        storeId: storeA.id,
        productId: product.id,
        type: "purchase",
        quantityDelta: -3,
        createdByUserId: ana.id,
      }),
      /stock_movements_sign_matches_type/,
    );
  });

  it("solo puede haber un owner por tienda", async () => {
    const storeA = await createStore(db, "tienda-a");
    const ana = await createUser(db, "ana@example.com");
    const bruno = await createUser(db, "bruno@example.com");
    const owner = await createRole(db, storeA.id, "Propietario", ["store:settings"]);
    await addMember(db, { storeId: storeA.id, userId: ana.id, roleId: owner.id, isOwner: true });

    await expectDbError(
      db.insert(storeMembers).values({
        storeId: storeA.id,
        userId: bruno.id,
        roleId: owner.id,
        isOwner: true,
      }),
      /store_members_one_owner_key/,
    );
  });

  it("una membresía solo puede usar un rol de su propia tienda", async () => {
    const storeA = await createStore(db, "tienda-a");
    const storeB = await createStore(db, "tienda-b");
    const ana = await createUser(db, "ana@example.com");
    const roleB = await createRole(db, storeB.id, "Vendedor", ["orders:read"]);

    await expectDbError(
      addMember(db, { storeId: storeA.id, userId: ana.id, roleId: roleB.id }),
      /store_members_role_fk/,
    );
  });

  it("el email de usuario es único sin importar mayúsculas", async () => {
    await createUser(db, "ana@example.com");

    await expectDbError(
      db.insert(users).values({ email: "ANA@example.com", fullName: "Otra Ana" }),
      /users_email_key/,
    );
  });

  it("el total de línea debe ser precio por cantidad", async () => {
    const storeA = await createStore(db, "tienda-a");
    const ana = await createUser(db, "ana@example.com");
    const product = await createProduct(db, { storeId: storeA.id, sku: "LINEA", priceMinor: 1000 });
    const order = await createOrder(db, { storeId: storeA.id, createdByUserId: ana.id });

    await expectDbError(
      db.insert(orderItems).values({
        storeId: storeA.id,
        orderId: order.id,
        productId: product.id,
        skuSnapshot: product.sku,
        nameSnapshot: product.name,
        unitPriceMinor: 1000,
        quantity: 2,
        lineTotalMinor: 1500,
      }),
      /order_items_line_total_consistent/,
    );
  });
});
