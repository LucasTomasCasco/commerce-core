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

// Datos de demostración a escala: 50 categorías, 180 productos y 160 pedidos por cliente, con el
// historial de stock que cierra con cada saldo. Es determinístico: la misma semilla da los mismos datos.
// Idempotente: cada tienda demo se borra y se vuelve a crear.
// Contraseña de los clientes demo: CLIENT_PASSWORD. Lucía conserva demo-owner-123.

const DAY = 24 * 60 * 60 * 1000;
const HOUR = 60 * 60 * 1000;
export const CLIENT_PASSWORD = "demo-cliente-123";
const CHUNK = 500;

type Family = {
  name: string;
  subs: string[]; // categorías: "<familia> · <sub>"
  nouns: string[]; // sustantivo singular del producto
  materials: string[];
  details: string[];
  min: number; // precio mínimo en unidades enteras de la moneda
  max: number;
};

type StaffDef = { email: string; name: string; role: string; password?: string };

type StoreDef = {
  slug: string;
  name: string;
  currency: "ARS" | "USD";
  seed: number;
  owner: StaffDef;
  customRoles: { name: string; permissions: Permission[] }[];
  staff: StaffDef[];
  invitations: { email: string; role: string; daysFromNow: number }[];
  families: Family[];
  archivedCategories: number;
  productCount: number;
  orderCount: number;
  customers: { first: string[]; last: string[]; phone: (r: () => number) => string };
};

// Generador pseudoaleatorio determinístico (mulberry32).
function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const pick = <T>(r: () => number, items: T[]): T => items[Math.floor(r() * items.length)] as T;
const int = (r: () => number, min: number, max: number) => min + Math.floor(r() * (max - min + 1));

const AR_PHONE = (r: () => number) =>
  `+54 11 ${String(int(r, 4000, 6999))}-${String(int(r, 1000, 9999))}`;
const US_PHONE = (r: () => number) => `+1 305 555-${String(int(r, 1000, 9999))}`;
const FIRST = [
  "María",
  "Juan",
  "Lucía",
  "Carlos",
  "Ana",
  "Sofía",
  "Martín",
  "Valentina",
  "Diego",
  "Camila",
  "Nicolás",
  "Florencia",
  "Pedro",
  "Elena",
  "Bruno",
  "Julieta",
  "Tomás",
  "Renata",
  "Gonzalo",
  "Mora",
  "Ignacio",
  "Paula",
  "Matías",
  "Agustina",
  "Federico",
  "Lorena",
  "Rodrigo",
  "Carolina",
  "Hernán",
  "Victoria",
];
const LAST = [
  "Pérez",
  "Gómez",
  "Ruiz",
  "Méndez",
  "Torres",
  "Soto",
  "Díaz",
  "Vega",
  "Cruz",
  "Ortiz",
  "Herrera",
  "Prieto",
  "Castro",
  "Ramos",
  "Navarro",
  "Vidal",
  "Fernández",
  "Luna",
  "Peña",
  "Blanco",
  "Acosta",
  "Moreno",
  "Silva",
  "Romero",
  "Sosa",
  "Ibarra",
  "Correa",
  "Benítez",
];
const NOTES = [
  "Entregar por la tarde",
  "Confirmar dirección por WhatsApp",
  "Regalo, envolver",
  "Dejar en mostrador",
  "Llamar antes de llegar",
  "Pedido semanal",
  "Sin nota",
];
const ADJUST_REASONS = [
  "Faltante en el conteo mensual",
  "Rotura en depósito",
  "Muestras para showroom",
  "Producción quemada",
  "Daño en transporte",
];
const LINES = [
  "Edición limitada con certificado de origen.",
  "Pensado para el uso diario.",
  "Producción en pequeña escala.",
  "Acabado a mano, cada pieza es única.",
  "Listo para regalar.",
];

