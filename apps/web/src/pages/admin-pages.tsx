import { Pager } from "../components/ui.js";
import { PlatformStoreSettings } from "./store-settings.js";
import { useMutation, useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { useState, type SyntheticEvent } from "react";
import { Link, useParams } from "react-router";
import { api, unwrap } from "../api/client.js";
import {
  Alert,
  Badge,
  Button,
  Card,
  Empty,
  Field,
  Input,
  LinkButton,
  PageHeader,
  Select,
  Table,
  formatDate,
} from "../components/ui.js";
import { errorText } from "./catalog-pages.js";

const STORES_PAGE_SIZE = 20;
const AUDIT_PAGE_SIZE = 25;

export function StoresAdminPage() {
  const queryClient = useQueryClient();
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [currencyCode, setCurrencyCode] = useState("ARS");
  const [ownerEmail, setOwnerEmail] = useState("");

  const [offset, setOffset] = useState(0);
  const stores = useSuspenseQuery({
    queryKey: ["platform-stores", offset],
    queryFn: () =>
      unwrap(
        api.GET("/api/v1/platform/stores", {
          params: { query: { limit: STORES_PAGE_SIZE, offset } },
        }),
      ),
  });
  const currencies = useSuspenseQuery({
    queryKey: ["platform-currencies"],
    queryFn: () => unwrap(api.GET("/api/v1/platform/currencies")),
  });
  const create = useMutation({
    mutationFn: () =>
      unwrap(
        api.POST("/api/v1/platform/stores", { body: { name, slug, currencyCode, ownerEmail } }),
      ),
    onSuccess: async () => {
      setName("");
      setSlug("");
      setOwnerEmail("");
      await queryClient.invalidateQueries({ queryKey: ["platform-stores"] });
    },
  });

  return (
    <>
      <PageHeader title="Tiendas" />
      <div className="grid gap-6 lg:grid-cols-[1fr_340px]">
        {stores.data.items.length === 0 ? (
          <Empty>Todavía no hay tiendas.</Empty>
        ) : (
          <Table headers={["Nombre", "Dirección", "Moneda", "Estado", ""]}>
            {stores.data.items.map((s) => (
              <tr key={s.id}>
                <td className="px-4 py-2.5">{s.name}</td>
                <td className="px-4 py-2.5 font-mono text-xs">/{s.slug}</td>
                <td className="px-4 py-2.5">{s.currencyCode}</td>
                <td className="px-4 py-2.5">
                  <Badge tone={s.status === "active" ? "good" : "bad"}>
                    {s.status === "active" ? "Activa" : "Suspendida"}
                  </Badge>
                </td>
                <td className="px-4 py-2.5">
                  <Link className="underline" to={`/admin/tiendas/${s.id}`}>
                    Administrar
                  </Link>
                </td>
              </tr>
            ))}
          </Table>
        )}
        <div className="flex flex-col gap-4">
          <Pager
            total={stores.data.total}
            limit={STORES_PAGE_SIZE}
            offset={offset}
            onChange={setOffset}
          />
        </div>
        <Card className="h-fit">
          <h2 className="mb-4 font-semibold">Nueva tienda</h2>
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
            <Field label="Dirección (slug)">
              <Input
                required
                pattern="[a-z0-9]+(-[a-z0-9]+)*"
                minLength={3}
                value={slug}
                onChange={(e) => {
                  setSlug(e.target.value);
                }}
              />
            </Field>
            <Field label="Moneda">
              <Select
                value={currencyCode}
                onChange={(e) => {
                  setCurrencyCode(e.target.value);
                }}
              >
                {currencies.data.currencies
                  .filter((c) => c.isActive)
                  .map((c) => (
                    <option key={c.code} value={c.code}>
                      {c.code} · {c.name}
                    </option>
                  ))}
              </Select>
            </Field>
            <Field label="Email del propietario">
              <Input
                type="email"
                required
                value={ownerEmail}
                onChange={(e) => {
                  setOwnerEmail(e.target.value);
                }}
              />
            </Field>
            {create.error && <Alert>{errorText(create.error)}</Alert>}
            {create.isSuccess && (
              <Alert tone="info">Tienda creada. Enviamos la invitación al propietario.</Alert>
            )}
            <Button type="submit" disabled={create.isPending}>
              Crear tienda
            </Button>
          </form>
        </Card>
      </div>
    </>
  );
}

export function PlatformStorePage() {
  const { storeId = "" } = useParams();
  const queryClient = useQueryClient();
  const store = useSuspenseQuery({
    queryKey: ["platform-store", storeId],
    queryFn: () =>
      unwrap(api.GET("/api/v1/platform/stores/{storeId}", { params: { path: { storeId } } })),
  });
  const [auditOffset, setAuditOffset] = useState(0);
  const audit = useSuspenseQuery({
    queryKey: ["platform-audit", storeId, auditOffset],
    queryFn: () =>
      unwrap(
        api.GET("/api/v1/platform/stores/{storeId}/audit", {
          params: { path: { storeId }, query: { limit: AUDIT_PAGE_SIZE, offset: auditOffset } },
        }),
      ),
  });
  const setStatus = useMutation({
    mutationFn: (status: "active" | "suspended") =>
      unwrap(
        api.PATCH("/api/v1/platform/stores/{storeId}", {
          params: { path: { storeId } },
          body: { status },
        }),
      ),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["platform-store", storeId] }),
        queryClient.invalidateQueries({ queryKey: ["platform-stores"] }),
        queryClient.invalidateQueries({ queryKey: ["platform-audit", storeId] }),
      ]);
    },
  });
  const s = store.data;

  return (
    <>
      <PageHeader title={s.name}>
        <LinkButton to="/admin/tiendas">Volver</LinkButton>
      </PageHeader>
      <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
        <Card className="flex flex-col gap-4">
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
            <dt className="text-slate-500">Dirección</dt>
            <dd>/{s.slug}</dd>
            <dt className="text-slate-500">Moneda</dt>
            <dd>{s.currencyCode}</dd>
            <dt className="text-slate-500">Creada</dt>
            <dd>{formatDate(s.createdAt)}</dd>
          </dl>
          <p className="text-xs text-slate-500">
            El administrador general no ve productos ni pedidos de la tienda; solo gestiona su
            estado y su auditoría.
          </p>
        </Card>
        <Card className="flex h-fit flex-col gap-3">
          <p className="text-sm">
            Estado:{" "}
            <Badge tone={s.status === "active" ? "good" : "bad"}>
              {s.status === "active" ? "Activa" : "Suspendida"}
            </Badge>
          </p>
          {s.status === "active" ? (
            <Button
              variant="danger"
              onClick={() => {
                setStatus.mutate("suspended");
              }}
              disabled={setStatus.isPending}
            >
              Suspender tienda
            </Button>
          ) : (
            <Button
              onClick={() => {
                setStatus.mutate("active");
              }}
              disabled={setStatus.isPending}
            >
              Reactivar tienda
            </Button>
          )}
          {setStatus.error && <Alert>{errorText(setStatus.error)}</Alert>}
        </Card>
      </div>
      <div className="mt-8">
        <PlatformStoreSettings storeId={storeId} currentName={s.name} />
      </div>
      <section className="mt-8 flex flex-col gap-3">
        <h2 className="font-semibold">Auditoría reciente</h2>
        {audit.data.items.length === 0 ? (
          <Empty>Sin actividad registrada.</Empty>
        ) : (
          <Table headers={["Fecha", "Quién", "Acción"]}>
            {audit.data.items.map((e) => (
              <tr key={e.id}>
                <td className="px-4 py-2.5 text-xs text-slate-500">{formatDate(e.createdAt)}</td>
                <td className="px-4 py-2.5">{e.actorName}</td>
                <td className="px-4 py-2.5 font-mono text-xs">{e.action}</td>
              </tr>
            ))}
          </Table>
        )}
        <Pager
          total={audit.data.total}
          limit={AUDIT_PAGE_SIZE}
          offset={auditOffset}
          onChange={setAuditOffset}
        />
      </section>
    </>
  );
}

