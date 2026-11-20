# ADR 0006: Decisiones de negocio

**Estado:** aceptada

## Storefront y categorías archivadas

Archivar una categoría oculta sus productos del storefront público, sin tocar los datos del producto. Un producto sin categoría sigue visible. El staff ve el producto en el panel.

## Pedidos pendientes que vencen

Un pedido pendiente que no se confirma en `ORDER_PENDING_TTL_HOURS` (48 por defecto) se cancela automáticamente y devuelve su stock. Los pedidos confirmados nunca vencen. Así un abandono no bloquea inventario indefinidamente.

## Propiedad de la tienda

Una sola persona es propietaria. El administrador general puede transferir la propiedad: el nuevo propietario recibe una invitación; hasta que la acepte, la tienda sigue con el propietario actual. Al aceptar, el propietario anterior pasa al rol que se eligió y deja de administrar la tienda, pero conserva acceso. Una segunda transferencia revoca la pendiente.

## Limpieza de idempotencia

Las claves de `Idempotency-Key` se borran a las 24 horas. Pasado ese plazo, reusar la clave crea un pedido nuevo.

## Logout en todos los dispositivos

`POST /auth/logout-all` revoca todas las sesiones del usuario, incluida la actual.

## Lo que sigue abierto

- Cambio de email de la cuenta: no existe. Si el email del propietario deja de funcionar, la vía es la transferencia de propiedad por el administrador general.
- Multi-moneda por producto y límites por plan siguen fuera de v1.