const FAMILY_HOGAR: Family = {
  name: "Cocina y hogar",
  subs: [
    "Tazas",
    "Platos",
    "Vasos",
    "Bandejas",
    "Cuencos",
    "Jarras",
    "Cubiertos",
    "Tablas",
    "Frascos",
    "Velas",
    "Cestos",
    "Fuentes",
    "Ollas",
  ],
  nouns: [
    "Taza",
    "Plato",
    "Vaso",
    "Bandeja",
    "Cuenco",
    "Jarra",
    "Cuchillo",
    "Tabla",
    "Frasco",
    "Vela",
    "Cesto",
    "Fuente",
    "Olla",
  ],
  materials: [
    "cerámica",
    "vidrio",
    "madera de olivo",
    "acero inoxidable",
    "barro",
    "porcelana",
    "hierro fundido",
  ],
  details: ["artesanal", "premium", "clásica", "mate", "edición limitada", "de diseño nórdico"],
  min: 2500,
  max: 250000,
};
const FAMILY_TEXTIL: Family = {
  name: "Textil",
  subs: [
    "Almohadones",
    "Manteles",
    "Servilletas",
    "Cortinas",
    "Sábanas",
    "Toallas",
    "Mantas",
    "Individuales",
    "Caminos",
    "Batas",
    "Fundas",
    "Repasadores",
    "Delantales",
  ],
  nouns: [
    "Almohadón",
    "Mantel",
    "Servilleta",
    "Cortina",
    "Sábana",
    "Toalla",
    "Manta",
    "Individual",
    "Camino",
    "Bata",
    "Funda",
    "Repasador",
    "Delantal",
  ],
  materials: ["lino", "algodón", "lana", "hilo bordado", "seda", "muselina"],
  details: ["color arena", "lavado", "a rayas", "artesanal", "premium", "orgánico"],
  min: 4000,
  max: 180000,
};
const FAMILY_DECO: Family = {
  name: "Decoración",
  subs: [
    "Macetas",
    "Espejos",
    "Lámparas",
    "Relojes",
    "Portarretratos",
    "Cuadros",
    "Floreros",
    "Percheros",
    "Estantes",
    "Atrapasueños",
    "Candelabros",
    "Cajas",
    "Bancos",
  ],
  nouns: [
    "Maceta",
    "Espejo",
    "Lámpara",
    "Reloj",
    "Portarretrato",
    "Cuadro",
    "Florero",
    "Perchero",
    "Estante",
    "Atrapasueños",
    "Candelabro",
    "Caja",
    "Banco",
  ],
  materials: ["hormigón", "mimbre", "bronce", "madera", "vidrio soplado", "yeso"],
  details: ["mate", "pulido", "de interior", "de exterior", "rústico", "minimalista"],
  min: 3500,
  max: 300000,
};
const FAMILY_REGALOS: Family = {
  name: "Regalos",
  subs: [
    "Velas aromáticas",
    "Jabones",
    "Perfumes",
    "Cajas de regalo",
    "Tarjetas",
    "Cosméticos",
    "Libretas",
    "Bolsitas",
    "Llaveros",
    "Imanes",
    "Termos",
    "Mates",
    "Juegos",
  ],
  nouns: [
    "Vela aromática",
    "Jabón",
    "Perfume",
    "Caja de regalo",
    "Tarjeta",
    "Cosmético",
    "Libreta",
    "Bolsita",
    "Llavero",
    "Imán",
    "Termo",
    "Mate",
    "Juego",
  ],
  materials: ["soja", "aceite esencial", "cartón reciclado", "cuero", "acero", "cerámica"],
  details: ["cítrico", "lavanda", "edición fiesta", "para regalar", "natural", "premium"],
  min: 1500,
  max: 120000,
};

