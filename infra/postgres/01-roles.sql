-- Roles de la aplicación. Se ejecuta una vez al crear el volumen de Postgres.
-- commerce (superusuario) solo se usa para administrar la instancia.
-- commerce_api: rol con el que corre la API y las migraciones. No es superusuario y no salta RLS.
-- commerce_app: rol sin login que la API asume (SET LOCAL ROLE) en cada transacción de tienda.
CREATE ROLE commerce_app NOLOGIN NOBYPASSRLS;
CREATE ROLE commerce_api LOGIN NOSUPERUSER NOBYPASSRLS PASSWORD 'commerce_api';
GRANT commerce_app TO commerce_api;
ALTER DATABASE commerce_core OWNER TO commerce_api;
