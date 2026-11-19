import type { FastifyPluginCallbackZod } from "fastify-type-provider-zod";
import { z } from "zod";
import {
  currentAuth,
  requireSession,
  SESSION_COOKIE,
  sessionCookieOptions,
} from "../http/session.js";
import type { Env } from "../config/env.js";

const PASSWORD_MIN_LENGTH = 10;

const userSchema = z.object({
  id: z.uuid(),
  email: z.email(),
  fullName: z.string(),
  isPlatformAdmin: z.boolean(),
});

const passwordSchema = z.string().min(PASSWORD_MIN_LENGTH).max(200);

export function authRoutes(env: Env): FastifyPluginCallbackZod {
  return (app, _options, done) => {
    const rateLimit = { max: env.AUTH_RATE_LIMIT_MAX, timeWindow: "15 minutes" };

    app.post(
      "/login",
      {
        config: { rateLimit },
        schema: {
          tags: ["auth"],
          summary: "Iniciar sesión",
          body: z.object({ email: z.email(), password: z.string().min(1) }),
          response: { 200: z.object({ user: userSchema }) },
        },
      },
      async (request, reply) => {
        const { user, token } = await app.services.auth.login(
          request.body.email,
          request.body.password,
        );
        reply.setCookie(SESSION_COOKIE, token, sessionCookieOptions(env));
        return { user };
      },
    );

    app.post(
      "/logout",
      {
        preHandler: requireSession(app.services.auth),
        schema: { tags: ["auth"], summary: "Cerrar sesión", response: { 204: z.null() } },
      },
      async (request, reply) => {
        await app.services.auth.logout(currentAuth(request).token);
        reply.clearCookie(SESSION_COOKIE, { path: "/" });
        return reply.code(204).send(null);
      },
    );

    app.get(
      "/me",
      {
        preHandler: requireSession(app.services.auth),
        schema: {
          tags: ["auth"],
          summary: "Usuario de la sesión actual",
          response: { 200: z.object({ user: userSchema }) },
        },
      },
      (request) => ({ user: currentAuth(request).user }),
    );

    app.post(
      "/forgot-password",
      {
        config: { rateLimit },
        schema: {
          tags: ["auth"],
          summary: "Pedir enlace para restablecer la contraseña",
          body: z.object({ email: z.email() }),
          response: { 202: z.null() },
        },
      },
      async (request, reply) => {
        await app.services.auth.requestPasswordReset(request.body.email);
        return reply.code(202).send(null);
      },
    );

    app.post(
      "/reset-password",
      {
        config: { rateLimit },
        schema: {
          tags: ["auth"],
          summary: "Elegir una nueva contraseña con el enlace recibido",
          body: z.object({ token: z.string().min(1), password: passwordSchema }),
          response: { 204: z.null() },
        },
      },
      async (request, reply) => {
        await app.services.auth.resetPassword(request.body.token, request.body.password);
        return reply.code(204).send(null);
      },
    );

    done();
  };
}
