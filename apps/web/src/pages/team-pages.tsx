import { Pager } from "../components/ui.js";
import { InvitationsSection } from "../components/invitations-section.js";
import { useMutation, useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { useState, type SyntheticEvent } from "react";
import { api, unwrap } from "../api/client.js";
import {
  Alert,
  Badge,
  Button,
  Card,
  Empty,
  Field,
  Input,
  Select,
  Table,
  formatDate,
} from "../components/ui.js";
import { useStore } from "../store/store-context.js";
import { errorText } from "./catalog-pages.js";

// Catálogo de permisos de la API. La validación real la hace el servidor.
const AUDIT_PAGE_SIZE = 25;

const PERMISSION_LABELS = {
  "products:read": "Ver productos",
  "products:manage": "Administrar productos",
  "categories:manage": "Administrar categorías",
  "stock:read": "Ver stock",
  "stock:adjust": "Registrar stock y ajustes",
  "orders:read": "Ver pedidos",
  "orders:create": "Cargar pedidos",
  "orders:update_status": "Confirmar y entregar pedidos",
  "orders:cancel": "Cancelar pedidos",
  "team:manage": "Administrar equipo y roles",
  "store:settings": "Editar datos de la tienda",
  "audit:read": "Ver auditoría",
} as const;

type Permission = keyof typeof PERMISSION_LABELS;

type Role = { id: string; name: string; permissions: Permission[]; isSystem: boolean };

export function TeamPage() {
  const { storeId, can } = useStore();
  const queryClient = useQueryClient();
  const members = useSuspenseQuery({
    queryKey: ["members", storeId],
    queryFn: () =>
      unwrap(api.GET("/api/v1/stores/{storeId}/members", { params: { path: { storeId } } })),
  });
  const roles = useSuspenseQuery({
    queryKey: ["roles", storeId],
    queryFn: () =>
      unwrap(api.GET("/api/v1/stores/{storeId}/roles", { params: { path: { storeId } } })),
  });
  const refresh = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: ["invitations", storeId] }),
      queryClient.invalidateQueries({ queryKey: ["members", storeId] }),
      queryClient.invalidateQueries({ queryKey: ["roles", storeId] }),
    ]);

  const changeRole = useMutation({
    mutationFn: ({ memberId, roleId }: { memberId: string; roleId: string }) =>
      unwrap(
        api.PATCH("/api/v1/stores/{storeId}/members/{memberId}", {
          params: { path: { storeId, memberId } },
          body: { roleId },
        }),
      ),
    onSuccess: refresh,
  });
  const removeMember = useMutation({
    mutationFn: (memberId: string) =>
      unwrap(
        api.DELETE("/api/v1/stores/{storeId}/members/{memberId}", {
          params: { path: { storeId, memberId } },
        }),
      ),
    onSuccess: refresh,
  });
  const deleteRole = useMutation({
    mutationFn: (roleId: string) =>
      unwrap(
        api.DELETE("/api/v1/stores/{storeId}/roles/{roleId}", {
          params: { path: { storeId, roleId } },
        }),
      ),
    onSuccess: refresh,
  });
  const assignable = roles.data.roles.filter((r) => !r.isSystem);

  return (
    <div className="flex flex-col gap-8">
      <section className="flex flex-col gap-3">
        <h2 className="font-semibold">Miembros</h2>
        <Table headers={["Nombre", "Email", "Rol", "Desde", ""]}>
          {members.data.members.map((m) => (
            <tr key={m.id}>
              <td className="px-4 py-2.5">
                {m.fullName} {m.isOwner && <Badge tone="good">Propietario</Badge>}
              </td>
              <td className="px-4 py-2.5">{m.email}</td>
              <td className="px-4 py-2.5">
                {m.isOwner || !can("team:manage") ? (
                  m.roleName
                ) : (
                  <Select
                    value={m.roleId}
                    onChange={(e) => {
                      changeRole.mutate({ memberId: m.id, roleId: e.target.value });
                    }}
                  >
                    {assignable.map((r) => (
                      <option key={r.id} value={r.id}>
                        {r.name}
                      </option>
                    ))}
                  </Select>
                )}
              </td>
              <td className="px-4 py-2.5 text-xs text-fg-muted">{formatDate(m.createdAt)}</td>
              <td className="px-4 py-2.5">
                {!m.isOwner && can("team:manage") && (
                  <Button
                    size="sm"
                    variant="danger"
                    onClick={() => {
                      removeMember.mutate(m.id);
                    }}
                  >
                    Quitar
                  </Button>
                )}
              </td>
            </tr>
          ))}
        </Table>
        {(changeRole.error || removeMember.error) && (
          <Alert>{errorText(changeRole.error ?? removeMember.error)}</Alert>
        )}
      </section>

      <InvitationsSection storeId={storeId} canManage={can("team:manage")} onChange={refresh} />
      {can("team:manage") && <InviteForm storeId={storeId} roles={assignable} onDone={refresh} />}

      <section className="grid gap-6 lg:grid-cols-[1fr_360px]">
        <div className="flex flex-col gap-3">
          <h2 className="font-semibold">Roles</h2>
          {roles.data.roles.length === 0 ? (
            <Empty>No hay roles.</Empty>
          ) : (
            <Table headers={["Rol", "Permisos", ""]}>
              {roles.data.roles.map((r) => (
                <tr key={r.id} className="align-top">
                  <td className="px-4 py-2.5 font-medium">
                    {r.name} {r.isSystem && <Badge>Sistema</Badge>}
                  </td>
                  <td className="px-4 py-2.5 text-xs text-fg-muted">
                    {r.isSystem
                      ? "Todos los permisos"
                      : r.permissions.map((p) => PERMISSION_LABELS[p]).join(" · ")}
                  </td>
                  <td className="px-4 py-2.5">
                    {!r.isSystem && can("team:manage") && (
                      <Button
                        size="sm"
                        variant="danger"
                        onClick={() => {
                          deleteRole.mutate(r.id);
                        }}
                      >
                        Eliminar
                      </Button>
                    )}
                  </td>
                </tr>
              ))}
            </Table>
          )}
          {deleteRole.error && <Alert>{errorText(deleteRole.error)}</Alert>}
        </div>
        {can("team:manage") && (
          <RoleForm storeId={storeId} roles={roles.data.roles} onDone={refresh} />
        )}
      </section>
    </div>
  );
}

