import type { buildTestApp } from "./app.js";
import { createLoginUser } from "./fixtures.js";
import { users } from "../../src/db/schema/index.js";
import { eq } from "drizzle-orm";

export type TestContext = Awaited<ReturnType<typeof buildTestApp>>;

export const PASSWORD = "clave-segura-123";
export const PLATFORM_ADMIN_EMAIL = "admin@plataforma.example";

// Extrae el token de un email de invitación o de reseteo.
export function tokenFrom(text: string | undefined): string {
  const token = /token=([\w-]+)/.exec(text ?? "")?.[1];
  if (!token) throw new Error("El email no trae token");
  return token;
}

export async function createPlatformAdminSession(ctx: TestContext): Promise<string> {
  const [existing] = await ctx.db
    .select()
    .from(users)
    .where(eq(users.email, PLATFORM_ADMIN_EMAIL))
    .limit(1);
  if (!existing) {
    const admin = await createLoginUser(ctx.db, PLATFORM_ADMIN_EMAIL, PASSWORD);
    await ctx.db
      .update(users)
      .set({ platformRole: "platform_admin" })
      .where(eq(users.id, admin.id));
  }
  const { token } = await ctx.app.services.auth.login(PLATFORM_ADMIN_EMAIL, PASSWORD);
  return token;
}

// Alta completa por la API: el admin crea la tienda y el owner acepta la invitación por email.
export async function onboardStore(
  ctx: TestContext,
  input: { adminToken: string; slug: string; ownerEmail: string; name?: string },
) {
  const create = await ctx.app.inject({
    method: "POST",
    url: "/api/v1/platform/stores",
    cookies: { cc_session: input.adminToken },
    payload: {
      name: input.name ?? `Tienda ${input.slug}`,
      slug: input.slug,
      currencyCode: "ARS",
      ownerEmail: input.ownerEmail,
    },
  });
  if (create.statusCode !== 201) throw new Error(`No se creó la tienda: ${create.body}`);
  const store = create.json<{ id: string; slug: string; name: string }>();

  const invitation = ctx.sent.findLast((m) => m.to === input.ownerEmail);
  const accept = await ctx.app.inject({
    method: "POST",
    url: "/api/v1/invitations/accept",
    payload: {
      token: tokenFrom(invitation?.text),
      fullName: "Dueña de prueba",
      password: PASSWORD,
    },
  });
  if (accept.statusCode !== 200) throw new Error(`No se aceptó la invitación: ${accept.body}`);
  const ownerToken = accept.cookies.find((c) => c.name === "cc_session")?.value;
  if (!ownerToken) throw new Error("La aceptación no devolvió sesión");

  return { store, ownerToken };
}
