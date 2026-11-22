import type { FastifyPluginCallbackZod } from "fastify-type-provider-zod";
import { z } from "zod";
import {
  currentAuth,
  requireSession,
  SESSION_COOKIE,
  sessionCookieOptions,
} from "../http/session.js";
import type { Env } from "../config/env.js";
import { passwordSchema } from "../http/schemas.js";

const userSchema = z.object({
  id: z.uuid(),
  email: z.email(),
  fullName: z.string(),
  isPlatformAdmin: z.boolean(),
  onboardingCompleted: z.boolean(),
});

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
        preValidation: requireSession(app.services.auth),
        schema: { tags: ["auth"], summary: "Cerrar sesión", response: { 204: z.null() } },
      },
      async (request, reply) => {
        await app.services.auth.logout(currentAuth(request).token);
        reply.clearCookie(SESSION_COOKIE, { path: "/" });
        return reply.code(204).send(null);
      },
    );

    app.post(
      "/logout-all",
      {
        preValidation: requireSession(app.services.auth),
        schema: {
          tags: ["auth"],
          summary: "Cerrar sesión en todos los dispositivos",
          response: { 204: z.null() },
        },
      },
      async (request, reply) => {
        await app.services.auth.logoutAll(currentAuth(request).user.id);
        reply.clearCookie(SESSION_COOKIE, { path: "/" });
        return reply.code(204).send(null);
      },
    );

    app.post(
      "/onboarding/complete",
      {
        preValidation: requireSession(app.services.auth),
        schema: {
          tags: ["auth"],
          summary: "Marcar el tutorial de primer ingreso como visto",
          response: { 204: z.null() },
        },
      },
      async (request, reply) => {
        await app.services.auth.completeOnboarding(currentAuth(request).user.id);
        return reply.code(204).send(null);
      },
    );

    app.get(
      "/me",
      {
        preValidation: requireSession(app.services.auth),
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
