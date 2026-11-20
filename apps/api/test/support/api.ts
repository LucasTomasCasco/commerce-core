import type { buildTestApp } from "./app.js";

export type Ctx = Awaited<ReturnType<typeof buildTestApp>>;
export type Method = "GET" | "POST" | "PATCH" | "DELETE";

// Llamada HTTP de prueba con sesión opcional. Devuelve la respuesta sin tipar.
export function call(
  ctx: Ctx,
  method: Method,
  url: string,
  token?: string | null,
  payload?: unknown,
) {
  return ctx.app.inject({
    method,
    url,
    ...(token ? { cookies: { cc_session: token } } : {}),
    ...(payload !== undefined ? { payload: payload as Record<string, unknown> } : {}),
  });
}

export const UNKNOWN_UUID = "00000000-0000-4000-8000-000000000000";
