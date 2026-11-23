import { expect, test, type Page } from "@playwright/test";
import { tokensSentTo } from "./mailpit.js";
import { acceptInvitation, login, requiredEnv, storeIdFrom } from "./support.js";

const ADMIN_EMAIL = requiredEnv("PLATFORM_ADMIN_EMAIL");
const ADMIN_PASSWORD = requiredEnv("PLATFORM_ADMIN_PASSWORD");
const RUN = Date.now().toString(36);

test.describe.configure({ mode: "serial" });

// Crea la tienda y devuelve su id tomado de la respuesta del alta (no de la lista, que está paginada).
async function createStoreAsAdmin(page: Page, slug: string, ownerEmail: string): Promise<string> {
  await login(page, ADMIN_EMAIL, ADMIN_PASSWORD);
  await page.goto("/admin/tiendas");
  await page.getByLabel("Nombre", { exact: true }).fill(`Operaciones ${slug}`);
  await page.getByLabel("Dirección (slug)").fill(slug);
  await page.getByLabel("Email del propietario").fill(ownerEmail);
  const [response] = await Promise.all([
    page.waitForResponse(
      (r) => r.request().method() === "POST" && r.url().endsWith("/api/v1/platform/stores"),
    ),
    page.getByRole("button", { name: "Crear tienda" }).click(),
  ]);
  await expect(page.getByText("Tienda creada. Enviamos la invitación")).toBeVisible();
  return ((await response.json()) as { id: string }).id;
}

test("el administrador reenvía la invitación: el enlace anterior deja de funcionar", async ({
  page,
}) => {
  const slug = `reenvio-${RUN}`;
  const owner = `reenvio-${RUN}@e2e.example`;
  const storeId = await createStoreAsAdmin(page, slug, owner);
  // El worker envía el email en segundos: esperamos a que llegue antes de leer el token.
  // El worker procesa el outbox cada 5 s y Mailpit recibe después: el margen por defecto de 5 s no alcanza en CI.
  await expect.poll(async () => (await tokensSentTo(owner)).length, { timeout: 20_000 }).toBe(1);
  const [firstToken] = await tokensSentTo(owner);

  await page.goto(`/admin/tiendas/${storeId}`);
  await page.getByRole("button", { name: "Reenviar invitación al propietario" }).click();
  await expect(page.getByText("Invitación reenviada.")).toBeVisible();

  await expect.poll(async () => (await tokensSentTo(owner)).length, { timeout: 20_000 }).toBe(2);
  const [newToken] = await tokensSentTo(owner);
  expect(newToken).not.toBe(firstToken);

  await page.goto(`/invitacion?token=${firstToken ?? ""}`);
  await expect(page.getByRole("alert")).toHaveText("La invitación no es válida o ya venció");

  await acceptInvitation(page, owner, "Reenvío");
  await expect(page.getByRole("heading", { name: `Operaciones ${slug}` })).toBeVisible();
});

test("el administrador transfiere la propiedad: el nuevo propietario acepta y el anterior baja de rol", async ({
  page,
  browser,
}) => {
  const slug = `traspaso-${RUN}`;
  const oldOwner = `viejo-${RUN}@e2e.example`;
  const newOwner = `nuevo-${RUN}@e2e.example`;
  const storeId = await createStoreAsAdmin(page, slug, oldOwner);

  // Un owner real acepta la invitación inicial para que haya un propietario operativo.
  const ownerContext = await browser.newContext();
  const ownerPage = await ownerContext.newPage();
  await acceptInvitation(ownerPage, oldOwner, "Vieja dueña");
  await ownerContext.close();

  await page.goto(`/admin/tiendas/${storeId}`);
  await page.getByLabel("Email del nuevo propietario").fill(newOwner);
  await expect(page.getByLabel("Rol del propietario anterior")).toBeEnabled();
  await page.getByLabel("Rol del propietario anterior").selectOption({ label: "Vendedor" });
  await page.getByRole("button", { name: "Transferir propiedad" }).click();
  await expect(page.getByText("Invitación enviada al nuevo propietario.")).toBeVisible();

  const newContext = await browser.newContext();
  const newPage = await newContext.newPage();
  await acceptInvitation(newPage, newOwner, "Nueva dueña");
  await newPage.goto(`/tiendas/${storeId}/equipo`);
  await expect(newPage.getByRole("cell", { name: "Nueva dueña" })).toBeVisible();
  await expect(newPage.getByRole("cell", { name: "Propietario" }).first()).toBeVisible();
  await newContext.close();
});

test("storefront: productos de categorías archivadas se ocultan y el detalle abre desde el catálogo", async ({
  page,
}) => {
  const slug = `vitrina-${RUN}`;
  const owner = `vitrina-${RUN}@e2e.example`;
  await createStoreAsAdmin(page, slug, owner);
  // Preparamos datos con la sesión del propietario: page.request comparte las cookies de la página.
  await page.getByRole("button", { name: "Salir", exact: true }).click();
  await acceptInvitation(page, owner, "Vitrina");
  const storeId = storeIdFrom(page.url());

  const category = await page.request.post(`/api/v1/stores/${storeId}/categories`, {
    data: { name: "Temporada", slug: `temporada-${RUN}` },
  });
  const categoryId = ((await category.json()) as { id: string }).id;
  await page.request.post(`/api/v1/stores/${storeId}/products`, {
    data: { sku: `TMP-${RUN}`, name: "Producto de temporada", priceMinor: 100, categoryId },
  });
  await page.request.post(`/api/v1/stores/${storeId}/products`, {
    data: { sku: `GEN-${RUN}`, name: "Producto general", priceMinor: 200 },
  });

  await page.goto(`/t/${slug}`);
  await expect(page.getByRole("link", { name: "Producto de temporada" })).toBeVisible();

  await page.request.delete(`/api/v1/stores/${storeId}/categories/${categoryId}`);
  await page.goto(`/t/${slug}`);
  await expect(page.getByRole("link", { name: "Producto general" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Producto de temporada" })).toHaveCount(0);

  await page.getByRole("link", { name: "Producto general" }).click();
  await expect(page.getByRole("heading", { name: "Producto general" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Volver al catálogo" })).toBeVisible();
});
