import { expect, test, type Locator, type Page } from "@playwright/test";
import { waitForTokenSentTo } from "./mailpit.js";

// Flujo completo: el administrador general crea la tienda, el propietario acepta por email, configura
// un rol y un staff, y el staff opera dentro de los permisos que le dieron. Luego se cargan productos,
// se venden y cancelan pedidos, y se verifica el storefront público.

const ADMIN_EMAIL = requiredEnv("PLATFORM_ADMIN_EMAIL");
const ADMIN_PASSWORD = requiredEnv("PLATFORM_ADMIN_PASSWORD");
const RUN = Date.now().toString(36);
const SLUG = `e2e-${RUN}`;
const OWNER_EMAIL = `owner-${RUN}@e2e.example`;
const STAFF_EMAIL = `caja-${RUN}@e2e.example`;
const PASSWORD = "clave-e2e-segura-1";

test.describe.configure({ mode: "serial" });

test("alta de tienda, equipo con permisos, pedidos y storefront", async ({ page }) => {
  // 1. El administrador general crea la tienda e invita al propietario.
  await login(page, ADMIN_EMAIL, ADMIN_PASSWORD);
  await page.goto("/admin/tiendas");
  await page.getByLabel("Nombre", { exact: true }).fill(`Librería ${RUN}`);
  await page.getByLabel("Dirección (slug)").fill(SLUG);
  await page.getByLabel("Email del propietario").fill(OWNER_EMAIL);
  await page.getByRole("button", { name: "Crear tienda" }).click();
  await expect(page.getByText("Tienda creada. Enviamos la invitación")).toBeVisible();

  // 2. El propietario acepta la invitación recibida por email y crea su cuenta.
  await acceptInvitation(page, OWNER_EMAIL, "Dueña E2E");
  const storeId = storeIdFrom(page.url());
  await expect(page.getByRole("heading", { name: `Librería ${RUN}` })).toBeVisible();

  // 3. El propietario crea un rol con permisos acotados y lo asigna a un staff.
  await page.goto(`/tiendas/${storeId}/equipo`);
  await page.getByLabel("Nombre", { exact: true }).fill("Caja");
  for (const label of ["Ver productos", "Ver stock", "Ver pedidos", "Cargar pedidos"]) {
    await page.getByLabel(label, { exact: true }).check();
  }
  await page.getByRole("button", { name: "Crear rol" }).click();
  await expect(page.getByRole("cell", { name: "Caja" })).toBeVisible();

  await page.getByLabel("Email", { exact: true }).fill(STAFF_EMAIL);
  await page.getByRole("combobox", { name: "Rol", exact: true }).selectOption({ label: "Caja" });
  await page.getByRole("button", { name: "Enviar invitación" }).click();
  await expect(page.getByText("Invitación enviada.")).toBeVisible();

  // 4. El staff acepta, ve solo lo que su rol permite y no puede administrar el equipo.
  await page.getByRole("button", { name: "Salir", exact: true }).click();
  await acceptInvitation(page, STAFF_EMAIL, "Caja E2E");
  await expect(page.getByRole("link", { name: "Pedidos" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Equipo" })).toHaveCount(0);
  await page.goto(`/tiendas/${storeId}/equipo`);
  await expect(page.getByText("No tienes permiso para esta acción")).toBeVisible();

  // 5. El propietario carga un producto y registra la entrada de stock.
  await page.getByRole("button", { name: "Salir", exact: true }).click();
  await login(page, OWNER_EMAIL, PASSWORD);
  await page.goto(`/tiendas/${storeId}/productos`);
  const productForm = page.locator("form", {
    has: page.getByRole("button", { name: "Crear producto" }),
  });
  await productForm.getByLabel("SKU").fill("TAZ-E2E");
  await productForm.getByLabel("Nombre").fill("Taza E2E");
  await productForm.getByLabel(/Precio/).fill("4500,00");
  await productForm.getByRole("button", { name: "Crear producto" }).click();
  await expect(page.getByRole("cell", { name: "Taza E2E" })).toBeVisible();

  await page.goto(`/tiendas/${storeId}/stock`);
  const stockForm = page.locator("form", {
    has: page.getByRole("button", { name: "Registrar", exact: true }),
  });
  await selectOptionContaining(stockForm.getByLabel("Producto"), "TAZ-E2E");
  await stockForm.locator('input[type="number"]').fill("3");
  await stockForm.getByRole("button", { name: "Registrar", exact: true }).click();
  await expect(page.getByRole("cell", { name: "+3" })).toBeVisible();

  // 6. Pedido manual: venta, rechazo por sobreventa, confirmación y entrega.
  const first = await createOrder(page, storeId, { quantity: "2", customer: "María Pérez" });
  await expect(first.getByText("ORD-000001")).toBeVisible();

  const oversell = await createOrder(page, storeId, { quantity: "5", customer: "Juan Gómez" });
  await expect(oversell.getByText(/Stock insuficiente para TAZ-E2E/)).toBeVisible();

  await page.goto(`/tiendas/${storeId}/pedidos`);
  await page.getByRole("link", { name: "Ver" }).first().click();
  await page.getByRole("button", { name: "Confirmar pedido" }).click();
  await expect(page.getByText("Confirmado", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Marcar como entregado" }).click();
  await expect(page.getByText("Entregado", { exact: true })).toBeVisible();

  // 7. Pedido cancelado: el stock vuelve a la tienda.
  const cancelled = await createOrder(page, storeId, { quantity: "1", customer: "Lucía Ruiz" });
  await expect(cancelled.getByText("ORD-000002")).toBeVisible();
  await page.getByRole("button", { name: "Cancelar y devolver stock" }).click();
  await expect(page.getByText("Cancelado", { exact: true })).toBeVisible();
  await page.goto(`/tiendas/${storeId}/stock`);
  await expect(page.getByText("Devolución por cancelación")).toBeVisible();

  // 8. Auditoría y storefront público.
  await page.goto(`/tiendas/${storeId}/auditoria`);
  await expect(page.getByText("order.created").first()).toBeVisible();

  await page.goto(`/t/${SLUG}`);
  await expect(page.getByText("Taza E2E")).toBeVisible();
  await expect(page.getByText("Disponible")).toBeVisible();
});

// Espera la opción que contiene el texto (los productos llegan por red) y la elige por su valor.
async function selectOptionContaining(select: Locator, text: string) {
  const option = select.locator("option", { hasText: text });
  await expect(option).toHaveCount(1);
  await select.selectOption((await option.getAttribute("value")) ?? "");
}

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Falta la variable ${name} (ver .env.example)`);
  return value;
}

function storeIdFrom(url: string): string {
  const id = /\/tiendas\/([0-9a-f-]{36})/.exec(url)?.[1];
  if (!id) throw new Error(`No se encontró la tienda en ${url}`);
  return id;
}

async function login(page: Page, email: string, password: string) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Contraseña").fill(password);
  await page.getByRole("button", { name: "Ingresar" }).click();
  await expect(page.getByRole("button", { name: "Salir", exact: true })).toBeVisible();
}

async function acceptInvitation(page: Page, email: string, fullName: string) {
  const token = await waitForTokenSentTo(email);
  await page.goto(`/invitacion?token=${token}`);
  await page.getByLabel("Nombre completo").fill(fullName);
  await page.getByLabel(/Contraseña/).fill(PASSWORD);
  await page.getByRole("button", { name: "Crear cuenta y aceptar" }).click();
  await expect(page).toHaveURL(/\/tiendas\/[0-9a-f-]{36}/);
}

// Crea un pedido desde el formulario y devuelve el contenedor donde se muestra el resultado.
async function createOrder(
  page: Page,
  storeId: string,
  input: { quantity: string; customer: string },
) {
  await page.goto(`/tiendas/${storeId}/pedidos/nuevo`);
  await page.getByLabel("Nombre del cliente").fill(input.customer);
  await page.getByLabel("Teléfono").fill("+54 11 5555-0000");
  await selectOptionContaining(page.locator("select").first(), "TAZ-E2E");
  await page.locator('input[type="number"]').first().fill(input.quantity);
  await page.getByRole("button", { name: "Cargar pedido" }).click();
  return page.locator("body");
}
