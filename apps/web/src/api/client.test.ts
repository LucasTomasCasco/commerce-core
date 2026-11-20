import { describe, expect, it } from "vitest";
import { ApiError, unwrap } from "./client.js";

function result<T>(data: T | undefined, error: unknown, status: number) {
  return Promise.resolve({ data, error, response: new Response(null, { status }) });
}

describe("unwrap", () => {
  it("devuelve el dato de una respuesta exitosa", async () => {
    await expect(unwrap(result({ ok: true }, undefined, 200))).resolves.toEqual({ ok: true });
  });

  it("convierte el problem+json en ApiError con código y mensaje del servidor", async () => {
    const error = unwrap(
      result(undefined, { code: "SKU_TAKEN", detail: "Ya existe un producto con ese SKU" }, 409),
    );
    await expect(error).rejects.toBeInstanceOf(ApiError);
    await expect(error).rejects.toMatchObject({
      status: 409,
      code: "SKU_TAKEN",
      message: "Ya existe un producto con ese SKU",
    });
  });

  it("usa un mensaje genérico si el error no trae detalle", async () => {
    await expect(unwrap(result(undefined, "<html>", 502))).rejects.toMatchObject({
      status: 502,
      code: "ERROR",
      message: "Ocurrió un error inesperado",
    });
  });
});
