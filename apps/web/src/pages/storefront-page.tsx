import { useSuspenseQuery } from "@tanstack/react-query";
import { useState } from "react";
import { useParams } from "react-router";
import { api, unwrap } from "../api/client.js";
import { Badge, Card, Empty, Field, Input, Select } from "../components/ui.js";
import { formatMoney } from "../lib/money.js";

// Vista pública de la tienda: sin sesión, solo productos activos y disponibilidad (sin cantidades).
export function StorefrontPage() {
  const { slug = "" } = useParams();
  const [q, setQ] = useState("");
  const [categoryId, setCategoryId] = useState("");

  const categories = useSuspenseQuery({
    queryKey: ["public-categories", slug],
    queryFn: () =>
      unwrap(api.GET("/api/v1/public/stores/{slug}/categories", { params: { path: { slug } } })),
  });
  const products = useSuspenseQuery({
    queryKey: ["public-products", slug, q, categoryId],
    queryFn: () =>
      unwrap(
        api.GET("/api/v1/public/stores/{slug}/products", {
          params: {
            path: { slug },
            query: { limit: 60, ...(q ? { q } : {}), ...(categoryId ? { categoryId } : {}) },
          },
        }),
      ),
  });

  return (
    <div className="mx-auto max-w-6xl px-4 py-8">
      <h1 className="mb-6 text-2xl font-semibold tracking-tight">Catálogo</h1>
      <div className="mb-6 flex flex-wrap gap-3">
        <Field label="Buscar">
          <Input
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
            }}
            placeholder="Qué estás buscando"
          />
        </Field>
        <Field label="Categoría">
          <Select
            value={categoryId}
            onChange={(e) => {
              setCategoryId(e.target.value);
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
      </div>
      {products.data.items.length === 0 ? (
        <Empty>No encontramos productos.</Empty>
      ) : (
        <div className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-4">
          {products.data.items.map((p) => (
            <Card key={p.id} className="flex flex-col gap-2">
              <p className="font-medium">{p.name}</p>
              {p.description && (
                <p className="line-clamp-2 text-sm text-slate-500">{p.description}</p>
              )}
              <div className="mt-auto flex items-center justify-between pt-2">
                <p className="font-semibold">{formatMoney(p.priceMinor, p.currencyCode)}</p>
                <Badge tone={p.inStock ? "good" : "bad"}>
                  {p.inStock ? "Disponible" : "Sin stock"}
                </Badge>
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