const FAMILY_ROPA: Family = {
  name: "Indumentaria",
  subs: [
    "Camisas",
    "Pantalones",
    "Vestidos",
    "Faldas",
    "Blazers",
    "Remeras",
    "Shorts",
    "Overoles",
    "Buzos",
    "Camperas",
    "Bermudas",
    "Chalecos",
    "Tops",
  ],
  nouns: [
    "Camisa",
    "Pantalón",
    "Vestido",
    "Falda",
    "Blazer",
    "Remera",
    "Short",
    "Overol",
    "Buzo",
    "Campera",
    "Bermuda",
    "Chaleco",
    "Top",
  ],
  materials: ["lino", "algodón orgánico", "lana merino", "seda", "denim", "viscosa"],
  details: ["clásico", "relajado", "edición limitada", "premium", "de temporada", "sin costuras"],
  min: 15,
  max: 190,
};
const FAMILY_CALZADO: Family = {
  name: "Calzado",
  subs: [
    "Sandalias",
    "Alpargatas",
    "Zapatillas",
    "Botas",
    "Mocasines",
    "Chinelas",
    "Botines",
    "Zuecos",
    "Ojotas",
    "Sneakers",
    "Mules",
    "Pantuflas",
    "Náuticos",
  ],
  nouns: [
    "Sandalia",
    "Alpargata",
    "Zapatilla",
    "Bota",
    "Mocasín",
    "Chinela",
    "Botín",
    "Zueco",
    "Ojota",
    "Sneaker",
    "Mule",
    "Pantufla",
    "Náutico",
  ],
  materials: ["cuero vacuno", "yute", "lona", "gamuza", "caucho natural"],
  details: ["ergonómico", "clásico", "edición limitada", "premium", "de verano", "impermeable"],
  min: 25,
  max: 210,
};
const FAMILY_ACCESORIOS: Family = {
  name: "Accesorios",
  subs: [
    "Bolsos",
    "Cinturones",
    "Gorras",
    "Pañuelos",
    "Carteras",
    "Bufandas",
    "Sombreros",
    "Mochilas",
    "Billeteras",
    "Anteojos",
    "Pulseras",
    "Aros",
    "Cintos",
  ],
  nouns: [
    "Bolso",
    "Cinturón",
    "Gorra",
    "Pañuelo",
    "Cartera",
    "Bufanda",
    "Sombrero",
    "Mochila",
    "Billetera",
    "Anteojos",
    "Pulsera",
    "Aro",
    "Cinto",
  ],
  materials: ["cuero", "fibra natural", "seda", "algodón", "metal", "bambú"],
  details: ["trenzado a mano", "clásico", "edición limitada", "premium", "unisex", "de verano"],
  min: 12,
  max: 150,
};