function InviteForm({
  storeId,
  roles,
  onDone,
}: {
  storeId: string;
  roles: Role[];
  onDone: () => Promise<unknown>;
}) {
  const [email, setEmail] = useState("");
  const [roleId, setRoleId] = useState(roles[0]?.id ?? "");
  const [sent, setSent] = useState(false);
  const invite = useMutation({
    mutationFn: () =>
      unwrap(
        api.POST("/api/v1/stores/{storeId}/invitations", {
          params: { path: { storeId } },
          body: { email, roleId },
        }),
      ),
    onSuccess: async () => {
      setSent(true);
      setEmail("");
      await onDone();
    },
  });

  return (
    <Card>
      <h2 className="mb-3 font-semibold">Invitar a un miembro del equipo</h2>
      <form
        className="flex flex-wrap items-end gap-3"
        onSubmit={(e: SyntheticEvent) => {
          e.preventDefault();
          setSent(false);
          invite.mutate();
        }}
      >
        <Field label="Email">
          <Input
            type="email"
            required
            value={email}
            onChange={(e) => {
              setEmail(e.target.value);
            }}
          />
        </Field>
        <Field label="Rol">
          <Select
            value={roleId}
            onChange={(e) => {
              setRoleId(e.target.value);
            }}
          >
            {roles.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
              </option>
            ))}
          </Select>
        </Field>
        <Button type="submit" disabled={invite.isPending || !roleId}>
          Enviar invitación
        </Button>
        {sent && <Alert tone="info">Invitación enviada.</Alert>}
        {invite.error && <Alert>{errorText(invite.error)}</Alert>}
      </form>
    </Card>
  );
}

