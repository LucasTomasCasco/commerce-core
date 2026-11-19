import { eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { categories, storeMembers } from "../../src/db/schema/index.js";
import { withDbContext } from "../../src/db/tenant.js";
import { createTestDb, expectDbError, resetDb } from "../support/db.js";
import {
  addMember,
  createCategory,
  createRole,
  createStore,
  createUser,
  seedCurrencies,
} from "../support/fixtures.js";

describe("aislamiento por tienda (RLS)", () => {
  const { client, db } = createTestDb();

  beforeEach(async () => {
    await resetDb(db);
    await seedCurrencies(db);
  });

  afterAll(async () => {
    await client.end();
  });

  it("una tienda solo ve sus categorías", async () => {
    const storeA = await createStore(db, "tienda-a");
    const storeB = await createStore(db, "tienda-b");
    await createCategory(db, storeA.id, "remeras");
    await createCategory(db, storeB.id, "tazas");

    const visibles = await withDbContext(db, { storeId: storeA.id }, (tx) =>
      tx.select().from(categories),
    );

    expect(visibles.map((c) => c.slug)).toEqual(["remeras"]);
  });

  it("sin contexto de tienda no devuelve filas", async () => {
    const storeA = await createStore(db, "tienda-a");
    await createCategory(db, storeA.id, "remeras");

    const visibles = await withDbContext(db, {}, (tx) => tx.select().from(categories));

    expect(visibles).toEqual([]);
  });

  it("rechaza insertar una fila que pertenece a otra tienda", async () => {
    const storeA = await createStore(db, "tienda-a");
    const storeB = await createStore(db, "tienda-b");

    await expectDbError(
      withDbContext(db, { storeId: storeA.id }, (tx) =>
        tx.insert(categories).values({ storeId: storeB.id, name: "x", slug: "x" }),
      ),
      /row-level security/,
    );
  });

  it("no modifica filas de otra tienda", async () => {
    const storeA = await createStore(db, "tienda-a");
    const storeB = await createStore(db, "tienda-b");
    const categoryB = await createCategory(db, storeB.id, "tazas");

    const updated = await withDbContext(db, { storeId: storeA.id }, (tx) =>
      tx
        .update(categories)
        .set({ name: "hackeado" })
        .where(eq(categories.id, categoryB.id))
        .returning(),
    );
    const [intacta] = await db.select().from(categories).where(eq(categories.id, categoryB.id));

    expect(updated).toEqual([]);
    expect(intacta?.name).toBe("tazas");
  });

  it("un usuario ve sus membresías en todas las tiendas y no las ajenas", async () => {
    const storeA = await createStore(db, "tienda-a");
    const storeB = await createStore(db, "tienda-b");
    const ana = await createUser(db, "ana@example.com");
    const bruno = await createUser(db, "bruno@example.com");
    const roleA = await createRole(db, storeA.id, "Vendedor", ["orders:read"]);
    const roleB = await createRole(db, storeB.id, "Vendedor", ["orders:read"]);
    await addMember(db, { storeId: storeA.id, userId: ana.id, roleId: roleA.id });
    await addMember(db, { storeId: storeB.id, userId: ana.id, roleId: roleB.id });
    await addMember(db, { storeId: storeA.id, userId: bruno.id, roleId: roleA.id });

    const visibles = await withDbContext(db, { userId: ana.id }, (tx) =>
      tx.select().from(storeMembers),
    );

    expect(visibles).toHaveLength(2);
    expect(visibles.every((m) => m.userId === ana.id)).toBe(true);
  });
});
