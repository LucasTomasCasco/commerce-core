import type { Tx } from "../db/client.js";
import { auditLogs } from "../db/schema/index.js";

export type AuditEntry = {
  storeId: string;
  actorUserId: string;
  action: string;
  entity: string;
  entityId: string;
  metadata?: Record<string, unknown>;
};

// Se llama dentro de la misma transacción que la acción auditada: si la acción falla, no queda registro.
export async function recordAudit(tx: Tx, entry: AuditEntry): Promise<void> {
  await tx.insert(auditLogs).values({ ...entry, metadata: entry.metadata ?? {} });
}
