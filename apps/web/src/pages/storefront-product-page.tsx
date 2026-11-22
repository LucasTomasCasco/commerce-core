import { useSuspenseQuery } from "@tanstack/react-query";
import { Link, useParams } from "react-router";
import { api, unwrap } from "../api/client.js";
import { Badge, Boundary } from "../components/ui.js";
import { ThemeToggle } from "../components/theme-toggle.js";
import { formatMoney } from "../lib/money.js";
import { initials, productArt } from "../lib/product-art.js";

export function StorefrontProductPage() {
  const { slug = "" } = useParams();
  return (
    <div className="mx-auto max-w-5xl px-5 py-10">
      <div className="mb-8 flex items-center justify-between">
        <Link
          to={`/t/${slug}`}
          className="inline-flex text-sm font-semibold text-fg-muted transition hover:text-fg"
        >
          ← Volver al catálogo
        </Link>
        <ThemeToggle />
      </div>
      <Boundary>
        <ProductDetail />
      </Boundary>
    </div>
  );
}

function ProductDetail() {
  const { slug = "", productId = "" } = useParams();
  const product = useSuspenseQuery({
    queryKey: ["public-product", slug, productId],
    queryFn: () =>
      unwrap(
        api.GET("/api/v1/public/stores/{slug}/products/{productId}", {
          params: { path: { slug, productId } },
        }),
      ),
  });
  const p = product.data;

  return (
    <div className="grid gap-10 md:grid-cols-[1.1fr_1fr] md:items-center">
      <div
        className="flex aspect-square items-center justify-center rounded-3xl border border-line shadow-card"
        style={{ background: productArt(p.name) }}
      >
        <span className="text-8xl font-extrabold text-white/90 drop-shadow">
          {initials(p.name)}
        </span>
      </div>
      <div className="flex flex-col gap-6">
        <div>
          <p className="num text-xs font-semibold uppercase tracking-[0.2em] text-fg-muted">
            {p.sku}
          </p>
          <h1 className="mt-2 text-4xl font-extrabold leading-tight tracking-tight">{p.name}</h1>
        </div>
        {p.description && (
          <p className="text-base leading-relaxed text-fg-muted">{p.description}</p>
        )}
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-line bg-surface p-5">
          <p className="num text-3xl font-extrabold">{formatMoney(p.priceMinor, p.currencyCode)}</p>
          <Badge tone={p.inStock ? "good" : "bad"}>{p.inStock ? "Disponible" : "Agotado"}</Badge>
        </div>
      </div>
    </div>
  );
}
