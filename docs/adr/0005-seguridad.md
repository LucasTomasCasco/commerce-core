# ADR 0005: Decisiones de seguridad

**Estado:** aceptada

## Tokens fuera de la URL

Los tokens de invitación viajan en el body de `POST /invitations/preview` y `POST /invitations/accept`. Las URLs se registran en logs de la API, de nginx y de cualquier proxy; un token en la URL quedaría expuesto. Los links de email siguen llevando `?token=` porque la pantalla de la web los lee; nginx registra solo la ruta sin query string.

Los tokens se guardan como hash SHA-256: una lectura de la base no permite aceptar invitaciones ni resetear contraseñas.

## Bloqueo por cuenta en base

Tras `LOGIN_MAX_FAILURES` intentos fallidos en 15 minutos, el email queda bloqueado `LOGIN_LOCK_MINUTES`. El contador vive en Postgres para que el bloqueo valga con varias réplicas, a diferencia del rate limit por IP que vive en memoria.

El bloqueo aplica igual exista o no la cuenta: no revela qué emails están registrados. El costo es que un atacante puede bloquear una cuenta conocida; se acepta porque el bloqueo es temporal y el reseteo por email sigue disponible.

## Proxy de confianza

`TRUST_PROXY` indica cuántos saltos de proxy confiar. Sin confianza, `X-Forwarded-For` se ignora: un cliente no puede falsificar su IP para saltarse el rate limit. Con nginx delante, el valor es 1.

## CSRF por Origin

La cookie es `SameSite=Lax`. Además, todo método que cambia estado con un `Origin` distinto de `APP_ORIGIN` se rechaza. Sin `Origin` (curl, servidor a servidor) se permite: un navegador siempre lo envía en requests cross-site.

## Autorización antes de validación

Los guards corren en `preValidation`. Un usuario sin permiso no recibe el detalle del schema de la ruta ni un 400 que revele el contrato.

## Guard de superusuario

En producción el arranque falla si la conexión es superusuario o tiene `BYPASSRLS`: esos roles saltan RLS aunque la tabla tenga `FORCE`.

## Política de contraseñas

Mínimo 10 caracteres, con letras y números, en alta por invitación y reseteo. Las contraseñas se hashean con Argon2id.

## Consecuencias

- Logout en todos los dispositivos revoca todas las sesiones del usuario.
- Un reseteo de contraseña revoca todas las sesiones.
- Un cambio de propiedad no revoca sesiones: el propietario anterior conserva acceso con su nuevo rol.
