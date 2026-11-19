# ADR 0001: Aislamiento por tienda con RLS

**Estado:** aceptada

## Contexto

Varias tiendas comparten la misma base. Un error de filtrado en la aplicación no debe exponer datos de otra tienda.

## Decisión

- Todas las tablas de tienda tienen `store_id`. Las claves foráneas compuestas `(store_id, id)` impiden que una fila de una tienda apunte a datos de otra.
- Row-Level Security con `FORCE` en todas esas tablas. La política compara `store_id` con `app_current_store_id()`, que lee `app.store_id` de la transacción; sin contexto, no coincide ninguna fila.
- La API conecta como dueño del esquema y cada transacción de tienda ejecuta `SET LOCAL ROLE commerce_app`, un rol sin `BYPASSRLS`. Así las políticas se aplican también a la aplicación.
- Las tablas de plataforma (usuarios, sesiones, tiendas, monedas, invitaciones) no tienen RLS. Las invitaciones se buscan por hash del token antes de conocer la tienda.

## Consecuencias

- Los tests de RLS ejecutan SQL directo sin contexto y con otro contexto, y comprueban que no se filtran ni modifican filas ajenas.
- Un repositorio nuevo que toque tablas de tienda debe usar `withDbContext`. Un query sin contexto devuelve vacío, no datos de todas las tiendas.
- Una base por tienda o un esquema por tienda habrían multiplicado las migraciones y complicado el pool de conexiones.
