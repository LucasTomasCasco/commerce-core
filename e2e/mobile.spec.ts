import { expect, test, type Page } from "@playwright/test";
import { waitForTokenSentTo } from "./mailpit.js";
import { PASSWORD, dismissTour, login, requiredEnv, storeIdFrom } from "./support.js";

const ADMIN_EMAIL = requiredEnv("PLATFORM_ADMIN_EMAIL");
const ADMIN_PASSWORD = requiredEnv("PLATFORM_ADMIN_PASSWORD");
const RUN = Date.now().toString(36);

// Teléfono típico: ninguna pantalla puede desbordar la página en horizontal (las tablas scrollean dentro de su caja).
test.use({ viewport: { width: 375, height: 812 } });

async function expectNoPageOverflow(page: Page, path: string) {
  await page.goto(path);
  await expect(page.getByRole("heading", { level: 1 }).first()).toBeVisible();
  // El h1 de la tienda aparece antes que el contenido de la pestaña: medimos con todo cargado.
  await page.waitForLoadState("networkidle");
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow, `desborde horizontal en ${path}`).toBeLessThanOrEqual(0);
}

test("las pantallas principales no desbordan en un teléfono", async ({ page }) => {
  const slug = `movil-${RUN}`;
  const owner = `movil-${RUN}@e2e.example`;

  await login(page, ADMIN_EMAIL, ADMIN_PASSWORD);
  await expectNoPageOverflow(page, "/admin/tiendas");
  await expectNoPageOverflow(page, "/admin/monedas");

  await page.goto("/admin/tiendas");
  await page.getByLabel("Nombre", { exact: true }).fill(`Móvil ${RUN}`);
  await page.getByLabel("Dirección (slug)").fill(slug);
  await page.getByLabel("Email del propietario").fill(owner);
  await page.getByRole("button", { name: "Crear tienda" }).click();
  await expect(page.getByText("Tienda creada. Enviamos la invitación")).toBeVisible();

  const token = await waitForTokenSentTo(owner);
  await page.context().clearCookies();
  await page.goto(`/invitacion?token=${token}`);
  await page.getByLabel("Nombre completo").fill("Dueña Móvil");
  await page.getByLabel(/Contraseña/).fill(PASSWORD);
  await page.getByRole("button", { name: "Crear cuenta y aceptar" }).click();
  await expect(page).toHaveURL(/\/tiendas\/[0-9a-f-]{36}/);
  const storeId = storeIdFrom(page.url());

  // Primer ingreso: el tutorial es un diálogo y también tiene que entrar en la pantalla.
  await expect(page.getByRole("dialog")).toBeVisible();
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow, "desborde horizontal con el tutorial abierto").toBeLessThanOrEqual(0);
  // Desde el paso 2 aparece Anterior: son tres botones y tienen que caber dentro de la pantalla.
  await page.getByRole("button", { name: "Siguiente" }).click();
  await expect(page.getByRole("button", { name: "Anterior" })).toBeVisible();
  for (const button of await page.getByRole("dialog").getByRole("button").all()) {
    const box = await button.boundingBox();
    expect(box && box.x >= 0 && box.x + box.width <= 375).toBe(true);
  }
  await dismissTour(page);

  for (const tab of [
    "",
    "productos",
    "categorias",
    "stock",
    "pedidos",
    "pedidos/nuevo",
    "equipo",
    "auditoria",
  ]) {
    await expectNoPageOverflow(page, `/tiendas/${storeId}/${tab}`);
  }
  await expectNoPageOverflow(page, `/t/${slug}`);
});
