import { describe, expect, it } from "vitest";
import { loadEnv } from "./env.js";

describe("loadEnv", () => {
  it("falla si falta DATABASE_URL", () => {
    expect(() => loadEnv({})).toThrow();
  });

  it("aplica valores por defecto", () => {
    const env = loadEnv({ DATABASE_URL: "postgres://localhost/test" });

    expect(env.PORT).toBe(3000);
    expect(env.LOG_LEVEL).toBe("info");
    expect(env.SESSION_TTL_DAYS).toBe(7);
  });
});
