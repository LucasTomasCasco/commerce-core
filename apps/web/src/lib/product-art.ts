// Pieza visual determinista para cada producto: el mismo nombre siempre da el mismo degradado.
// Así el catálogo se ve completo sin cargar imágenes.
const HUES = [18, 35, 160, 200, 260, 320, 350];

export function productArt(seed: string): string {
  let hash = 0;
  for (const char of seed) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  const hue = HUES[hash % HUES.length] ?? 35;
  const hue2 = (hue + 40) % 360;
  return `linear-gradient(135deg, hsl(${String(hue)} 85% 58%), hsl(${String(hue2)} 80% 42%))`;
}

export function initials(name: string): string {
  return name
    .split(/\s+/)
    .slice(0, 2)
    .map((word) => word.charAt(0).toUpperCase())
    .join("");
}
