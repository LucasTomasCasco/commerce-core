import createClient from "openapi-fetch";
import type { paths } from "./schema.js";

export const api = createClient<paths>({ baseUrl: "", credentials: "include" });

// Error de la API con el código y el mensaje del problem+json.
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

type ApiResult<T> = { data?: T; error?: unknown; response: Response };

// Devuelve el dato de una respuesta exitosa o lanza ApiError con el detalle del servidor.
export async function unwrap<T>(request: Promise<ApiResult<T>>): Promise<T> {
  const { data, error, response } = await request;
  if (error !== undefined) {
    const problem = (error ?? {}) as { code?: string; detail?: string };
    throw new ApiError(
      response.status,
      problem.code ?? "ERROR",
      problem.detail ?? "Ocurrió un error inesperado",
    );
  }
  return data as T;
}
