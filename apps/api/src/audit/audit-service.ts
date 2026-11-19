import { count, desc, eq } from "drizzle-orm";
import type { Db } from "../db/client.js";
import { withDbContext } from "../db/tenant.js";
import { auditLogs, users } from "../db/schema/index.js";

export type AuditServiceDeps = { db: Db };

export function createAuditService({ db }: AuditServiceDeps) {
  async function listEntries(input: { storeId: string; limit: number; offset: number }) {
    const where = eq(auditLogs.storeId, input.storeId);
    const [items, [total]] = await withDbContext(db, { storeId: input.storeId }, (tx) =>
      Promise.all([
        tx
          .select({
            id: auditLogs.id,
            action: auditLogs.action,
            entity: auditLogs.entity,
            entityId: auditLogs.entityId,
            metadata: auditLogs.metadata,
            createdAt: auditLogs.createdAt,
            actorUserId: auditLogs.actorUserId,
            actorEmail: users.email,
            actorName: users.fullName,
          })
          .from(auditLogs)
          .innerJoin(users, eq(users.id, auditLogs.actorUserId))
          .where(where)
          .orderBy(desc(auditLogs.createdAt))
          .limit(input.limit)
          .offset(input.offset),
        tx.select({ total: count() }).from(auditLogs).where(where),
      ]),
    );
    return { items, total: total?.total ?? 0, limit: input.limit, offset: input.offset };
  }

  return { listEntries };
}

export type AuditService = ReturnType<typeof createAuditService>;
