import { randomBytes, createHash } from "node:crypto";
import { eq } from "drizzle-orm";
import { hashPassword } from "../auth/password.js";
import {
  DEFAULT_ROLES,
  OWNER_ROLE_NAME,
  PERMISSIONS,
  type Permission,
} from "../domain/permissions.js";
import type { Db, Tx } from "./client.js";
import {
  auditLogs,
  categories,
  invitations,
  orderItems,
  orders,
  products,
  stockMovements,
  storeMembers,
  storeRoles,
  stores,
  users,
} from "./schema/index.js";

// Datos de demostración para mostrar el panel completo. Idempotente: cada tienda demo se borra y se
// vuelve a crear, así que correrlo de nuevo deja los mismos datos.
// Contraseña de los clientes demo: CLIENT_PASSWORD. Lucía conserva demo-owner-123.

const DAY = 24 * 60 * 60 * 1000;
const HOUR = 60 * 60 * 1000;
export const CLIENT_PASSWORD = "demo-cliente-123";

type ProductDef = {
  sku: string;
  name: string;
  description: string;
  category: string;
  priceMinor: number;
  stock: number;
  // Un ajuste de inventario (rotura, faltante) que queda en el historial.
  adjust?: { qty: number; reason: string };
  active?: boolean;
};

type OrderDef = {
  status: "pending" | "confirmed" | "fulfilled" | "cancelled";
  customer: string;
  phone: string;
  note?: string;
  daysAgo: number;
  by: string;
  lines: { sku: string; qty: number }[];
};

type StaffDef = { email: string; name: string; role: string; password?: string };

type StoreDef = {
  slug: string;
  name: string;
  currency: "ARS" | "USD";
  owner: StaffDef;
  customRoles: { name: string; permissions: Permission[] }[];
  staff: StaffDef[];
  categories: { name: string; slug: string; archived?: boolean }[];
  products: ProductDef[];
  orders: OrderDef[];
  invitations: { email: string; role: string; daysFromNow: number }[];
};