const FAMILY_PAN: Family = {
  name: "Panadería",
  subs: [
    "Panes",
    "Medialunas",
    "Facturas",
    "Bizcochos",
    "Integrales",
    "Focaccias",
    "Grisines",
    "Sándwiches",
    "Empanadas",
    "Tartas saladas",
    "Chipas",
    "Pizzetas",
    "Ciabattas",
  ],
  nouns: [
    "Pan",
    "Medialuna",
    "Factura",
    "Bizcocho",
    "Pan integral",
    "Focaccia",
    "Grisín",
    "Sándwich",
    "Empanada",
    "Tarta salada",
    "Chipa",
    "Pizzeta",
    "Ciabatta",
  ],
  materials: ["masa madre", "centeno", "maíz", "avena", "manteca", "espinaca", "queso"],
  details: ["del día", "de horneada lenta", "clásico", "premium", "de la casa", "sin TACC"],
  min: 1200,
  max: 45000,
};
const FAMILY_PASTELERIA: Family = {
  name: "Pastelería",
  subs: [
    "Tortas",
    "Alfajores",
    "Budines",
    "Cookies",
    "Tartaletas",
    "Macarons",
    "Merengues",
    "Flanes",
    "Pasteles",
    "Cheesecakes",
    "Brownies",
    "Coronas",
    "Pavlovas",
  ],
  nouns: [
    "Torta",
    "Alfajor",
    "Budín",
    "Cookie",
    "Tartaleta",
    "Macaron",
    "Merengue",
    "Flan",
    "Pastel",
    "Cheesecake",
    "Brownie",
    "Corona",
    "Pavlova",
  ],
  materials: ["chocolate amargo", "dulce de leche", "limón", "frutos rojos", "coco", "vainilla"],
  details: [
    "para 10 personas",
    "artesanal",
    "sin gluten",
    "de la semana",
    "clásico",
    "edición especial",
  ],
  min: 900,
  max: 65000,
};
const FAMILY_CAFE: Family = {
  name: "Cafetería",
  subs: [
    "Cafés",
    "Infusiones",
    "Jugos",
    "Licuados",
    "Chocolates",
    "Tés",
    "Cafés fríos",
    "Smoothies",
    "Limonadas",
    "Matcha",
    "Chai",
    "Mates",
    "Cappuccinos",
  ],
  nouns: [
    "Café",
    "Infusión",
    "Jugo",
    "Licuado",
    "Chocolate",
    "Té",
    "Café frío",
    "Smoothie",
    "Limonada",
    "Matcha",
    "Chai",
    "Mate",
    "Cappuccino",
  ],
  materials: [
    "grano de origen",
    "hojas sueltas",
    "frutas de estación",
    "cacao 70%",
    "yerba orgánica",
  ],
  details: [
    "de tueste medio",
    "descafeinado",
    "edición fría",
    "premium",
    "sin azúcar",
    "de temporada",
  ],
  min: 700,
  max: 22000,
};
const FAMILY_CONSERVAS: Family = {
  name: "Conservas",
  subs: [
    "Mermeladas",
    "Dulces",
    "Mieles",
    "Granolas",
    "Aceites",
    "Salsas",
    "Pastas",
    "Harinas",
    "Frutos secos",
    "Chutneys",
    "Encurtidos",
    "Vinagres",
    "Especias",
  ],
  nouns: [
    "Mermelada",
    "Dulce",
    "Miel",
    "Granola",
    "Aceite",
    "Salsa",
    "Pasta",
    "Harina",
    "Mix de frutos secos",
    "Chutney",
    "Encurtido",
    "Vinagre",
    "Especia",
  ],
  materials: [
    "frutas de estación",
    "flores silvestres",
    "fruta cítrica",
    "hierbas frescas",
    "semillas",
  ],
  details: [
    "artesanal",
    "sin conservantes",
    "frasco de 350 g",
    "edición limitada",
    "premium",
    "de cosecha",
  ],
  min: 900,
  max: 28000,
};

