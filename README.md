# Commerce Core

Backend y panel multi-tienda para comercios pequeños: tiendas aisladas, catálogo, stock con ledger, pedidos y equipo con permisos a medida.

Incluye API REST documentada (OpenAPI), panel de administración, storefront público y un E2E en navegador que recorre el flujo completo. El panel funciona en teléfono: en pantallas chicas las tablas se muestran como tarjetas y la navegación de cada tienda se desliza; un test E2E falla si alguna pantalla desborda en 375px.

## Stack

| Capa          | Tecnología                                                           |
| ------------- | -------------------------------------------------------------------- |
| API           | Node.js 22, TypeScript, Fastify 5, Zod 4                             |
| Base de datos | PostgreSQL 16, Drizzle ORM, Row-Level Security                       |
| Autenticación | Sesiones opacas en base, cookie `httpOnly`, Argon2id                 |
| Web           | React, Vite, React Router, TanStack Query, Tailwind v4               |
| Contrato      | OpenAPI generado desde las rutas; cliente tipado con `openapi-fetch` |
| Tests         | Vitest (integración contra PostgreSQL real), Playwright (E2E)        |
| Infra local   | Docker Compose: PostgreSQL, Mailpit (correo de prueba), API, web     |

## Estructura

```
apps/api/      API (Fastify), migraciones, seed, tests de integración
apps/web/      SPA React (panel, storefront público)
e2e/           Flujo completo en navegador (Playwright)
docs/adr/      Decisiones de arquitectura
```

Capas de la API: `routes` (validación de entrada, sesión y permisos) → `services` (reglas de negocio y transacciones) → base de datos (constraints y RLS como última defensa).

## Roles y permisos

- **Administrador general (plataforma):** crea tiendas e invita a sus propietarios, administra monedas y suspende tiendas. No opera productos ni pedidos de las tiendas.
- **Propietario:** todo dentro de su tienda. Una sola membresía propietaria por tienda.
- **Staff:** lo que permita su rol. Cada tienda arranca con dos roles (Vendedor y Depósito) y el propietario crea los que necesite. El catálogo de permisos está en `apps/api/src/domain/permissions.ts`.

Una tienda ajena responde 404, igual que una tienda inexistente, para no revelar qué datos existen.

## Desarrollo local

Requisitos: Node 22+, pnpm, Docker.

```bash
cp .env.example .env          # ajustar PLATFORM_ADMIN_PASSWORD
pnpm install
pnpm db:up                    # PostgreSQL en :5432 y Mailpit en :8025
pnpm --filter @commerce-core/api db:migrate
pnpm --filter @commerce-core/api db:seed
pnpm dev:api                  # API en :3000 (o PORT=...)
pnpm dev:web                  # web en :5173, proxy a la API con API_URL
```

Si el puerto 3000 está ocupado, levantar la API en otro puerto y apuntar la web con `API_URL=http://localhost:3100 pnpm dev:web`.

## Stack completo con Docker

```bash
docker compose up -d --build
```

- Web y API: http://localhost:8090 (`WEB_PORT` lo cambia)
- Documentación interactiva: http://localhost:8090/docs
- Correo de prueba (invitaciones y reseteos): http://localhost:8025

El administrador general se crea con `PLATFORM_ADMIN_EMAIL` y `PLATFORM_ADMIN_PASSWORD` del `.env`.

## Roles de base de datos

- `commerce` (superusuario): solo administra la instancia.
- `commerce_api`: rol con el que corren la API y las migraciones. No es superusuario y no salta RLS. Es dueño de la base y de sus tablas.
- `commerce_app`: rol sin login. La API lo asume en cada transacción de tienda (`SET LOCAL ROLE`), así las políticas RLS siempre se aplican.

`infra/postgres/01-roles.sql` crea los roles en un volumen nuevo. En un volumen existente hay que aplicarlo a mano y reasignar la propiedad de las tablas (ver ADR 0005). En producción la API no arranca si su rol es superusuario o tiene BYPASSRLS.

## Variables de seguridad

| Variable                      | Default | Qué controla                                                    |
| ----------------------------- | ------- | --------------------------------------------------------------- |
| `TRUST_PROXY`                 | `0`     | Saltos de proxy de confianza para la IP del cliente (nginx = 1) |
| `LOGIN_MAX_FAILURES`          | `5`     | Intentos fallidos antes de bloquear el email                    |
| `LOGIN_LOCK_MINUTES`          | `15`    | Duración del bloqueo                                            |
| `ORDER_PENDING_TTL_HOURS`     | `48`    | Pedidos pendientes que se cancelan solos y devuelven stock      |
| `IDEMPOTENCY_RETENTION_HOURS` | `24`    | Retención de claves de `Idempotency-Key`                        |
| `JOB_INTERVAL_SECONDS`        | `5`     | Frecuencia del worker (emails, expiración, limpieza)            |

## Datos de demo

`pnpm --filter @commerce-core/api db:seed:demo` carga tres clientes completos: equipo con roles propios, catálogo con categorías archivadas y productos agotados, pedidos en todos los estados, movimientos de stock que cierran con el saldo, invitaciones pendientes y vencidas, y auditoría.

| Tienda                      | Propietario                  | Contraseña         |
| --------------------------- | ---------------------------- | ------------------ |
| Casa Roble (ARS)            | `lucia@casa-roble.example`   | `demo-owner-123`   |
| Taller Lino (USD)           | `mateo@taller-lino.example`  | `demo-cliente-123` |
| Panadería Dulce Trigo (ARS) | `renata@dulce-trigo.example` | `demo-cliente-123` |

Todo el staff de las tres tiendas usa `demo-cliente-123`. Todas las contraseñas son **solo para desarrollo**: están en `apps/api/src/db/seed-demo.ts` y son públicas.

## Scripts

| Script               | Qué hace                                                   |
| -------------------- | ---------------------------------------------------------- |
| `pnpm lint`          | ESLint con reglas estrictas de TypeScript                  |
| `pnpm format:check`  | Verifica formato con Prettier                              |
| `pnpm typecheck`     | Typecheck de todos los paquetes                            |
| `pnpm test`          | Tests de integración de la API                             |
| `pnpm openapi:check` | Falla si `apps/api/openapi.json` no coincide con las rutas |
| `pnpm e2e`           | Flujo completo en navegador                                |

Para el E2E: `pnpm e2e` levanta la API y la web si no están corriendo. Contra un stack ya levantado (por ejemplo Docker): `E2E_BASE_URL=http://localhost:8090 pnpm e2e`.

## Decisiones

- [ADR 0001: Aislamiento por tienda con RLS](docs/adr/0001-tenancy-rls.md)
- [ADR 0002: Sesiones opacas en lugar de JWT](docs/adr/0002-sesiones-opacas.md)
- [ADR 0003: Stock como ledger y descuento al crear el pedido](docs/adr/0003-stock-ledger.md)
- [ADR 0004: Emails por outbox transaccional](docs/adr/0004-outbox-emails.md)
- [ADR 0005: Decisiones de seguridad](docs/adr/0005-seguridad.md)
- [ADR 0006: Decisiones de negocio](docs/adr/0006-negocio.md)

## Fuera de v1

Variantes de producto (talle, color), pagos y facturación, SSR para SEO del storefront, dominios propios por tienda, planes y cobro, límites de empleados por plan, precios multi-moneda por producto, 2FA, proveedor de email real y transferencia de propietario desde la UI.
