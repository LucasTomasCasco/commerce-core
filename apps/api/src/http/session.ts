import type { FastifyReply, FastifyRequest, preHandlerAsyncHookHandler } from "fastify";
import type { Env } from "../config/env.js";
import type { AuthService, AuthUser } from "../auth/auth-service.js";
import { AppError } from "./errors.js";

export const SESSION_COOKIE = "cc_session";

export type AuthContext = {
  user: AuthUser;
  token: string;
};

export function sessionCookieOptions(env: Env) {
  return {
    path: "/",
    httpOnly: true,
    sameSite: "lax" as const,
    secure: env.NODE_ENV === "production",
    maxAge: env.SESSION_TTL_DAYS * 24 * 60 * 60,
  };
}

// Valida la cookie de sesión y deja el contexto en request.auth. Sin sesión válida responde 401.
export function requireSession(auth: AuthService): preHandlerAsyncHookHandler {
  return async (request: FastifyRequest, _reply: FastifyReply) => {
    const token = request.cookies[SESSION_COOKIE];
    const user = token ? await auth.getUserByToken(token) : null;
    if (!token || !user) {
      throw new AppError(401, "UNAUTHENTICATED", "Necesitas iniciar sesión");
    }
    request.auth = { user, token };
  };
}