const STORE_DEFS: StoreDef[] = [
  {
    slug: "casa-roble",
    name: "Casa Roble",
    currency: "ARS",
    seed: 1001,
    owner: {
      email: "lucia@casa-roble.example",
      name: "Lucía Roble",
      role: OWNER_ROLE_NAME,
      password: "demo-owner-123",
    },
    customRoles: [
      {
        name: "Caja",
        permissions: ["orders:create", "orders:read", "products:read", "stock:read"],
      },
    ],
    staff: [
      { email: "martin@casa-roble.example", name: "Martín Vega", role: "Vendedor" },
      { email: "sofia@casa-roble.example", name: "Sofía Ruiz", role: "Depósito" },
      { email: "pablo@casa-roble.example", name: "Pablo Díaz", role: "Caja" },
      { email: "valeria@casa-roble.example", name: "Valeria Soto", role: "Vendedor" },
      { email: "nicolas@casa-roble.example", name: "Nicolás Peña", role: "Depósito" },
      { email: "julieta@casa-roble.example", name: "Julieta Ortiz", role: "Caja" },
    ],
    invitations: [
      { email: "nueva.persona@casa-roble.example", role: "Vendedor", daysFromNow: 5 },
      { email: "vencida@casa-roble.example", role: "Depósito", daysFromNow: -2 },
    ],
    families: [FAMILY_HOGAR, FAMILY_TEXTIL, FAMILY_DECO, FAMILY_REGALOS],
    archivedCategories: 4,
    productCount: 180,
    orderCount: 160,
    customers: { first: FIRST, last: LAST, phone: AR_PHONE },
  },
  {
    slug: "taller-lino",
    name: "Taller Lino",
    currency: "USD",
    seed: 2002,
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
      { email: "joaquin@taller-lino.example", name: "Joaquín Mena", role: "Depósito" },
      { email: "lucia.r@taller-lino.example", name: "Lucía Rey", role: "Vendedor" },
      { email: "tobias@taller-lino.example", name: "Tobías Gil", role: "Ventas online" },
    ],
    invitations: [
      { email: "nueva.talleres@taller-lino.example", role: "Depósito", daysFromNow: 6 },
      { email: "ventas.mayorista@taller-lino.example", role: "Ventas online", daysFromNow: 3 },
      { email: "vencida.lino@taller-lino.example", role: "Vendedor", daysFromNow: -4 },
    ],
    families: [FAMILY_ROPA, FAMILY_CALZADO, FAMILY_ACCESORIOS, FAMILY_TEXTIL],
    archivedCategories: 4,
    productCount: 180,
    orderCount: 160,
    customers: { first: FIRST, last: LAST, phone: US_PHONE },
  },
  {
    slug: "panaderia-dulce-trigo",
    name: "Panadería Dulce Trigo",
    currency: "ARS",
    seed: 3003,
    owner: { email: "renata@dulce-trigo.example", name: "Renata Blanco", role: OWNER_ROLE_NAME },
    customRoles: [],
    staff: [
      { email: "gaston@dulce-trigo.example", name: "Gastón Luna", role: "Vendedor" },
      { email: "marcela@dulce-trigo.example", name: "Marcela Peña", role: "Depósito" },
      { email: "ezequiel@dulce-trigo.example", name: "Ezequiel Costa", role: "Vendedor" },
      { email: "rocio@dulce-trigo.example", name: "Rocío Medina", role: "Vendedor" },
    ],
    invitations: [
      { email: "nuevo.panadero@dulce-trigo.example", role: "Depósito", daysFromNow: 4 },
      { email: "caja.tarde@dulce-trigo.example", role: "Vendedor", daysFromNow: 6 },
      { email: "vencida.pan@dulce-trigo.example", role: "Vendedor", daysFromNow: -1 },
    ],
    families: [FAMILY_PAN, FAMILY_PASTELERIA, FAMILY_CAFE, FAMILY_CONSERVAS],
    archivedCategories: 3,
    productCount: 180,
    orderCount: 160,
    customers: { first: FIRST, last: LAST, phone: AR_PHONE },
  },
];

export const DEMO_STORES = STORE_DEFS;

function slugify(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

const tokenHash = () => createHash("sha256").update(randomBytes(32)).digest("hex");

function chunks<T>(rows: T[]): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < rows.length; i += CHUNK) out.push(rows.slice(i, i + CHUNK));
  return out;
}

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
    .values({
      email,
      fullName,
      passwordHash: await hashPassword(password),
      onboardingCompletedAt: null,
    })
    .returning({ id: users.id });
  if (!created) throw new Error(`No se creó el usuario ${email}`);
  return created.id;
}

type GeneratedProduct = {
  sku: string;
  name: string;
  description: string;
  category: number;
  priceMinor: number;
  stock: number;
  adjust?: { qty: number; reason: string };
  active: boolean;
};

function generateCatalog(def: StoreDef, r: () => number) {
  // 50 categorías: familias × subcategorías, recortadas a 50.
  const categoryNames: { name: string; family: Family; noun: string }[] = [];
  for (const family of def.families) {
    for (const [j, sub] of family.subs.entries()) {
      categoryNames.push({
        name: `${family.name} · ${sub}`,
        family,
        noun: family.nouns[j] ?? family.nouns[0] ?? "Producto",
      });
    }
  }
  const categoriesDef = categoryNames.slice(0, 50).map((c, index) => ({
    name: c.name,
    slug: slugify(c.name),
    archived: index >= 50 - def.archivedCategories,
    family: c.family,
    noun: c.noun,
  }));

  const products: GeneratedProduct[] = [];
  for (let i = 0; i < def.productCount; i++) {
    const category = Math.floor(r() * categoriesDef.length);
    const cat = categoriesDef[category];
    if (!cat) throw new Error("Categoría inexistente");
    const f = cat.family;
    const noun = cat.noun;
    const material = pick(r, f.materials);
    const detail = pick(r, f.details);
    const active = r() > 0.04;
    const stock = r() < 0.08 ? 0 : int(r, 1, 60);
    const adjust = r() < 0.12 ? { qty: int(r, 1, 3), reason: pick(r, ADJUST_REASONS) } : undefined;
    products.push({
      sku: `${def.slug.slice(0, 3).toUpperCase()}-${String(i + 1).padStart(4, "0")}`,
      name: `${noun} de ${material} · ${detail}`,
      description: `${noun} ${detail} con ${material}. ${pick(r, LINES)}`,
      category,
      priceMinor: int(r, f.min, f.max) * 100,
      stock,
      active,
      ...(adjust ? { adjust } : {}),
    });
  }
  return { categoriesDef, products };
}