export function CurrenciesPage() {
  const queryClient = useQueryClient();
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [minorUnit, setMinorUnit] = useState("2");
  const currencies = useSuspenseQuery({
    queryKey: ["platform-currencies"],
    queryFn: () => unwrap(api.GET("/api/v1/platform/currencies")),
  });
  const refresh = () => queryClient.invalidateQueries({ queryKey: ["platform-currencies"] });
  const create = useMutation({
    mutationFn: () =>
      unwrap(
        api.POST("/api/v1/platform/currencies", {
          body: { code, name, minorUnit: Number(minorUnit) },
        }),
      ),
    onSuccess: async () => {
      setCode("");
      setName("");
      await refresh();
    },
  });
  const toggle = useMutation({
    mutationFn: (currency: { code: string; isActive: boolean }) =>
      unwrap(
        api.PATCH("/api/v1/platform/currencies/{code}", {
          params: { path: { code: currency.code } },
          body: { isActive: !currency.isActive },
        }),
      ),
    onSuccess: refresh,
  });

  return (
    <>
      <PageHeader title="Monedas" />
      <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
        {
          <Table headers={["Código", "Nombre", "Decimales", "Estado", ""]}>
            {currencies.data.currencies.map((c) => (
              <tr key={c.code}>
                <td className="px-4 py-2.5 font-mono">{c.code}</td>
                <td className="px-4 py-2.5">{c.name}</td>
                <td className="px-4 py-2.5">{c.minorUnit}</td>
                <td className="px-4 py-2.5">
                  <Badge tone={c.isActive ? "good" : "neutral"}>
                    {c.isActive ? "Disponible" : "Inactiva"}
                  </Badge>
                </td>
                <td className="px-4 py-2.5">
                  <Button
                    variant="secondary"
                    onClick={() => {
                      toggle.mutate(c);
                    }}
                  >
                    {c.isActive ? "Desactivar" : "Activar"}
                  </Button>
                </td>
              </tr>
            ))}
          </Table>
        }
        <Card className="h-fit">
          <h2 className="mb-4 font-semibold">Agregar moneda</h2>
          <form
            className="flex flex-col gap-3"
            onSubmit={(e: SyntheticEvent) => {
              e.preventDefault();
              create.mutate();
            }}
          >
            <Field label="Código ISO (3 letras)">
              <Input
                required
                pattern="[A-Z]{3}"
                value={code}
                onChange={(e) => {
                  setCode(e.target.value.toUpperCase());
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
            <Field label="Decimales">
              <Select
                value={minorUnit}
                onChange={(e) => {
                  setMinorUnit(e.target.value);
                }}
              >
                {[0, 1, 2, 3, 4].map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              </Select>
            </Field>
            {create.error && <Alert>{errorText(create.error)}</Alert>}
            <Button type="submit" disabled={create.isPending}>
              Agregar
            </Button>
          </form>
        </Card>
      </div>
    </>
  );
}
