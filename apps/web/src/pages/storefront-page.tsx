import { useSuspenseQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Link, useParams } from "react-router";
import { api, unwrap } from "../api/client.js";
import { Badge, Boundary, Empty, Input } from "../components/ui.js";
import { ThemeToggle } from "../components/theme-toggle.js";
import { formatMoney } from "../lib/money.js";
import { initials, productArt } from "../lib/product-art.js";

// Vista pública de la tienda: sin sesión, solo productos activos y disponibilidad (sin cantidades).
export function StorefrontPage() {
  return (
    <div className="mx-auto max-w-6xl px-5 py-6 sm:py-10">
      <div className="mb-10 flex justify-end">
        <ThemeToggle />
      </div>
      <Boundary>
        <Catalog />
      </Boundary>
    </div>
  );
}

function Catalog() {
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
    <>
      <header className="mb-8 max-w-2xl sm:mb-12">
        <p className="mb-3 text-xs font-semibold uppercase tracking-[0.2em] text-accent">
          Catálogo
        </p>
        <h1 className="text-4xl font-extrabold leading-[1.05] tracking-tight sm:text-5xl">
          Lo que tenemos{" "}
          <span className="bg-gradient-to-r from-accent to-[#ff7a1a] bg-clip-text text-transparent">
            hoy
          </span>
        </h1>
        <p className="mt-4 text-fg-muted">Precios actualizados y disponibilidad en tiempo real.</p>
      </header>

      <div className="mb-10 flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        {/* En teléfono las categorías son una franja deslizable; en md+ hacen wrap. */}
        <div className="-mx-5 flex gap-2 overflow-x-auto px-5 pb-1 [&>*]:shrink-0 md:mx-0 md:flex-wrap md:overflow-visible md:px-0">
          <Chip
            active={categoryId === ""}
            onClick={() => {
              setCategoryId("");
            }}
          >
            Todo
          </Chip>
          {categories.data.categories.map((c) => (
            <Chip
              key={c.id}
              active={categoryId === c.id}
              onClick={() => {
                setCategoryId(c.id);
              }}
            >
              {c.name}
            </Chip>
          ))}
        </div>
        <div className="md:w-72">
          <Input
            type="search"
            aria-label="Buscar productos"
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
            }}
            placeholder="Buscar por nombre o SKU"
            className="w-full"
          />
        </div>
      </div>

      {products.data.items.length === 0 ? (
        <Empty>No encontramos productos con esos filtros.</Empty>
      ) : (
        <div className="grid grid-cols-2 gap-5 md:grid-cols-3 lg:grid-cols-4">
          {products.data.items.map((p) => (
            <Link
              key={p.id}
              to={`/t/${slug}/productos/${p.id}`}
              className="group flex flex-col overflow-hidden rounded-2xl border border-line bg-surface shadow-card transition duration-200 hover:-translate-y-1 hover:border-fg-muted/40"
            >
              <div
                className="relative flex aspect-[4/3] items-center justify-center"
                style={{ background: productArt(p.name) }}
              >
                <span className="text-4xl font-extrabold text-white/90 drop-shadow-sm transition group-hover:scale-110">
                  {initials(p.name)}
                </span>
              </div>
              <div className="flex flex-1 flex-col gap-2 p-4">
                <p className="line-clamp-2 font-semibold leading-snug">{p.name}</p>
                <div className="mt-auto flex flex-wrap items-end justify-between gap-x-2 gap-y-1 pt-2">
                  <p className="num text-lg font-bold">
                    {formatMoney(p.priceMinor, p.currencyCode)}
                  </p>
                  <Badge tone={p.inStock ? "good" : "bad"}>
                    {p.inStock ? "Disponible" : "Agotado"}
                  </Badge>
                </div>
              </div>
            </Link>
          ))}
        </div>
      )}
    </>
  );
}

function Chip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-full border px-4 py-1.5 text-sm font-semibold transition ${
        active
          ? "border-accent bg-accent text-accent-fg"
          : "border-line bg-surface text-fg-muted hover:border-fg-muted hover:text-fg"
      }`}
    >
      {children}
    </button>
  );
}