const CASA_ROBLE: StoreDef = {
  slug: "casa-roble",
  name: "Casa Roble",
  currency: "ARS",
  owner: {
    email: "lucia@casa-roble.example",
    name: "Lucía Roble",
    role: OWNER_ROLE_NAME,
    password: "demo-owner-123",
  },
  customRoles: [
    { name: "Caja", permissions: ["orders:create", "orders:read", "products:read", "stock:read"] },
  ],
  staff: [
    { email: "martin@casa-roble.example", name: "Martín Vega", role: "Vendedor" },
    { email: "sofia@casa-roble.example", name: "Sofía Ruiz", role: "Depósito" },
    { email: "pablo@casa-roble.example", name: "Pablo Díaz", role: "Caja" },
  ],
  categories: [
    { name: "Cocina", slug: "cocina" },
    { name: "Decoración", slug: "decoracion" },
    { name: "Regalos", slug: "regalos" },
    { name: "Liquidación invierno", slug: "liquidacion-invierno", archived: true },
  ],
  products: [
    {
      sku: "TAZ-001",
      name: "Taza de cerámica artesanal",
      description: "Esmaltada a mano, apta para lavavajillas. Capacidad 350 ml.",
      category: "cocina",
      priceMinor: 450000,
      stock: 12,
    },
    {
      sku: "PLT-002",
      name: "Plato playo de barro",
      description: "Barro cocido a 1.100 °C con esmalte mate. Diámetro 27 cm.",
      category: "cocina",
      priceMinor: 680000,
      stock: 6,
    },
    {
      sku: "JAR-003",
      name: "Jarra de vidrio soplado",
      description: "Vidrio reciclado soplado a boca. Ideal para agua fría y jugos.",
      category: "cocina",
      priceMinor: 920000,
      stock: 4,
    },
    {
      sku: "SET-007",
      name: "Set de cuchillos de acero",
      description: "Tres piezas de acero inoxidable forjado con mango de madera de olivo.",
      category: "cocina",
      priceMinor: 2150000,
      stock: 2,
      adjust: { qty: 1, reason: "Faltante en el conteo mensual" },
    },
    {
      sku: "VEL-004",
      name: "Vela de soja aromática",
      description: "Cera de soja natural, fragancia cítrica. Duración aproximada 40 horas.",
      category: "decoracion",
      priceMinor: 350000,
      stock: 18,
    },
    {
      sku: "MAC-005",
      name: "Macetero de hormigón",
      description: "Hormigón pulido con base de corcho. Para interior o exterior.",
      category: "decoracion",
      priceMinor: 1250000,
      stock: 3,
    },
    {
      sku: "ALM-006",
      name: "Almohadón de lino",
      description: "Lino lavado en color arena, relleno de fibra hipoalergénica.",
      category: "decoracion",
      priceMinor: 980000,
      stock: 9,
      adjust: { qty: 1, reason: "Rotura de costura en depósito" },
    },
    {
      sku: "TGR-008",
      name: "Tarjeta de regalo",
      description: "Monto fijo para usar en cualquier producto de la tienda. Sin vencimiento.",
      category: "regalos",
      priceMinor: 1000000,
      stock: 25,
    },
    {
      sku: "MAN-009",
      name: "Mantel de hilo bordado",
      description: "Edición de liquidación. Hilo de algodón con bordado a mano.",
      category: "liquidacion-invierno",
      priceMinor: 760000,
      stock: 0,
      active: false,
    },
  ],
  orders: [
    {
      status: "fulfilled",
      customer: "María Pérez",
      phone: "+54 11 5555-1201",
      note: "Entregar por la tarde",
      daysAgo: 21,
      by: "martin@casa-roble.example",
      lines: [
        { sku: "TAZ-001", qty: 2 },
        { sku: "PLT-002", qty: 1 },
      ],
    },
    {
      status: "cancelled",
      customer: "Ana Torres",
      phone: "+54 11 5555-1202",
      daysAgo: 16,
      by: "pablo@casa-roble.example",
      lines: [{ sku: "MAC-005", qty: 1 }],
    },
    {
      status: "fulfilled",
      customer: "Carlos Méndez",
      phone: "+54 11 5555-1203",
      note: "Regalo, envolver",
      daysAgo: 12,
      by: "martin@casa-roble.example",
      lines: [
        { sku: "SET-007", qty: 1 },
        { sku: "TGR-008", qty: 1 },
      ],
    },
    {
      status: "confirmed",
      customer: "Juan Gómez",
      phone: "+54 11 5555-1204",
      daysAgo: 4,
      by: "lucia@casa-roble.example",
      lines: [
        { sku: "JAR-003", qty: 1 },
        { sku: "VEL-004", qty: 2 },
      ],
    },
    {
      status: "pending",
      customer: "Lucía Ruiz",
      phone: "+54 11 5555-1205",
      note: "Confirmar dirección por WhatsApp",
      daysAgo: 1,
      by: "pablo@casa-roble.example",
      lines: [
        { sku: "ALM-006", qty: 1 },
        { sku: "VEL-004", qty: 1 },
      ],
    },
    {
      status: "pending",
      customer: "Florencia Soto",
      phone: "+54 11 5555-1206",
      daysAgo: 0,
      by: "martin@casa-roble.example",
      lines: [{ sku: "TAZ-001", qty: 3 }],
    },
  ],
  invitations: [
    { email: "nueva.persona@casa-roble.example", role: "Vendedor", daysFromNow: 5 },
    { email: "vencida@casa-roble.example", role: "Depósito", daysFromNow: -2 },
  ],
};

