# ADR 0002: Sesiones opacas en lugar de JWT

**Estado:** aceptada

## Contexto

La web es una SPA en el mismo sitio que la API. Hace falta cerrar sesión de verdad y revocar acceso al cambiar una contraseña o desactivar una cuenta.

## Decisión

- Token aleatorio de 32 bytes en una cookie `httpOnly`, `SameSite=Lax` y `Secure` en producción. En base se guarda solo su hash SHA-256.
- Logout, reseteo de contraseña y desactivación revocan la sesión al instante.
- Argon2id para contraseñas. Login y reseteo tienen rate limit. Si el email no existe, el login verifica igual contra un hash de referencia para no revelar cuentas.
- Web y API se sirven desde el mismo origen (proxy de Vite en desarrollo, nginx en Docker), así que no hace falta CORS.

## Consecuencias

- Cada request valida la sesión contra la base. Es un lookup adicional, aceptable para este volumen.
- Sin refresh tokens ni rotación: la sesión dura `SESSION_TTL_DAYS`.
- La documentación de Swagger funciona con la cookie de la sesión activa.
