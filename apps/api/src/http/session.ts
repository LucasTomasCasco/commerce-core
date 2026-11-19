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
    await loadSession(auth, request);
    if (!request.auth) {
      throw new AppError(401, "UNAUTHENTICATED", "Necesitas iniciar sesión");
    }
  };
}

// Para rutas públicas que cambian según haya sesión: deja request.auth en null si no hay sesión válida.
export function optionalSession(auth: AuthService): preHandlerAsyncHookHandler {
  return async (request: FastifyRequest, _reply: FastifyReply) => {
    await loadSession(auth, request);
  };
}

async function loadSession(auth: AuthService, request: FastifyRequest): Promise<void> {
  const token = request.cookies[SESSION_COOKIE];
  if (!token) return;
  const user = await auth.getUserByToken(token);
  if (user) request.auth = { user, token };
}

// Para rutas protegidas por requireSession: devuelve el contexto de autenticación sin fallbacks.
export function currentAuth(request: FastifyRequest): AuthContext {
  if (!request.auth) {
    throw new AppError(401, "UNAUTHENTICATED", "Necesitas iniciar sesión");
  }
  return request.auth;
}
