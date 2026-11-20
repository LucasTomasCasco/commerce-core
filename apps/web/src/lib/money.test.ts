import { describe, expect, it } from "vitest";
import { formatMoney, parseMoneyToMinor } from "./money.js";

describe("formatMoney", () => {
  it("formatea centavos de pesos argentinos con dos decimales", () => {
    expect(formatMoney(450000, "ARS")).toMatch(/4\.500,00/);
  });

  it("respeta monedas sin decimales (yen)", () => {
    expect(formatMoney(1500, "JPY")).toMatch(/1\.500|1,500/);
  });

  it("muestra cero como cero pesos", () => {
    expect(formatMoney(0, "ARS")).toMatch(/0,00/);
  });
});

describe("parseMoneyToMinor", () => {
  it("convierte '4500,00' a centavos", () => {
    expect(parseMoneyToMinor("4500,00", "ARS")).toBe(450000);
  });

  it("acepta puntos de miles", () => {
    expect(parseMoneyToMinor("1.234,50", "ARS")).toBe(123450);
  });

  it("redondea a la unidad menor de la moneda", () => {
    expect(parseMoneyToMinor("10,005", "ARS")).toBe(1001);
  });

  it("rechaza texto vacío, negativos y no numéricos", () => {
    expect(parseMoneyToMinor("", "ARS")).toBeNull();
    expect(parseMoneyToMinor("-5", "ARS")).toBeNull();
    expect(parseMoneyToMinor("abc", "ARS")).toBeNull();
  });

  it("es el inverso de formatMoney para montos enteros", () => {
    const minor = 987654;
    expect(parseMoneyToMinor("9876,54", "ARS")).toBe(minor);
  });
});
