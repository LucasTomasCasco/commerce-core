import { and, asc, eq, lte } from "drizzle-orm";
import type { Mailer, MailMessage } from "../auth/mailer.js";
import type { Db, Tx } from "../db/client.js";
import { outboxEmails } from "../db/schema/index.js";

const MAX_ATTEMPTS = 5;

// Se llama dentro de la transacción que origina el email: si la acción se revierte, el email no sale.
export async function enqueueEmail(executor: Db | Tx, message: MailMessage): Promise<void> {
  await executor.insert(outboxEmails).values({
    recipient: message.to,
    subject: message.subject,
    body: message.text,
  });
}

// Envía los emails pendientes. Cada fallo reagenda con backoff exponencial; al agotar los intentos
// queda en "failed" para revisión manual. Devuelve cuántos se enviaron.
// Las filas quedan bloqueadas hasta el commit y SKIP LOCKED saltea las que ya toma otro proceso:
// con varias réplicas, cada email sale una sola vez.
export async function processOutbox(
  db: Db,
  mailer: Mailer,
  options: { now?: Date; batchSize?: number } = {},
): Promise<number> {
  const now = options.now ?? new Date();
  return db.transaction(async (tx) => {
    const due = await tx
      .select()
      .from(outboxEmails)
      .where(and(eq(outboxEmails.status, "pending"), lte(outboxEmails.nextAttemptAt, now)))
      .orderBy(asc(outboxEmails.createdAt))
      .limit(options.batchSize ?? 20)
      .for("update", { skipLocked: true });

    let sent = 0;
    for (const email of due) {
      try {
        await mailer.send({ to: email.recipient, subject: email.subject, text: email.body });
        await tx
          .update(outboxEmails)
          .set({ status: "sent", sentAt: new Date(), attempts: email.attempts + 1 })
          .where(eq(outboxEmails.id, email.id));
        sent += 1;
      } catch (error) {
        const attempts = email.attempts + 1;
        const backoffMinutes = 2 ** attempts;
        await tx
          .update(outboxEmails)
          .set({
            attempts,
            lastError: error instanceof Error ? error.message : String(error),
            status: attempts >= MAX_ATTEMPTS ? "failed" : "pending",
            nextAttemptAt: new Date(now.getTime() + backoffMinutes * 60 * 1000),
          })
          .where(eq(outboxEmails.id, email.id));
      }
    }
    return sent;
  });
}
