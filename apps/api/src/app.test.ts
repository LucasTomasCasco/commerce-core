import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "./app.js";
import { loadEnv } from "./config/env.js";

describe("app", () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    app = await buildApp({
      env: loadEnv({ DATABASE_URL: "postgres://unused", LOG_LEVEL: "silent" }),
    });
  });

  afterEach(async () => {
    await app.close();
  });

  it("responde ok en /api/v1/health", async () => {
    const res = await app.inject({ method: "GET", url: "/api/v1/health" });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: "ok" });
  });

  it("responde problem+json en rutas inexistentes", async () => {
    const res = await app.inject({ method: "GET", url: "/no-existe" });

    expect(res.statusCode).toBe(404);
    expect(res.headers["content-type"]).toContain("application/problem+json");
    expect(res.json()).toMatchObject({ status: 404, code: "NOT_FOUND" });
  });
});
