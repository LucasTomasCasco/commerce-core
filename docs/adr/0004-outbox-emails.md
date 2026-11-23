# ADR 0004: Emails por outbox transaccional

**Estado:** aceptada

## Contexto

Crear una tienda o invitar staff confirma una transacción y después envía un email. Si el SMTP falla después del commit, el cliente recibía un 500 aunque la tienda ya existía, y al reintentar aparecía un error de duplicado.

## Decisión

- El email se escribe en la tabla `outbox_emails` dentro de la misma transacción que la acción. Si la acción se revierte, el email no existe.
- Un worker (`jobs/worker.ts`) envía los pendientes con reintentos y backoff exponencial. Tras 5 intentos el email queda en `failed` para revisión manual.
- La tabla no tiene RLS: no pertenece a una tienda y el worker necesita verla completa.

## Consecuencias

- Un SMTP caído no rompe altas ni invitaciones; los emails salen cuando el SMTP vuelve.
- Entrega "al menos una vez": un proceso que cae después de enviar y antes de marcar `sent` puede reenviar. Para invitaciones un duplicado es inocuo porque cada token es de un solo uso y el reenvío revoca el anterior.
- El worker corre dentro del proceso de la API. Con varias réplicas, `processOutbox` toma las filas con `FOR UPDATE SKIP LOCKED` dentro de una transacción: cada email lo procesa un solo proceso. La transacción sostiene el lock mientras envía el lote (20 emails por defecto), así que el tiempo que dura es acotado.
