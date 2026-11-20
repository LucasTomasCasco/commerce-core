import { useMutation, useSuspenseQuery } from "@tanstack/react-query";
import { api, unwrap } from "../api/client.js";
import { Alert, Badge, Button, Table, formatDate } from "./ui.js";
import { errorText } from "../pages/catalog-pages.js";

// Invitaciones aún pendientes de la tienda: se pueden reenviar (invalida el enlace anterior) o revocar.
export function InvitationsSection({
  storeId,
  canManage,
  onChange,
}: {
  storeId: string;
  canManage: boolean;
  onChange: () => Promise<unknown>;
}) {
  const invitations = useSuspenseQuery({
    queryKey: ["invitations", storeId],
    queryFn: () =>
      unwrap(api.GET("/api/v1/stores/{storeId}/invitations", { params: { path: { storeId } } })),
  });
  const revoke = useMutation({
    mutationFn: (invitationId: string) =>
      unwrap(
        api.DELETE("/api/v1/stores/{storeId}/invitations/{invitationId}", {
          params: { path: { storeId, invitationId } },
        }),
      ),
    onSuccess: onChange,
  });
  const resend = useMutation({
    mutationFn: (invitationId: string) =>
      unwrap(
        api.POST("/api/v1/stores/{storeId}/invitations/{invitationId}/resend", {
          params: { path: { storeId, invitationId } },
        }),
      ),
    onSuccess: onChange,
  });

  if (invitations.data.invitations.length === 0) return null;

  return (
    <section className="flex flex-col gap-3">
      <h2 className="font-semibold">Invitaciones pendientes</h2>
      <Table headers={["Email", "Rol", "Vence", ""]}>
        {invitations.data.invitations.map((inv) => {
          const expired = new Date(inv.expiresAt) < new Date();
          return (
            <tr key={inv.id}>
              <td className="px-4 py-2.5">{inv.email}</td>
              <td className="px-4 py-2.5">{inv.roleName}</td>
              <td className="px-4 py-2.5">
                {expired ? (
                  <Badge tone="bad">Vencida</Badge>
                ) : (
                  <span className="text-xs text-slate-500">{formatDate(inv.expiresAt)}</span>
                )}
              </td>
              <td className="flex gap-2 px-4 py-2.5">
                {canManage && (
                  <>
                    <Button
                      variant="secondary"
                      onClick={() => {
                        resend.mutate(inv.id);
                      }}
                    >
                      Reenviar
                    </Button>
                    <Button
                      variant="danger"
                      onClick={() => {
                        revoke.mutate(inv.id);
                      }}
                    >
                      Revocar
                    </Button>
                  </>
                )}
              </td>
            </tr>
          );
        })}
      </Table>
      {(revoke.error || resend.error) && <Alert>{errorText(revoke.error ?? resend.error)}</Alert>}
    </section>
  );
}
