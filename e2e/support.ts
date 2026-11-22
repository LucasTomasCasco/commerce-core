import { expect, type APIRequestContext, type Page } from "@playwright/test";
import { waitForTokenSentTo } from "./mailpit.js";

export const PASSWORD = "clave-e2e-segura-1";

export function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Falta la variable ${name} (ver .env.example)`);
  return value;
}

export function storeIdFrom(url: string): string {
  const id = /\/tiendas\/([0-9a-f-]{36})/.exec(url)?.[1];
  if (!id) throw new Error(`No se encontró la tienda en ${url}`);
  return id;
}

// Un usuario nuevo ve el tutorial de primer ingreso: en los flujos de prueba lo descartamos.
export async function dismissTour(page: Page) {
  const skip = page.getByRole("button", { name: "Omitir" });
  if (await skip.isVisible({ timeout: 1500 }).catch(() => false)) await skip.click();
}

export async function login(page: Page, email: string, password: string) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Contraseña").fill(password);
  await page.getByRole("button", { name: "Ingresar" }).click();
  await expect(page.getByRole("button", { name: "Salir", exact: true })).toBeVisible();
  await dismissTour(page);
}

// Acepta la invitación más reciente enviada al email, desde la pantalla de la web.
export async function acceptInvitation(page: Page, email: string, fullName: string) {
  const token = await waitForTokenSentTo(email);
  await page.goto(`/invitacion?token=${token}`);
  await page.getByLabel("Nombre completo").fill(fullName);
  await page.getByLabel(/Contraseña/).fill(PASSWORD);
  await page.getByRole("button", { name: "Crear cuenta y aceptar" }).click();
  await expect(page).toHaveURL(/\/tiendas\/[0-9a-f-]{36}/);
  await dismissTour(page);
}

// Inicia sesión por API (más rápido que la UI para preparar datos). Devuelve el request con la cookie.
export async function apiLogin(request: APIRequestContext, email: string, password: string) {
  const res = await request.post("/api/v1/auth/login", { data: { email, password } });
  if (!res.ok()) throw new Error(`Login por API falló: ${String(res.status())}`);
}
