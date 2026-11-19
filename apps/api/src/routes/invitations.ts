import type { FastifyPluginCallbackZod } from "fastify-type-provider-zod";
import { z } from "zod";
import { sessionCookieOptions, SESSION_COOKIE, optionalSession } from "../http/session.js";
import type { Env } from "../config/env.js";

const tokenParams = z.object({ token: z.string().min(1) });

export function invitationRoutes(env: Env): FastifyPluginCallbackZod {
  return (app, _options, done) => {
    const rateLimit = { max: env.AUTH_RATE_LIMIT_MAX, timeWindow: "15 minutes" };
    const service = app.services.invitations;

    app.get(
      "/invitations/:token",
      {
        config: { rateLimit },
        schema: {
          tags: ["team"],
          summary: "Datos de una invitación pendiente",
          params: tokenParams,
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
      (request) => service.preview(request.params.token),
    );

    app.post(
      "/invitations/:token/accept",
      {
        config: { rateLimit },
        preHandler: optionalSession(app.services.auth),
        schema: {
          tags: ["team"],
          summary: "Aceptar una invitación",
          params: tokenParams,
          body: z.object({
            fullName: z.string().trim().min(1).max(120).optional(),
            password: z.string().min(10).max(200).optional(),
          }),
          response: { 200: z.object({ storeId: z.uuid() }) },
        },
      },
      async (request, reply) => {
        const { storeId, sessionToken } = await service.accept(request.params.token, {
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