// Crea un rol nuevo o edita los permisos de uno existente (los roles de sistema no se editan).
function RoleForm({
  storeId,
  roles,
  onDone,
}: {
  storeId: string;
  roles: Role[];
  onDone: () => Promise<unknown>;
}) {
  const editable = roles.filter((r) => !r.isSystem);
  const [selectedId, setSelectedId] = useState("");
  const selected = editable.find((r) => r.id === selectedId);
  const [name, setName] = useState("");
  const [permissions, setPermissions] = useState<Permission[]>([]);

  const save = useMutation({
    mutationFn: () => {
      const body = { name, permissions };
      if (selected) {
        return unwrap(
          api.PATCH("/api/v1/stores/{storeId}/roles/{roleId}", {
            params: { path: { storeId, roleId: selected.id } },
            body,
          }),
        );
      }
      return unwrap(
        api.POST("/api/v1/stores/{storeId}/roles", { params: { path: { storeId } }, body }),
      );
    },
    onSuccess: async () => {
      setSelectedId("");
      setName("");
      setPermissions([]);
      await onDone();
    },
  });

  function pick(id: string) {
    setSelectedId(id);
    const role = editable.find((r) => r.id === id);
    setName(role?.name ?? "");
    setPermissions(role?.permissions ?? []);
  }

  function toggle(permission: Permission) {
    setPermissions((current) =>
      current.includes(permission)
        ? current.filter((p) => p !== permission)
        : [...current, permission],
    );
  }

  return (
    <Card className="h-fit">
      <h2 className="mb-3 font-semibold">{selected ? "Editar rol" : "Nuevo rol"}</h2>
      <form
        className="flex flex-col gap-3"
        onSubmit={(e: SyntheticEvent) => {
          e.preventDefault();
          save.mutate();
        }}
      >
        {editable.length > 0 && (
          <Field label="Rol existente">
            <Select
              value={selectedId}
              onChange={(e) => {
                pick(e.target.value);
              }}
            >
              <option value="">Crear uno nuevo</option>
              {editable.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name}
                </option>
              ))}
            </Select>
          </Field>
        )}
        <Field label="Nombre">
          <Input
            required
            value={name}
            onChange={(e) => {
              setName(e.target.value);
            }}
          />
        </Field>
        <fieldset className="flex flex-col gap-1.5">
          <legend className="mb-1 text-sm font-medium text-fg">Permisos</legend>
          {(Object.entries(PERMISSION_LABELS) as [Permission, string][]).map(([key, label]) => (
            <label key={key} className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={permissions.includes(key)}
                onChange={() => {
                  toggle(key);
                }}
              />
              {label}
            </label>
          ))}
        </fieldset>
        {save.error && <Alert>{errorText(save.error)}</Alert>}
        <Button type="submit" disabled={save.isPending || permissions.length === 0}>
          {selected ? "Guardar rol" : "Crear rol"}
        </Button>
      </form>
    </Card>
  );
}

export function AuditPage() {
  const { storeId } = useStore();
  const [offset, setOffset] = useState(0);
  const audit = useSuspenseQuery({
    queryKey: ["audit", storeId, offset],
    queryFn: () =>
      unwrap(
        api.GET("/api/v1/stores/{storeId}/audit", {
          params: { path: { storeId }, query: { limit: AUDIT_PAGE_SIZE, offset } },
        }),
      ),
  });
  if (audit.data.items.length === 0) return <Empty>Todavía no hay actividad registrada.</Empty>;

  return (
    <div className="flex flex-col gap-4">
      <Table headers={["Fecha", "Quién", "Acción", "Entidad"]}>
        {audit.data.items.map((e) => (
          <tr key={e.id}>
            <td className="px-4 py-2.5 text-xs text-fg-muted">{formatDate(e.createdAt)}</td>
            <td className="px-4 py-2.5">{e.actorName}</td>
            <td className="px-4 py-2.5 font-mono text-xs">{e.action}</td>
            <td className="px-4 py-2.5 text-xs text-fg-muted">{e.entity}</td>
          </tr>
        ))}
      </Table>
      <Pager
        total={audit.data.total}
        limit={AUDIT_PAGE_SIZE}
        offset={offset}
        onChange={setOffset}
      />
    </div>
  );
}
