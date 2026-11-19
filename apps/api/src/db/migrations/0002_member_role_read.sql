-- Un usuario puede leer los roles de sus propias membresías (para listar "mis tiendas").
CREATE POLICY store_roles_member_read ON store_roles FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM store_members m
    WHERE m.role_id = store_roles.id AND m.user_id = app_current_user_id()
  ));