function generateOrders(def: StoreDef, products: GeneratedProduct[], r: () => number) {
  // Solo productos activos se venden; pendientes son recientes para que no venza el TTL.
  const sellable = products.map((p, index) => ({ p, index })).filter((x) => x.p.active);
  const orders: {
    status: "pending" | "confirmed" | "fulfilled" | "cancelled";
    daysAgo: number;
    customer: string;
    phone: string;
    note: string | null;
    by: string;
    lines: { index: number; qty: number }[];
  }[] = [];
  const team = [def.owner.email, ...def.staff.map((s) => s.email)];
  for (let i = 0; i < def.orderCount; i++) {
    // Los primeros pedidos son pendientes recientes (no vencen por TTL) para que la bandeja nunca esté vacía.
    const daysAgo = i < 8 ? int(r, 0, 1) : int(r, 0, 75);
    const roll = r();
    let status: "pending" | "confirmed" | "fulfilled" | "cancelled";
    if (i < 8) status = "pending";
    else if (roll < 0.22) status = "confirmed";
    else if (roll < 0.36) status = "cancelled";
    else status = "fulfilled";
    const lineCount = int(r, 1, 4);
    const lines: { index: number; qty: number }[] = [];
    for (let l = 0; l < lineCount; l++) {
      const pick1 = sellable[Math.floor(r() * sellable.length)];
      if (!pick1 || lines.some((x) => x.index === pick1.index)) continue;
      lines.push({ index: pick1.index, qty: int(r, 1, 3) });
    }
    if (lines.length === 0) continue;
    orders.push({
      status,
      daysAgo,
      customer: `${pick(r, def.customers.first)} ${pick(r, def.customers.last)}`,
      phone: def.customers.phone(r),
      note: r() < 0.3 ? pick(r, NOTES) : null,
      by: pick(r, team),
      lines,
    });
  }
  return orders.sort((a, b) => b.daysAgo - a.daysAgo);
}

