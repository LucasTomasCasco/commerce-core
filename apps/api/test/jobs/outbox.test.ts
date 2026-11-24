import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { outboxEmails } from "../../src/db/schema/index.js";
import { enqueueEmail, processOutbox } from "../../src/outbox/outbox.js";
import { buildTestApp } from "../support/app.js";
import { resetDb } from "../support/db.js";
import { seedCurrencies } from "../support/fixtures.js";
import {
  createPlatformAdminSession,
  onboardStore,
  type TestContext,
} from "../support/onboarding.js";

const MESSAGE = { to: "destino@example.com", subject: "Asunto", text: "Cuerpo" };

describe("outbox de emails", () => {
  let ctx: TestContext;

  beforeEach(async () => {
    ctx = await buildTestApp();
    await resetDb(ctx.db);
  });

  afterEach(async () => {
    await ctx.close();
  });

  it("un email encolado se envía una sola vez y queda marcado como enviado", async () => {
    await enqueueEmail(ctx.db, MESSAGE);
    const first = await processOutbox(ctx.db, ctx.mailer);
    const second = await processOutbox(ctx.db, ctx.mailer, {
      now: new Date(Date.now() + 86_400_000),
    });
    const [row] = await ctx.db.select().from(outboxEmails);

    expect(first).toBe(1);
    expect(second).toBe(0);
    expect(row?.status).toBe("sent");
    expect(ctx.sent).toHaveLength(1);
  });

  it("dos procesos a la vez no envían el mismo email dos veces", async () => {
    for (let i = 0; i < 5; i++)
      await enqueueEmail(ctx.db, { ...MESSAGE, subject: `Asunto ${String(i)}` });
    const sentBySlowMailer: string[] = [];
    const slowMailer = {
      send: async (message: { subject: string }) => {
        await new Promise((resolve) => setTimeout(resolve, 50));
        sentBySlowMailer.push(message.subject);
      },
    };

    // Un "ahora" futuro: el reloj de la base y el del proceso pueden diferir por milisegundos en CI.
    const now = new Date(Date.now() + 60_000);
    const [a, b] = await Promise.all([
      processOutbox(ctx.db, slowMailer, { now }),
      processOutbox(ctx.db, slowMailer, { now }),
    ]);

    expect(a + b).toBe(5);
    expect(new Set(sentBySlowMailer).size).toBe(5);
  });

  it("si el SMTP falla, reagenda con backoff y reintenta después", async () => {
    await enqueueEmail(ctx.db, MESSAGE);
    const failing = {
      send: () => Promise.reject(new Error("SMTP caído")),
    };
    const now = new Date();
    await processOutbox(ctx.db, failing, { now });
    const [afterFail] = await ctx.db.select().from(outboxEmails);

    expect(afterFail?.status).toBe("pending");
    expect(afterFail?.attempts).toBe(1);
    expect(afterFail?.lastError).toBe("SMTP caído");
    expect(afterFail?.nextAttemptAt.getTime()).toBeGreaterThan(now.getTime());

    const sent = await processOutbox(ctx.db, ctx.mailer, {
      now: new Date(now.getTime() + 60 * 60 * 1000),
    });
    expect(sent).toBe(1);
  });

  it("tras agotar los intentos el email queda como fallido para revisión manual", async () => {
    await enqueueEmail(ctx.db, MESSAGE);
    const failing = { send: () => Promise.reject(new Error("rebotó")) };
    let when = new Date();
    for (let i = 0; i < 5; i++) {
      await processOutbox(ctx.db, failing, { now: when });
      when = new Date(when.getTime() + 24 * 60 * 60 * 1000);
    }
    const [row] = await ctx.db.select().from(outboxEmails);

    expect(row?.status).toBe("failed");
    expect(row?.attempts).toBe(5);
  });

  it("si la transacción se revierte, el email no se encola", async () => {
    await expect(
      ctx.db.transaction(async (tx) => {
        await enqueueEmail(tx, MESSAGE);
        throw new Error("falla después de encolar");
      }),
    ).rejects.toThrow("falla después de encolar");
    const rows = await ctx.db.select().from(outboxEmails);

    expect(rows).toEqual([]);
  });

  it("crear una tienda no falla aunque el SMTP esté caído: el email queda pendiente", async () => {
    await seedCurrencies(ctx.db);
    const admin = await createPlatformAdminSession(ctx);
    const actor = await ctx.app.services.auth.getUserByToken(admin);
    // Llamada directa al servicio: sin HTTP el harness no procesa el outbox, así el email queda pendiente.
    await ctx.app.services.platform.createStore({
      actorUserId: actor?.id ?? "",
      name: "Tienda SMTP",
      slug: "tienda-smtp",
      currencyCode: "ARS",
      ownerEmail: "smtp@example.com",
    });

    const failing = { send: () => Promise.reject(new Error("SMTP caído")) };
    await processOutbox(ctx.db, failing);
    const [row] = await ctx.db
      .select()
      .from(outboxEmails)
      .where(eq(outboxEmails.recipient, "smtp@example.com"));

    expect(row?.status).toBe("pending");
    expect(row?.lastError).toBe("SMTP caído");
  });

  it("la invitación de un staff se encola en la misma transacción y llega al destinatario", async () => {
    await seedCurrencies(ctx.db);
    const admin = await createPlatformAdminSession(ctx);
    const onboarded = await onboardStore(ctx, {
      adminToken: admin,
      slug: "tienda-cola",
      ownerEmail: "cola@example.com",
    });
    const emails = await ctx.db.select().from(outboxEmails);

    expect(onboarded.store.id).toBeTruthy();
    expect(emails.every((e) => e.status === "sent")).toBe(true);
    expect(ctx.sent.map((m) => m.to)).toContain("cola@example.com");
  });
});
