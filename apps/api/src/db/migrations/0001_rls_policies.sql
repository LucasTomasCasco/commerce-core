-- Rol con el que la API ejecuta las transacciones de tienda (SET LOCAL ROLE).
-- NOBYPASSRLS: las políticas siempre se aplican a este rol.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'commerce_app') THEN
    CREATE ROLE commerce_app NOLOGIN NOBYPASSRLS;
  END IF;
END
$$;--> statement-breakpoint
-- El usuario que migra puede asumir el rol (superusuarios y dueños lo necesitan para SET ROLE).
DO $$
BEGIN
  EXECUTE format('GRANT commerce_app TO %I', current_user);
END
$$;--> statement-breakpoint
GRANT USAGE ON SCHEMA public TO commerce_app;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO commerce_app;--> statement-breakpoint
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO commerce_app;--> statement-breakpoint
-- Contexto de la transacción. Sin contexto, la función devuelve NULL y no coincide ninguna fila.
CREATE FUNCTION app_current_store_id() RETURNS uuid LANGUAGE sql STABLE AS $$
  SELECT nullif(current_setting('app.store_id', true), '')::uuid
$$;--> statement-breakpoint
CREATE FUNCTION app_current_user_id() RETURNS uuid LANGUAGE sql STABLE AS $$
  SELECT nullif(current_setting('app.user_id', true), '')::uuid
$$;--> statement-breakpoint
ALTER TABLE store_roles ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE store_roles FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY store_roles_tenant ON store_roles
  USING (store_id = app_current_store_id())
  WITH CHECK (store_id = app_current_store_id());--> statement-breakpoint
ALTER TABLE store_members ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE store_members FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY store_members_tenant ON store_members
  USING (store_id = app_current_store_id())
  WITH CHECK (store_id = app_current_store_id());--> statement-breakpoint
-- Un usuario puede leer sus propias membresías en cualquier tienda (listar "mis tiendas").
CREATE POLICY store_members_self_read ON store_members FOR SELECT
  USING (user_id = app_current_user_id());--> statement-breakpoint
ALTER TABLE categories ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE categories FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY categories_tenant ON categories
  USING (store_id = app_current_store_id())
  WITH CHECK (store_id = app_current_store_id());--> statement-breakpoint
ALTER TABLE products ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE products FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY products_tenant ON products
  USING (store_id = app_current_store_id())
  WITH CHECK (store_id = app_current_store_id());--> statement-breakpoint
ALTER TABLE orders ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE orders FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY orders_tenant ON orders
  USING (store_id = app_current_store_id())
  WITH CHECK (store_id = app_current_store_id());--> statement-breakpoint
ALTER TABLE order_items ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE order_items FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY order_items_tenant ON order_items
  USING (store_id = app_current_store_id())
  WITH CHECK (store_id = app_current_store_id());--> statement-breakpoint
ALTER TABLE stock_movements ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE stock_movements FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY stock_movements_tenant ON stock_movements
  USING (store_id = app_current_store_id())
  WITH CHECK (store_id = app_current_store_id());--> statement-breakpoint
ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE audit_logs FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY audit_logs_tenant ON audit_logs
  USING (store_id = app_current_store_id())
  WITH CHECK (store_id = app_current_store_id());--> statement-breakpoint
ALTER TABLE idempotency_keys ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE idempotency_keys FORCE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY idempotency_keys_tenant ON idempotency_keys
  USING (store_id = app_current_store_id())
  WITH CHECK (store_id = app_current_store_id());
