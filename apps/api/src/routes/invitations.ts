import type { FastifyPluginCallbackZod } from "fastify-type-provider-zod";
import { z } from "zod";
import type { Env } from "../config/env.js";
import { passwordSchema } from "../http/schemas.js";
import { optionalSession, sessionCookieOptions, SESSION_COOKIE } from "../http/session.js";

// El token viaja en el body, nunca en la URL: las URLs quedan en logs de proxies y del servidor.
const tokenBody = z.object({ token: z.string().min(1).max(200) });

export function invitationRoutes(env: Env): FastifyPluginCallbackZod {
  return (app, _options, done) => {
    const rateLimit = { max: env.AUTH_RATE_LIMIT_MAX, timeWindow: "15 minutes" };
    const service = app.services.invitations;

    app.post(
      "/invitations/preview",
      {
        config: { rateLimit },
        schema: {
          tags: ["team"],
          summary: "Datos de una invitación pendiente",
          body: tokenBody,
          response: {
            200: z.object({
              email: z.email(),
              storeName: z.string(),
              roleName: z.string(),
              accountExists: z.boolean(),
            }),
          },
        },
      },
      (request) => service.preview(request.body.token),
    );

    app.post(
      "/invitations/accept",
      {
        config: { rateLimit },
        preValidation: optionalSession(app.services.auth),
        schema: {
          tags: ["team"],
          summary: "Aceptar una invitación",
          body: tokenBody.extend({
            fullName: z.string().trim().min(1).max(120).optional(),
            password: passwordSchema.optional(),
          }),
          response: { 200: z.object({ storeId: z.uuid() }) },
        },
      },
      async (request, reply) => {
        const { storeId, sessionToken } = await service.accept(request.body.token, {
          sessionUser: request.auth?.user ?? null,
          fullName: request.body.fullName,
          password: request.body.password,
        });
        if (sessionToken) {
          reply.setCookie(SESSION_COOKIE, sessionToken, sessionCookieOptions(env));
        }
        return { storeId };
      },
    );

    done();
  };
}
