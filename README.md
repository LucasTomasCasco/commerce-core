# Commerce Core

Backend y panel multi-tienda para comercios pequeños: catálogo, stock, pedidos y equipo con permisos por tienda.

## Requisitos

- Node.js 22+
- pnpm
- Docker

## Desarrollo local

```bash
cp .env.example .env
pnpm install
pnpm db:up        # PostgreSQL en :5432 y Mailpit en :8025
pnpm dev:api      # API en :3000
pnpm dev:web      # Web en :5173
```

## Scripts

| Script              | Qué hace                                  |
| ------------------- | ----------------------------------------- |
| `pnpm lint`         | ESLint con reglas estrictas de TypeScript |
| `pnpm format:check` | Verifica formato con Prettier             |
| `pnpm typecheck`    | Verifica tipos en todos los paquetes      |
| `pnpm test`         | Tests de todos los paquetes               |
