# ADR 0003: Stock como ledger y descuento al crear el pedido

**Estado:** aceptada

## Contexto

El stock de un producto tiene que ser auditable y no puede quedar negativo, incluso con pedidos concurrentes sobre el mismo producto.

## Decisión

- `products.stock_on_hand` es un saldo cacheado. Cada cambio queda como fila en `stock_movements` (entrada, venta, devolución por cancelación, ajuste).
- Todo cambio de stock pasa por una única función, `applyStockChange`, que actualiza el saldo y registra el movimiento en la misma transacción. Un `UPDATE ... WHERE stock + delta >= 0` impide quedar negativo. Un CHECK en la base es la red de seguridad.
- El invariante `stock_on_hand = SUM(quantity_delta)` se comprueba en los tests después de cada operación.
- El stock se descuenta al crear el pedido y se devuelve al cancelarlo. Los ítems se bloquean en orden fijo de producto para evitar deadlocks.
- Los pedidos guardan snapshots de SKU, nombre y precio. Cambiar el catálogo no altera pedidos existentes.

## Consecuencias

- Los pedidos de una misma tienda se serializan en el contador `order_seq` de la tienda. Es un costo aceptable para comercios pequeños.
- Una cancelación no borra nada: deja el pedido en `cancelled` y agrega movimientos de devolución.
- La prueba de concurrencia (10 pedidos en paralelo sobre stock 5) demuestra que nunca se vende más de lo disponible.
