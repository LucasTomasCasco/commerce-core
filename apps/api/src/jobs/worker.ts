import type { Mailer } from "../auth/mailer.js";
import type { Db } from "../db/client.js";
import { processOutbox } from "../outbox/outbox.js";
import { cleanupIdempotencyKeys, expireStalePendingOrders } from "./maintenance.js";

export type JobDeps = {
  db: Db;
  mailer: Mailer;
  orderPendingTtlHours: number;
  idempotencyRetentionHours: number;
};

// Una pasada de todos los jobs. Cada uno es independiente: si uno falla, los demás igual corren.
export async function runJobs(deps: JobDeps, now: Date = new Date()) {
  const results = {
    emailsSent: 0,
    ordersExpired: 0,
    keysDeleted: 0,
  };
  results.emailsSent = await processOutbox(deps.db, deps.mailer, { now });
  results.ordersExpired = await expireStalePendingOrders(deps.db, {
    now,
    ttlHours: deps.orderPendingTtlHours,
  });
  results.keysDeleted = await cleanupIdempotencyKeys(deps.db, {
    now,
    retentionHours: deps.idempotencyRetentionHours,
  });
  return results;
}

export function startWorker(
  deps: JobDeps & { intervalMs: number; onError: (error: unknown) => void },
): () => void {
  let running = false;
  const timer = setInterval(() => {
    if (running) return;
    running = true;
    runJobs(deps)
      .catch((error: unknown) => {
        deps.onError(error);
      })
      .finally(() => {
        running = false;
      });
  }, deps.intervalMs);
  return () => {
    clearInterval(timer);
  };
}