async function seedStore(tx: Tx, def: StoreDef, now: number) {
  const r = rng(def.seed);
  const at = (daysAgo: number) => new Date(now - daysAgo * DAY);
  const { categoriesDef, products: generated } = generateCatalog(def, r);
  const generatedOrders = generateOrders(def, generated, r);

  const [store] = await tx
    .insert(stores)
    .values({
      slug: def.slug,
      name: def.name,
      currencyCode: def.currency,
      status: "active",
      orderSeq: generatedOrders.length,
      createdAt: at(80),
      updatedAt: at(0),
    })
    .returning({ id: stores.id });
  if (!store) throw new Error(`No se creó la tienda ${def.slug}`);
  const storeId = store.id;

  // Roles: propietario (sistema), los dos por defecto y los personalizados.
  const roleRows = await tx
    .insert(storeRoles)
    .values([
      { storeId, name: OWNER_ROLE_NAME, permissions: [...PERMISSIONS], isSystem: true },
      ...DEFAULT_ROLES.filter((role) => role.name !== OWNER_ROLE_NAME).map((role) => ({
        storeId,
        name: role.name,
        permissions: [...role.permissions],
      })),
      ...def.customRoles.map((role) => ({
        storeId,
        name: role.name,
        permissions: [...role.permissions],
      })),
    ])
    .returning({ id: storeRoles.id, name: storeRoles.name });
  const roleIds = new Map(roleRows.map((role) => [role.name, role.id]));
  const roleId = (name: string) => {
    const id = roleIds.get(name);
    if (!id) throw new Error(`Rol ${name} no existe en ${def.slug}`);
    return id;
  };

  // Equipo.
  const ownerUserId = await upsertUser(tx, def.owner.email, def.owner.name, def.owner.password);
  const memberIds = new Map<string, string>([[def.owner.email, ownerUserId]]);
  await tx.insert(storeMembers).values({
    storeId,
    userId: ownerUserId,
    roleId: roleId(OWNER_ROLE_NAME),
    isOwner: true,
    createdAt: at(80),
  });
  for (const member of def.staff) {
    const userId = await upsertUser(tx, member.email, member.name);
    memberIds.set(member.email, userId);
    await tx
      .insert(storeMembers)
      .values({ storeId, userId, roleId: roleId(member.role), createdAt: at(60) });
  }

  // Categorías (en lotes).
  const categoryIds: string[] = [];
  for (const batch of chunks(categoriesDef)) {
    const rows = await tx
      .insert(categories)
      .values(
        batch.map((c) => ({
          storeId,
          name: c.name,
          slug: c.slug,
          archivedAt: c.archived ? at(12) : null,
          createdAt: at(78),
        })),
      )
      .returning({ id: categories.id });
    categoryIds.push(...rows.map((row) => row.id));
  }

  // Productos (en lotes). El índice conserva el orden para mapear pedidos y movimientos.
  const productIds: string[] = [];
  const productRows = generated.map((p) => ({
    storeId,
    categoryId: p.category < categoriesDef.length ? (categoryIds[p.category] ?? null) : null,
    sku: p.sku,
    name: p.name,
    description: p.description,
    priceMinor: p.priceMinor,
    stockOnHand: p.stock,
    active: p.active,
    archivedAt: p.active ? null : at(8),
    createdAt: at(76),
    updatedAt: at(1),
  }));
  for (const batch of chunks(productRows)) {
    const rows = await tx.insert(products).values(batch).returning({ id: products.id });
    productIds.push(...rows.map((row) => row.id));
  }

  // Ledger: entrada inicial = stock final + lo vendido (no cancelado) + lo ajustado.
  const sold = new Map<number, number>();
  for (const order of generatedOrders) {
    if (order.status === "cancelled") continue;
    for (const line of order.lines) sold.set(line.index, (sold.get(line.index) ?? 0) + line.qty);
  }
  const movementRows: (typeof stockMovements.$inferInsert)[] = [];
  for (const [index, p] of generated.entries()) {
    const productId = productIds[index];
    if (!productId) continue;
    const adjusted = p.adjust?.qty ?? 0;
    const initial = p.stock + (sold.get(index) ?? 0) + adjusted;
    if (initial > 0) {
      movementRows.push({
        storeId,
        productId,
        type: "purchase",
        quantityDelta: initial,
        reason: "Stock inicial",
        createdByUserId: ownerUserId,
        createdAt: at(70),
      });
    }
    if (p.adjust) {
      movementRows.push({
        storeId,
        productId,
        type: "adjustment",
        quantityDelta: -p.adjust.qty,
        reason: p.adjust.reason,
        createdByUserId: ownerUserId,
        createdAt: at(20),
      });
    }
  }

  // Pedidos: se insertan primero para tener sus ids, después líneas y movimientos.
  const orderRows = generatedOrders.map((order, index) => {
    const lines = order.lines.map((l) => ({ ...l, p: generated[l.index] }));
    const totalMinor = lines.reduce((sum, l) => sum + (l.p?.priceMinor ?? 0) * l.qty, 0);
    const createdAt = at(order.daysAgo);
    return {
      storeId,
      code: `ORD-${String(index + 1).padStart(6, "0")}`,
      status: order.status,
      customerName: order.customer,
      customerPhone: order.phone,
      note: order.note,
      currencyCode: def.currency,
      totalMinor,
      createdByUserId: memberIds.get(order.by) ?? ownerUserId,
      createdAt,
      updatedAt: order.status === "pending" ? createdAt : new Date(createdAt.getTime() + 2 * HOUR),
    };
  });
  const orderIds: string[] = [];
  for (const batch of chunks(orderRows)) {
    const rows = await tx.insert(orders).values(batch).returning({ id: orders.id });
    orderIds.push(...rows.map((row) => row.id));
  }

  const itemRows: (typeof orderItems.$inferInsert)[] = [];
  const auditRows: (typeof auditLogs.$inferInsert)[] = [];
  for (const [index, order] of generatedOrders.entries()) {
    const orderId = orderIds[index];
    const row = orderRows[index];
    if (!orderId || !row) continue;
    const actorId = row.createdByUserId;
    for (const line of order.lines) {
      const p = generated[line.index];
      const productId = productIds[line.index];
      if (!p || !productId) continue;
      itemRows.push({
        storeId,
        orderId,
        productId,
        skuSnapshot: p.sku,
        nameSnapshot: p.name,
        unitPriceMinor: p.priceMinor,
        quantity: line.qty,
        lineTotalMinor: p.priceMinor * line.qty,
      });
      movementRows.push({
        storeId,
        productId,
        type: "sale",
        quantityDelta: -line.qty,
        orderId,
        createdByUserId: actorId,
        createdAt: row.createdAt,
      });
      if (order.status === "cancelled") {
        movementRows.push({
          storeId,
          productId,
          type: "sale_cancel",
          quantityDelta: line.qty,
          orderId,
          createdByUserId: ownerUserId,
          createdAt: new Date(row.createdAt.getTime() + 2 * HOUR),
        });
      }
    }
    auditRows.push({
      storeId,
      actorUserId: actorId,
      action: "order.created",
      entity: "order",
      entityId: orderId,
      metadata: { code: row.code, totalMinor: row.totalMinor },
      createdAt: row.createdAt,
    });
    if (order.status !== "pending") {
      auditRows.push({
        storeId,
        actorUserId: ownerUserId,
        action: order.status === "cancelled" ? "order.cancelled" : `order.${order.status}`,
        entity: "order",
        entityId: orderId,
        metadata: {},
        createdAt: new Date(row.createdAt.getTime() + 2 * HOUR),
      });
    }
  }

  for (const batch of chunks(movementRows)) await tx.insert(stockMovements).values(batch);
  for (const batch of chunks(itemRows)) await tx.insert(orderItems).values(batch);

  // Invitaciones pendientes y vencidas (tokens aleatorios: no sirven para aceptar).
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

  // Auditoría de configuración: creación, altas de equipo y de productos.
  auditRows.push(
    {
      storeId,
      actorUserId: ownerUserId,
      action: "store.created",
      entity: "store",
      entityId: storeId,
      metadata: { slug: def.slug },
      createdAt: at(80),
    },
    ...def.staff.map((m) => ({
      storeId,
      actorUserId: memberIds.get(m.email) ?? ownerUserId,
      action: "member.joined",
      entity: "store_member",
      entityId: memberIds.get(m.email) ?? ownerUserId,
      metadata: { role: m.role },
      createdAt: at(60),
    })),
    ...generated.map((p, index) => ({
      storeId,
      actorUserId: ownerUserId,
      action: "product.created",
      entity: "product",
      entityId: productIds[index] ?? "",
      metadata: { sku: p.sku, priceMinor: p.priceMinor },
      createdAt: at(76),
    })),
  );
  for (const batch of chunks(auditRows)) await tx.insert(auditLogs).values(batch);
}

// Crea (o reemplaza) las tiendas demo. Las cuentas de usuario se reutilizan si ya existen.
export async function seedDemo(db: Db, now: Date = new Date()) {
  await db.transaction(async (tx) => {
    for (const def of STORE_DEFS) {
      await tx.delete(stores).where(eq(stores.slug, def.slug));
      await seedStore(tx, def, now.getTime());
    }
  });
}