const TALLER_LINO: StoreDef = {
  slug: "taller-lino",
  name: "Taller Lino",
  currency: "USD",
  owner: { email: "mateo@taller-lino.example", name: "Mateo Lino", role: OWNER_ROLE_NAME },
  customRoles: [
    {
      name: "Ventas online",
      permissions: ["orders:create", "orders:read", "orders:update_status", "products:read"],
    },
  ],
  staff: [
    { email: "valentina@taller-lino.example", name: "Valentina Cruz", role: "Vendedor" },
    { email: "diego@taller-lino.example", name: "Diego Ortiz", role: "Depósito" },
    { email: "camila@taller-lino.example", name: "Camila Herrera", role: "Ventas online" },
  ],
  categories: [
    { name: "Indumentaria", slug: "indumentaria" },
    { name: "Accesorios", slug: "accesorios" },
    { name: "Temporada anterior", slug: "temporada-anterior", archived: true },
  ],
  products: [
    {
      sku: "CAM-101",
      name: "Camisa de lino",
      description: "Lino 100% europeo, corte relajado. Tallas S a XL.",
      category: "indumentaria",
      priceMinor: 4500_00,
      stock: 14,
    },
    {
      sku: "PAN-102",
      name: "Pantalón de lino",
      description: "Cintura elástica oculta y bolsillos laterales.",
      category: "indumentaria",
      priceMinor: 5200_00,
      stock: 8,
      adjust: { qty: 2, reason: "Muestras para showroom" },
    },
    {
      sku: "BOL-201",
      name: "Bolso tejido a mano",
      description: "Fibra natural trenzada, asa de cuero. Forro de algodón.",
      category: "accesorios",
      priceMinor: 6800_00,
      stock: 5,
    },
    {
      sku: "CIN-202",
      name: "Cinturón de cuero",
      description: "Cuero vacuno curtido vegetal, hebilla de bronce.",
      category: "accesorios",
      priceMinor: 2400_00,
      stock: 0,
    },
    {
      sku: "GOR-203",
      name: "Gorra de algodón",
      description: "Algodón orgánico, visera curva ajustable.",
      category: "accesorios",
      priceMinor: 1500_00,
      stock: 22,
    },
    {
      sku: "PAS-204",
      name: "Pañuelo de seda",
      description: "Seda natural estampada a mano. 90 x 90 cm.",
      category: "accesorios",
      priceMinor: 1900_00,
      stock: 7,
    },
    {
      sku: "CHA-150",
      name: "Chaqueta de temporada",
      description: "Versión anterior, con descuento de liquidación.",
      category: "temporada-anterior",
      priceMinor: 8900_00,
      stock: 0,
      active: false,
    },
  ],
  orders: [
    {
      status: "fulfilled",
      customer: "Sofía Navarro",
      phone: "+1 305 555-0101",
      daysAgo: 18,
      by: "valentina@taller-lino.example",
      lines: [
        { sku: "CAM-101", qty: 2 },
        { sku: "GOR-203", qty: 1 },
      ],
    },
    {
      status: "fulfilled",
      customer: "Lorenzo Vidal",
      phone: "+1 305 555-0102",
      note: "Envío express",
      daysAgo: 9,
      by: "camila@taller-lino.example",
      lines: [{ sku: "BOL-201", qty: 1 }],
    },
    {
      status: "cancelled",
      customer: "Bruno Castro",
      phone: "+1 305 555-0103",
      daysAgo: 6,
      by: "valentina@taller-lino.example",
      lines: [{ sku: "PAN-102", qty: 1 }],
    },
    {
      status: "confirmed",
      customer: "Elena Ramos",
      phone: "+1 305 555-0104",
      daysAgo: 2,
      by: "camila@taller-lino.example",
      lines: [
        { sku: "PAS-204", qty: 1 },
        { sku: "CAM-101", qty: 1 },
      ],
    },
    {
      status: "pending",
      customer: "Nicolás Prieto",
      phone: "+1 305 555-0105",
      note: "Talla L en la camisa",
      daysAgo: 0,
      by: "valentina@taller-lino.example",
      lines: [{ sku: "CAM-101", qty: 1 }],
    },
  ],
  invitations: [{ email: "nueva.talleres@taller-lino.example", role: "Depósito", daysFromNow: 6 }],
};

