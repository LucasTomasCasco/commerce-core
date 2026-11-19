// Catálogo cerrado de permisos. Se define en código: los roles de cada tienda solo
// pueden combinar estas claves.
export const PERMISSIONS = [
  "products:read",
  "products:manage",
  "categories:manage",
  "stock:read",
  "stock:adjust",
  "orders:read",
  "orders:create",
  "orders:update_status",
  "orders:cancel",
  "team:manage",
  "store:settings",
  "audit:read",
] as const;

export type Permission = (typeof PERMISSIONS)[number];

export const OWNER_ROLE_NAME = "Propietario";

// Roles que se crean al alta de cada tienda. El propietario tiene todos los permisos.
export const DEFAULT_ROLES: { name: string; permissions: readonly Permission[] }[] = [
  { name: OWNER_ROLE_NAME, permissions: PERMISSIONS },
  {
    name: "Vendedor",
    permissions: [
      "products:read",
      "stock:read",
      "orders:read",
      "orders:create",
      "orders:update_status",
    ],
  },
  {
    name: "Depósito",
    permissions: ["products:read", "stock:read", "stock:adjust", "orders:read"],
  },
];
