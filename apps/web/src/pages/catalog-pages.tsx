import { Pager } from "../components/ui.js";
import { RenameCategory } from "../components/rename-category.js";
import { useMutation, useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { useState, type SyntheticEvent } from "react";
import { api, unwrap } from "../api/client.js";
import {
  Alert,
  Badge,
  Button,
  Card,
  Empty,
  Field,
  Input,
  Select,
  Table,
} from "../components/ui.js";
import { formatMoney, parseMoneyToMinor } from "../lib/money.js";
import { useStore } from "../store/store-context.js";

const PAGE_SIZE = 20;

export function errorText(error: unknown): string {
  return error instanceof Error ? error.message : "Ocurrió un error inesperado";
}

type Product = {
  id: string;
  sku: string;
  name: string;
  description: string | null;
  categoryId: string | null;
  priceMinor: number;
  stockOnHand: number;
  active: boolean;
  archivedAt: string | null;
};

type Category = { id: string; name: string; slug: string; archivedAt: string | null };

export function useCategories(storeId: string, includeArchived = false) {
  return useSuspenseQuery({
    queryKey: ["categories", storeId, includeArchived],
    queryFn: () =>
      unwrap(
        api.GET("/api/v1/stores/{storeId}/categories", {
          params: { path: { storeId }, query: { includeArchived: String(includeArchived) } },
        }),
      ),
  });
}

export function ProductsPage() {
  const { storeId, store, can } = useStore();
  const queryClient = useQueryClient();
  const [q, setQ] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [includeArchived, setIncludeArchived] = useState(false);
  const [offset, setOffset] = useState(0);
  const [editing, setEditing] = useState<Product | null>(null);

  const categories = useCategories(storeId);
  const products = useSuspenseQuery({
    queryKey: ["products", storeId, q, categoryId, includeArchived],
    queryFn: () =>
      unwrap(
        api.GET("/api/v1/stores/{storeId}/products", {
          params: {
            path: { storeId },
            query: {
              limit: PAGE_SIZE,
              offset,
              ...(q ? { q } : {}),
              ...(categoryId ? { categoryId } : {}),
              includeArchived: String(includeArchived),
            },
          },
        }),
      ),
  });

  const refresh = () => queryClient.invalidateQueries({ queryKey: ["products", storeId] });
  const archive = useMutation({
    mutationFn: (productId: string) =>
      unwrap(
        api.DELETE("/api/v1/stores/{storeId}/products/{productId}", {
          params: { path: { storeId, productId } },
        }),
      ),
    onSuccess: refresh,
  });
  const toggleActive = useMutation({
    mutationFn: (product: Product) =>
      unwrap(
        api.PATCH("/api/v1/stores/{storeId}/products/{productId}", {
          params: { path: { storeId, productId: product.id } },
          body: { active: !product.active },
        }),
      ),
    onSuccess: refresh,
  });

  const categoryName = (id: string | null) =>
    categories.data.categories.find((c) => c.id === id)?.name ?? "—";

  return (
    <div className="grid grid-cols-1 gap-6 2xl:grid-cols-[minmax(0,1fr)_340px]">
      <div className="flex flex-col gap-4">
        <div className="flex flex-wrap items-end gap-3">
          <Field label="Buscar" className="w-full min-w-0 sm:w-64">
            <Input
              className="w-full min-w-0"
              value={q}
              onChange={(e) => {
                setQ(e.target.value);
                setOffset(0);
              }}
              placeholder="Nombre o SKU"
            />
          </Field>
          <Field label="Categoría" className="w-full min-w-0 sm:w-64">
            <Select
              className="w-full min-w-0"
              value={categoryId}
              onChange={(e) => {
                setCategoryId(e.target.value);
                setOffset(0);
              }}
            >
              <option value="">Todas</option>
              {categories.data.categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </Select>
          </Field>
          <label className="flex items-center gap-2 pb-2 text-sm">
            <input
              type="checkbox"
              checked={includeArchived}
              onChange={(e) => {
                setIncludeArchived(e.target.checked);
                setOffset(0);
              }}
            />
            Mostrar archivados
          </label>
        </div>

        {products.data.items.length === 0 ? (
          <Empty>No hay productos con esos filtros.</Empty>
        ) : (
          <Table headers={["SKU", "Producto", "Categoría", "Precio", "Stock", "Estado", ""]}>
            {products.data.items.map((p) => (
              <tr key={p.id} className="hover:bg-surface-2">
                <td className="px-4 py-2.5 font-mono text-xs">{p.sku}</td>
                <td className="px-4 py-2.5">{p.name}</td>
                <td className="px-4 py-2.5">{categoryName(p.categoryId)}</td>
                <td className="px-4 py-2.5">{formatMoney(p.priceMinor, store.currencyCode)}</td>
                <td className="px-4 py-2.5">{p.stockOnHand}</td>
                <td className="px-4 py-2.5">
                  {p.archivedAt ? (
                    <Badge tone="bad">Archivado</Badge>
                  ) : p.active ? (
                    <Badge tone="good">Activo</Badge>
                  ) : (
                    <Badge tone="warn">Inactivo</Badge>
                  )}
                </td>
                <td className="flex gap-2 px-4 py-2.5">
                  {can("products:manage") && !p.archivedAt && (
                    <>
                      <Button
                        size="sm"
                        variant="secondary"
                        onClick={() => {
                          setEditing(p);
                        }}
                      >
                        Editar
                      </Button>
                      <Button
                        size="sm"
                        variant="secondary"
                        onClick={() => {
                          toggleActive.mutate(p);
                        }}
                      >
                        {p.active ? "Desactivar" : "Activar"}
                      </Button>
                      <Button
                        size="sm"
                        variant="danger"
                        onClick={() => {
                          archive.mutate(p.id);
                        }}
                      >
                        Archivar
                      </Button>
                    </>
                  )}
                </td>
              </tr>
            ))}
          </Table>
        )}
        <Pager total={products.data.total} limit={PAGE_SIZE} offset={offset} onChange={setOffset} />
        {(archive.error || toggleActive.error) && (
          <Alert>{errorText(archive.error ?? toggleActive.error)}</Alert>
        )}
      </div>

      {can("products:manage") && (
        <ProductForm
          key={editing?.id ?? "new"}
          storeId={storeId}
          currencyCode={store.currencyCode}
          categories={categories.data.categories}
          product={editing}
          onDone={() => {
            setEditing(null);
            void refresh();
          }}
          onCancel={() => {
            setEditing(null);
          }}
        />
      )}
    </div>
  );
}

function ProductForm({
  storeId,
  currencyCode,
  categories,
  product,
  onDone,
  onCancel,
}: {
  storeId: string;
  currencyCode: string;
  categories: Category[];
  product: Product | null;
  onDone: () => void;
  onCancel: () => void;
}) {
  const [sku, setSku] = useState(product?.sku ?? "");
  const [name, setName] = useState(product?.name ?? "");
  const [description, setDescription] = useState(product?.description ?? "");
  const [categoryId, setCategoryId] = useState(product?.categoryId ?? "");
  const [price, setPrice] = useState(
    product ? String(product.priceMinor / 100).replace(".", ",") : "",
  );
  const [priceError, setPriceError] = useState<string | null>(null);

  const save = useMutation({
    mutationFn: async () => {
      const priceMinor = parseMoneyToMinor(price, currencyCode);
      if (priceMinor === null) throw new Error("Ingresa un precio válido");
      const body = {
        sku,
        name,
        priceMinor,
        ...(description ? { description } : {}),
        ...(categoryId ? { categoryId } : {}),
      };
      if (product) {
        return unwrap(
          api.PATCH("/api/v1/stores/{storeId}/products/{productId}", {
            params: { path: { storeId, productId: product.id } },
            body: { ...body, description: description || null, categoryId: categoryId || null },
          }),
        );
      }
      return unwrap(
        api.POST("/api/v1/stores/{storeId}/products", { params: { path: { storeId } }, body }),
      );
    },
    onSuccess: onDone,
    onError: (error) => {
      setPriceError(errorText(error));
    },
  });

  function submit(event: SyntheticEvent) {
    event.preventDefault();
    setPriceError(null);
    save.mutate();
  }

  return (
    <Card className="h-fit">
      <h2 className="mb-4 font-semibold">{product ? "Editar producto" : "Nuevo producto"}</h2>
      <form onSubmit={submit} className="flex flex-col gap-3">
        <Field label="SKU">
          <Input
            required
            value={sku}
            onChange={(e) => {
              setSku(e.target.value);
            }}
          />
        </Field>
        <Field label="Nombre">
          <Input
            required
            value={name}
            onChange={(e) => {
              setName(e.target.value);
            }}
          />
        </Field>
        <Field label={`Precio (${currencyCode})`}>
          <Input
            required
            inputMode="decimal"
            value={price}
            onChange={(e) => {
              setPrice(e.target.value);
            }}
            placeholder="4500,00"
          />
        </Field>
        <Field label="Categoría">
          <Select
            value={categoryId}
            onChange={(e) => {
              setCategoryId(e.target.value);
            }}
          >
            <option value="">Sin categoría</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Descripción">
          <Input
            value={description}
            onChange={(e) => {
              setDescription(e.target.value);
            }}
          />
        </Field>
        {priceError && <Alert>{priceError}</Alert>}
        <div className="flex gap-2">
          <Button type="submit" disabled={save.isPending}>
            {product ? "Guardar cambios" : "Crear producto"}
          </Button>
          {product && (
            <Button size="sm" type="button" variant="secondary" onClick={onCancel}>
              Cancelar
            </Button>
          )}
        </div>
      </form>
    </Card>
  );
}

export function CategoriesPage() {
  const { storeId, can } = useStore();
  const queryClient = useQueryClient();
  const [includeArchived, setIncludeArchived] = useState(false);
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const categories = useCategories(storeId, includeArchived);
  const refresh = () => queryClient.invalidateQueries({ queryKey: ["categories", storeId] });

  const create = useMutation({
    mutationFn: () =>
      unwrap(
        api.POST("/api/v1/stores/{storeId}/categories", {
          params: { path: { storeId } },
          body: { name, slug },
        }),
      ),
    onSuccess: async () => {
      setName("");
      setSlug("");
      await refresh();
    },
  });
  const archive = useMutation({
    mutationFn: (categoryId: string) =>
      unwrap(
        api.DELETE("/api/v1/stores/{storeId}/categories/{categoryId}", {
          params: { path: { storeId, categoryId } },
        }),
      ),
    onSuccess: refresh,
  });

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
      <div className="flex flex-col gap-4">
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={includeArchived}
            onChange={(e) => {
              setIncludeArchived(e.target.checked);
            }}
          />
          Mostrar archivadas
        </label>
        {categories.data.categories.length === 0 ? (
          <Empty>Todavía no hay categorías.</Empty>
        ) : (
          <Table headers={["Nombre", "Slug", "Estado", ""]}>
            {categories.data.categories.map((c) => (
              <tr key={c.id}>
                <td className="px-4 py-2.5">{c.name}</td>
                <td className="px-4 py-2.5 font-mono text-xs">{c.slug}</td>
                <td className="px-4 py-2.5">
                  {c.archivedAt ? (
                    <Badge tone="bad">Archivada</Badge>
                  ) : (
                    <Badge tone="good">Visible</Badge>
                  )}
                </td>
                <td className="px-4 py-2.5">
                  {can("categories:manage") && !c.archivedAt && (
                    <RenameCategory storeId={storeId} category={c} />
                  )}
                  {can("categories:manage") && !c.archivedAt && (
                    <Button
                      size="sm"
                      variant="danger"
                      onClick={() => {
                        archive.mutate(c.id);
                      }}
                    >
                      Archivar
                    </Button>
                  )}
                </td>
              </tr>
            ))}
          </Table>
        )}
        {archive.error && <Alert>{errorText(archive.error)}</Alert>}
      </div>
      {can("categories:manage") && (
        <Card className="h-fit">
          <h2 className="mb-4 font-semibold">Nueva categoría</h2>
          <form
            className="flex flex-col gap-3"
            onSubmit={(e: SyntheticEvent) => {
              e.preventDefault();
              create.mutate();
            }}
          >
            <Field label="Nombre">
              <Input
                required
                value={name}
                onChange={(e) => {
                  setName(e.target.value);
                }}
              />
            </Field>
            <Field label="Slug (minúsculas y guiones)">
              <Input
                required
                pattern="[a-z0-9]+(-[a-z0-9]+)*"
                value={slug}
                onChange={(e) => {
                  setSlug(e.target.value);
                }}
              />
            </Field>
            {create.error && <Alert>{errorText(create.error)}</Alert>}
            <Button type="submit" disabled={create.isPending}>
              Crear categoría
            </Button>
          </form>
        </Card>
      )}
    </div>
  );
}