const PANADERIA: StoreDef = {
  slug: "panaderia-dulce-trigo",
  name: "Panadería Dulce Trigo",
  currency: "ARS",
  owner: { email: "renata@dulce-trigo.example", name: "Renata Blanco", role: OWNER_ROLE_NAME },
  customRoles: [],
  staff: [
    { email: "gaston@dulce-trigo.example", name: "Gastón Luna", role: "Vendedor" },
    { email: "marcela@dulce-trigo.example", name: "Marcela Peña", role: "Depósito" },
  ],
  categories: [
    { name: "Panadería", slug: "panaderia" },
    { name: "Pastelería", slug: "pasteleria" },
  ],
  products: [
    {
      sku: "PAN-MM",
      name: "Pan de masa madre",
      description: "Fermentación lenta de 48 horas. Corteza crocante, miga alveolada.",
      category: "panaderia",
      priceMinor: 350000,
      stock: 30,
    },
    {
      sku: "MED-12",
      name: "Medialunas (docena)",
      description: "Manteca de primera, glaseadas al almíbar. Se hornean cada mañana.",
      category: "panaderia",
      priceMinor: 420000,
      stock: 15,
      adjust: { qty: 3, reason: "Producción quemada" },
    },
    {
      sku: "ALF-6",
      name: "Alfajores de maicena (x6)",
      description: "Dulce de leche casero y coco rallado.",
      category: "pasteleria",
      priceMinor: 780000,
      stock: 12,
    },
    {
      sku: "TOR-CHO",
      name: "Torta de chocolate",
      description: "Bizcocho húmedo con ganache de chocolate amargo. Porción para 10.",
      category: "pasteleria",
      priceMinor: 1850000,
      stock: 2,
    },
    {
      sku: "CRO-01",
      name: "Croissant de manteca",
      description: "Laminado en 27 capas. Se vende a partir de las 8 hs.",
      category: "pasteleria",
      priceMinor: 220000,
      stock: 0,
    },
  ],
  orders: [
    {
      status: "fulfilled",
      customer: "Vecinos del barrio",
      phone: "+54 11 5555-2301",
      daysAgo: 7,
      by: "gaston@dulce-trigo.example",
      lines: [
        { sku: "PAN-MM", qty: 2 },
        { sku: "MED-12", qty: 1 },
      ],
    },
    {
      status: "fulfilled",
      customer: "Oficina Tango Labs",
      phone: "+54 11 5555-2302",
      note: "Pedido semanal",
      daysAgo: 3,
      by: "renata@dulce-trigo.example",
      lines: [{ sku: "ALF-6", qty: 4 }],
    },
    {
      status: "cancelled",
      customer: "Pedro Ibarra",
      phone: "+54 11 5555-2303",
      daysAgo: 2,
      by: "gaston@dulce-trigo.example",
      lines: [{ sku: "TOR-CHO", qty: 1 }],
    },
    {
      status: "pending",
      customer: "Mora Fernández",
      phone: "+54 11 5555-2304",
      note: "Cumpleaños, dejar en mostrador",
      daysAgo: 0,
      by: "gaston@dulce-trigo.example",
      lines: [
        { sku: "TOR-CHO", qty: 1 },
        { sku: "ALF-6", qty: 1 },
      ],
    },
  ],
  invitations: [],
};

export const DEMO_STORES: StoreDef[] = [CASA_ROBLE, TALLER_LINO, PANADERIA];

const tokenHash = () => createHash("sha256").update(randomBytes(32)).digest("hex");

async function upsertUser(
  tx: Tx,
  email: string,
  fullName: string,
  password = CLIENT_PASSWORD,
): Promise<string> {
  const [existing] = await tx
    .select({ id: users.id })
    .from(users)
    .where(eq(users.email, email))
    .limit(1);
  if (existing) return existing.id;
  const [created] = await tx
    .insert(users)
    .values({ email, fullName, passwordHash: await hashPassword(password) })
    .returning({ id: users.id });
  if (!created) throw new Error(`No se creó el usuario ${email}`);
  return created.id;
}

// Cuánto stock se vendió en total (pedidos no cancelados). Sirve para armar el ingreso inicial.
function netSold(def: StoreDef, sku: string): number {
  return def.orders
    .filter((o) => o.status !== "cancelled")
    .flatMap((o) => o.lines)
    .filter((l) => l.sku === sku)
    .reduce((sum, l) => sum + l.qty, 0);
}

