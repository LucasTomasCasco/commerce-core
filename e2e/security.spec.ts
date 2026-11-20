import { expect, test } from "@playwright/test";
import { waitForTokenSentTo } from "./mailpit.js";
import { acceptInvitation, login, PASSWORD, requiredEnv } from "./support.js";

const ADMIN_EMAIL = requiredEnv("PLATFORM_ADMIN_EMAIL");
const ADMIN_PASSWORD = requiredEnv("PLATFORM_ADMIN_PASSWORD");
const RUN = Date.now().toString(36);

test.describe.configure({ mode: "serial" });

test("contraseña incorrecta muestra error genérico, sin revelar si el email existe", async ({
  page,
}) => {
  await page.goto("/login");
  await page.getByLabel("Email").fill(`nadie-${RUN}@e2e.example`);
  await page.getByLabel("Contraseña").fill("incorrecta-123");
  await page.getByRole("button", { name: "Ingresar" }).click();

  await expect(page.getByRole("alert")).toHaveText("Email o contraseña incorrectos");
});

test("bloqueo de cuenta tras intentos fallidos y recuperación por reseteo", async ({ page }) => {
  const email = `lock-${RUN}@e2e.example`;
  await login(page, ADMIN_EMAIL, ADMIN_PASSWORD);
  await page.goto("/admin/tiendas");
  await page.getByLabel("Nombre", { exact: true }).fill(`Bloqueo ${RUN}`);
  await page.getByLabel("Dirección (slug)").fill(`lock-${RUN}`);
  await page.getByLabel("Email del propietario").fill(email);
  await page.getByRole("button", { name: "Crear tienda" }).click();
  await expect(page.getByText("Tienda creada. Enviamos la invitación")).toBeVisible();
  await acceptInvitation(page, email, "Bloqueada");
  await page.getByRole("button", { name: "Salir", exact: true }).click();

  for (let i = 0; i < 5; i++) {
    await page.goto("/login");
    await page.getByLabel("Email").fill(email);
    await page.getByLabel("Contraseña").fill("mal-intento-1");
    await page.getByRole("button", { name: "Ingresar" }).click();
  }
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Contraseña").fill(PASSWORD);
  await page.getByRole("button", { name: "Ingresar" }).click();
  await expect(page.getByRole("alert")).toContainText("Demasiados intentos fallidos");

  // El reseteo por email sigue disponible para recuperar la cuenta.
  await page.goto("/olvide");
  await page.getByLabel("Email").fill(email);
  await page.getByRole("button", { name: "Enviar enlace" }).click();
  const token = await waitForTokenSentTo(email, { subject: "Restablecer" });
  await page.goto(`/restablecer?token=${token}`);
  await page.getByLabel(/Nueva contraseña/).fill("nueva-clave-789");
  await page.getByRole("button", { name: "Guardar contraseña" }).click();
  await expect(page.getByText("Contraseña actualizada.")).toBeVisible();
});

test("la contraseña nueva debe cumplir la política (letras y números)", async ({ page }) => {
  await page.goto("/restablecer?token=cualquiera");
  await page.getByLabel(/Nueva contraseña/).fill("solosinnumeros");
  await page.getByRole("button", { name: "Guardar contraseña" }).click();
  await expect(page.getByRole("alert")).toBeVisible();
});

test("salir de todos los dispositivos cierra la sesión también en otro navegador", async ({
  browser,
}) => {
  const email = `multi-${RUN}@e2e.example`;
  const admin = await browser.newContext();
  const adminPage = await admin.newPage();
  await login(adminPage, ADMIN_EMAIL, ADMIN_PASSWORD);
  await adminPage.goto("/admin/tiendas");
  await adminPage.getByLabel("Nombre", { exact: true }).fill(`Multi ${RUN}`);
  await adminPage.getByLabel("Dirección (slug)").fill(`multi-${RUN}`);
  await adminPage.getByLabel("Email del propietario").fill(email);
  await adminPage.getByRole("button", { name: "Crear tienda" }).click();
  await expect(adminPage.getByText("Tienda creada. Enviamos la invitación")).toBeVisible();
  await admin.close();

  const first = await browser.newContext();
  const firstPage = await first.newPage();
  await acceptInvitation(firstPage, email, "Multi");
  const second = await browser.newContext();
  const secondPage = await second.newPage();
  await login(secondPage, email, PASSWORD);

  await firstPage.getByRole("button", { name: "Salir de todos" }).click();
  await expect(firstPage).toHaveURL(/\/login/);
  await secondPage.reload();
  await expect(secondPage).toHaveURL(/\/login/);
  await first.close();
  await second.close();
});
