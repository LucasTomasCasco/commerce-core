import { useSuspenseQuery } from "@tanstack/react-query";
import { Link, useParams } from "react-router";
import { api, unwrap } from "../api/client.js";
import { Badge, Boundary, Card } from "../components/ui.js";
import { formatMoney } from "../lib/money.js";

export function StorefrontProductPage() {
  return (
    <div className="mx-auto max-w-3xl px-4 py-8">
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
    <Card className="flex flex-col gap-4">
      <Link to={`/t/${slug}`} className="text-sm text-slate-600 underline">
        Volver al catálogo
      </Link>
      <h1 className="text-2xl font-semibold tracking-tight">{p.name}</h1>
      <p className="font-mono text-xs text-slate-500">{p.sku}</p>
      {p.description && <p className="text-slate-700">{p.description}</p>}
      <div className="flex items-center justify-between">
        <p className="text-xl font-semibold">{formatMoney(p.priceMinor, p.currencyCode)}</p>
        <Badge tone={p.inStock ? "good" : "bad"}>{p.inStock ? "Disponible" : "Sin stock"}</Badge>
      </div>
    </Card>
  );
}