async function seedStore(tx: Tx, def: StoreDef, now: number) {
  const at = (daysAgo: number) => new Date(now - daysAgo * DAY);
  const [store] = await tx
    .insert(stores)
    .values({
      slug: def.slug,
      name: def.name,
      currencyCode: def.currency,
      status: "active",
      orderSeq: def.orders.length,
      createdAt: at(40),
      updatedAt: at(0),
    })
    .returning({ id: stores.id });
  if (!store) throw new Error(`No se creó la tienda ${def.slug}`);
  const storeId = store.id;

  // Roles: propietario (sistema), los dos por defecto y los personalizados.
  const roleIds = new Map<string, string>();
  const roleRows = await tx
    .insert(storeRoles)
    .values([
      { storeId, name: OWNER_ROLE_NAME, permissions: [...PERMISSIONS], isSystem: true },
      ...DEFAULT_ROLES.filter((r) => r.name !== OWNER_ROLE_NAME).map((r) => ({
        storeId,
        name: r.name,
        permissions: [...r.permissions],
      })),
      ...def.customRoles.map((r) => ({ storeId, name: r.name, permissions: [...r.permissions] })),
    ])
    .returning({ id: storeRoles.id, name: storeRoles.name });
  for (const role of roleRows) roleIds.set(role.name, role.id);
  const roleId = (name: string) => {
    const id = roleIds.get(name);
    if (!id) throw new Error(`Rol ${name} no existe en ${def.slug}`);
    return id;
  };

  // Equipo: el propietario y el staff.
  const ownerUserId = await upsertUser(tx, def.owner.email, def.owner.name, def.owner.password);
  await tx.insert(storeMembers).values({
    storeId,
    userId: ownerUserId,
    roleId: roleId(OWNER_ROLE_NAME),
    isOwner: true,
    createdAt: at(40),
  });
  const memberIds = new Map<string, string>([[def.owner.email, ownerUserId]]);
  for (const member of def.staff) {
    const userId = await upsertUser(tx, member.email, member.name);
    memberIds.set(member.email, userId);
    await tx
      .insert(storeMembers)
      .values({ storeId, userId, roleId: roleId(member.role), createdAt: at(30) });
  }

  // Categorías y productos.
  const categoryIds = new Map<string, string>();
  for (const cat of def.categories) {
    const [row] = await tx
      .insert(categories)
      .values({
        storeId,
        name: cat.name,
        slug: cat.slug,
        archivedAt: cat.archived ? at(5) : null,
        createdAt: at(38),
      })
      .returning({ id: categories.id });
    if (row) categoryIds.set(cat.slug, row.id);
  }
  const productIds = new Map<string, string>();
  for (const p of def.products) {
    const [row] = await tx
      .insert(products)
      .values({
        storeId,
        categoryId: categoryIds.get(p.category) ?? null,
        sku: p.sku,
        name: p.name,
        description: p.description,
        priceMinor: p.priceMinor,
        stockOnHand: p.stock,
        active: p.active ?? true,
        archivedAt: p.active === false ? at(3) : null,
        createdAt: at(36),
        updatedAt: at(1),
      })
      .returning({ id: products.id });
    if (!row) throw new Error(`No se creó el producto ${p.sku}`);
    productIds.set(p.sku, row.id);
  }
  const productBySku = new Map(def.products.map((p) => [p.sku, p]));

  // Ledger: entrada inicial = stock final + lo vendido + lo ajustado. Así el saldo cierra con los movimientos.
  for (const p of def.products) {
    const productId = productIds.get(p.sku);
    if (!productId) continue;
    const adjusted = p.adjust?.qty ?? 0;
    const initialStock = p.stock + netSold(def, p.sku) + adjusted;
    // Un producto que nunca tuvo entrada no genera movimiento (el ledger exige cantidades distintas de cero).
    if (initialStock > 0) {
      await tx.insert(stockMovements).values({
        storeId,
        productId,
        type: "purchase",
        quantityDelta: initialStock,
        reason: "Stock inicial",
        createdByUserId: ownerUserId,
        createdAt: at(34),
      });
    }
    if (p.adjust) {
      await tx.insert(stockMovements).values({
        storeId,
        productId,
        type: "adjustment",
        quantityDelta: -p.adjust.qty,
        reason: p.adjust.reason,
        createdByUserId: ownerUserId,
        createdAt: at(10),
      });
    }
  }

  // Pedidos en orden cronológico: el número ORD-00000N sigue la secuencia real de la tienda.
  const ordered = [...def.orders].sort((a, b) => b.daysAgo - a.daysAgo);
  for (const [index, order] of ordered.entries()) {
    const createdAt = at(order.daysAgo);
    const actorId = memberIds.get(order.by) ?? ownerUserId;
    const lines = order.lines.map((line) => {
      const p = productBySku.get(line.sku);
      if (!p) throw new Error(`SKU ${line.sku} no existe en ${def.slug}`);
      return { ...line, product: p, lineTotalMinor: p.priceMinor * line.qty };
    });
    const totalMinor = lines.reduce((sum, l) => sum + l.lineTotalMinor, 0);
    const [row] = await tx
      .insert(orders)
      .values({
        storeId,
        code: `ORD-${String(index + 1).padStart(6, "0")}`,
        status: order.status,
        customerName: order.customer,
        customerPhone: order.phone,
        note: order.note ?? null,
        currencyCode: def.currency,
        totalMinor,
        createdByUserId: actorId,
        createdAt,
        updatedAt:
          order.status === "pending" ? createdAt : new Date(createdAt.getTime() + 2 * HOUR),
      })
      .returning({ id: orders.id });
    if (!row) throw new Error("No se creó el pedido");

    await tx.insert(orderItems).values(
      lines.map((l) => ({
        storeId,
        orderId: row.id,
        productId: productIds.get(l.sku) ?? "",
        skuSnapshot: l.product.sku,
        nameSnapshot: l.product.name,
        unitPriceMinor: l.product.priceMinor,
        quantity: l.qty,
        lineTotalMinor: l.lineTotalMinor,
      })),
    );
    for (const line of lines) {
      await tx.insert(stockMovements).values({
        storeId,
        productId: productIds.get(line.sku) ?? "",
        type: "sale",
        quantityDelta: -line.qty,
        orderId: row.id,
        createdByUserId: actorId,
        createdAt,
      });
      if (order.status === "cancelled") {
        await tx.insert(stockMovements).values({
          storeId,
          productId: productIds.get(line.sku) ?? "",
          type: "sale_cancel",
          quantityDelta: line.qty,
          orderId: row.id,
          createdByUserId: ownerUserId,
          createdAt: new Date(createdAt.getTime() + 2 * HOUR),
        });
      }
    }

    await tx.insert(auditLogs).values({
      storeId,
      actorUserId: actorId,
      action: "order.created",
      entity: "order",
      entityId: row.id,
      metadata: { code: `ORD-${String(index + 1).padStart(6, "0")}`, totalMinor },
      createdAt,
    });
    if (order.status !== "pending") {
      const action = order.status === "cancelled" ? "order.cancelled" : `order.${order.status}`;
      await tx.insert(auditLogs).values({
        storeId,
        actorUserId: ownerUserId,
        action,
        entity: "order",
        entityId: row.id,
        metadata: {},
        createdAt: new Date(createdAt.getTime() + 2 * HOUR),
      });
    }
  }

  // Invitaciones pendientes y vencidas (los tokens son aleatorios: no sirven para aceptar).
  for (const inv of def.invitations) {
    const expiresAt = new Date(now + inv.daysFromNow * DAY);
    await tx.insert(invitations).values({
      storeId,
      email: inv.email,
      roleId: roleId(inv.role),
      tokenHash: tokenHash(),
      expiresAt,
      createdByUserId: ownerUserId,
      createdAt: new Date(expiresAt.getTime() - 7 * DAY),
    });
  }

  // Auditoría de la configuración de la tienda.
  await tx.insert(auditLogs).values([
    {
      storeId,
      actorUserId: ownerUserId,
      action: "store.created",
      entity: "store",
      entityId: storeId,
      metadata: { slug: def.slug },
      createdAt: at(40),
    },
    ...def.staff.map((m) => ({
      storeId,
      actorUserId: memberIds.get(m.email) ?? ownerUserId,
      action: "member.joined",
      entity: "store_member",
      entityId: memberIds.get(m.email) ?? ownerUserId,
      metadata: { roleId: roleId(m.role) },
      createdAt: at(30),
    })),
    ...def.products.map((p) => ({
      storeId,
      actorUserId: ownerUserId,
      action: "product.created",
      entity: "product",
      entityId: productIds.get(p.sku) ?? "",
      metadata: { sku: p.sku, priceMinor: p.priceMinor },
      createdAt: at(36),
    })),
  ]);
}

// Crea (o reemplaza) las tiendas demo. Las cuentas de usuario se reutilizan si ya existen.
export async function seedDemo(db: Db, now: Date = new Date()) {
  await db.transaction(async (tx) => {
    for (const def of DEMO_STORES) {
      await tx.delete(stores).where(eq(stores.slug, def.slug));
      await seedStore(tx, def, now.getTime());
    }
  });
}
