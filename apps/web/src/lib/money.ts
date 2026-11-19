// Los montos llegan en unidad menor (centavos). Los decimales salen de la moneda.
function fractionDigits(currencyCode: string): number {
  return (
    new Intl.NumberFormat("es-AR", { style: "currency", currency: currencyCode }).resolvedOptions()
      .maximumFractionDigits ?? 2
  );
}

export function formatMoney(amountMinor: number, currencyCode: string): string {
  const digits = fractionDigits(currencyCode);
  return new Intl.NumberFormat("es-AR", { style: "currency", currency: currencyCode }).format(
    amountMinor / 10 ** digits,
  );
}

// Convierte un monto escrito ("1234,50") a unidad menor. Devuelve null si no es un número válido.
export function parseMoneyToMinor(input: string, currencyCode: string): number | null {
  const normalized = input.trim().replace(/\./g, "").replace(",", ".");
  const value = Number(normalized);
  if (normalized === "" || !Number.isFinite(value) || value < 0) return null;
  return Math.round(value * 10 ** fractionDigits(currencyCode));
}
