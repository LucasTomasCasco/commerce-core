import { useMutation, useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { useState, type SyntheticEvent, type ReactNode } from "react";
import { Link, useNavigate, useSearchParams } from "react-router";
import { api, unwrap } from "../api/client.js";
import { useMe } from "../auth/session.js";
import { Alert, BrandMark, Boundary, Button, Card, Field, Input } from "../components/ui.js";
import { ThemeToggle } from "../components/theme-toggle.js";

// Pantalla de acceso: panel de marca a la izquierda (desktop) y formulario a la derecha.
function AuthShell({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="grid min-h-screen lg:grid-cols-[1.1fr_1fr]">
      <aside className="relative hidden overflow-hidden border-r border-line lg:flex lg:flex-col lg:justify-between lg:p-14">
        <div
          aria-hidden
          className="absolute inset-0 bg-[radial-gradient(60%_50%_at_30%_20%,var(--glow-a),transparent),radial-gradient(50%_40%_at_80%_90%,var(--glow-b),transparent)]"
        />
        <div className="relative flex items-center gap-3">
          <BrandMark size="lg" />
          <span className="text-lg font-bold tracking-tight">Commerce Core</span>
        </div>
        <div className="relative max-w-md">
          <p className="text-5xl font-extrabold leading-[1.05] tracking-tight">
            Tu comercio,{" "}
            <span className="bg-gradient-to-r from-accent to-[#ff7a1a] bg-clip-text text-transparent">
              en un solo panel.
            </span>
          </p>
          <p className="mt-6 text-base leading-relaxed text-fg-muted">
            Catálogo, stock con ledger, pedidos y equipo con permisos a medida, para varias tiendas
            en una misma plataforma.
          </p>
        </div>
        <p className="relative text-xs text-fg-muted">
          Proyecto de portfolio · API documentada en /docs
        </p>
      </aside>
      <main className="relative flex items-center justify-center px-5 py-12">
        <div className="absolute right-5 top-5">
          <ThemeToggle />
        </div>
        <div className="w-full max-w-sm">
          <div className="mb-8 flex items-center gap-3 lg:hidden">
            <BrandMark />
            <span className="font-bold tracking-tight">Commerce Core</span>
          </div>
          <h1 className="mb-6 text-3xl font-extrabold tracking-tight">{title}</h1>
          <Card>{children}</Card>
        </div>
      </main>
    </div>
  );
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : "Ocurrió un error inesperado";
}

export function LoginPage() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  const login = useMutation({
    mutationFn: () => unwrap(api.POST("/api/v1/auth/login", { body: { email, password } })),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["me"] });
      const next = params.get("next");
      await navigate(next?.startsWith("/") && !next.startsWith("//") ? next : "/", {
        replace: true,
      });
    },
  });

  function submit(event: SyntheticEvent) {
    event.preventDefault();
    login.mutate();
  }

  return (
    <AuthShell title="Iniciar sesión">
      <form onSubmit={submit} className="flex flex-col gap-4">
        <Field label="Email">
          <Input
            type="email"
            autoComplete="username"
            required
            value={email}
            onChange={(e) => {
              setEmail(e.target.value);
            }}
          />
        </Field>
        <Field label="Contraseña">
          <Input
            type="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(e) => {
              setPassword(e.target.value);
            }}
          />
        </Field>
        {login.error && <Alert>{errorText(login.error)}</Alert>}
        <Button type="submit" disabled={login.isPending}>
          {login.isPending ? "Ingresando…" : "Ingresar"}
        </Button>
        <Link to="/olvide" className="text-center text-sm text-slate-600 underline">
          Olvidé mi contraseña
        </Link>
      </form>
    </AuthShell>
  );
}

export function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const request = useMutation({
    mutationFn: () => unwrap(api.POST("/api/v1/auth/forgot-password", { body: { email } })),
  });

  return (
    <AuthShell title="Recuperar contraseña">
      {request.isSuccess ? (
        <Alert tone="info">
          Si el email existe, te enviamos un enlace para elegir una nueva contraseña.
        </Alert>
      ) : (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            request.mutate();
          }}
          className="flex flex-col gap-4"
        >
          <Field label="Email">
            <Input
              type="email"
              required
              value={email}
              onChange={(e) => {
                setEmail(e.target.value);
              }}
            />
          </Field>
          {request.error && <Alert>{errorText(request.error)}</Alert>}
          <Button type="submit" disabled={request.isPending}>
            Enviar enlace
          </Button>
        </form>
      )}
      <Link to="/login" className="mt-4 block text-center text-sm text-slate-600 underline">
        Volver a ingresar
      </Link>
    </AuthShell>
  );
}

export function ResetPasswordPage() {
  const [params] = useSearchParams();
  const token = params.get("token") ?? "";
  const [password, setPassword] = useState("");
  const reset = useMutation({
    mutationFn: () =>
      unwrap(api.POST("/api/v1/auth/reset-password", { body: { token, password } })),
  });

  return (
    <AuthShell title="Nueva contraseña">
      {reset.isSuccess ? (
        <Alert tone="info">
          Contraseña actualizada.{" "}
          <Link to="/login" className="underline">
            Ingresar
          </Link>
        </Alert>
      ) : (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            reset.mutate();
          }}
          className="flex flex-col gap-4"
        >
          <Field label="Nueva contraseña (mínimo 10 caracteres)">
            <Input
              type="password"
              minLength={10}
              required
              value={password}
              onChange={(e) => {
                setPassword(e.target.value);
              }}
            />
          </Field>
          {reset.error && <Alert>{errorText(reset.error)}</Alert>}
          <Button type="submit" disabled={reset.isPending || !token}>
            Guardar contraseña
          </Button>
        </form>
      )}
    </AuthShell>
  );
}

export function InvitePage() {
  const [params] = useSearchParams();
  const token = params.get("token") ?? "";
  if (!token) {
    return (
      <AuthShell title="Invitación">
        <Alert>El enlace de invitación no es válido.</Alert>
      </AuthShell>
    );
  }
  return (
    <Boundary>
      <InviteContent token={token} />
    </Boundary>
  );
}

function InviteContent({ token }: { token: string }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const me = useMe();
  const [fullName, setFullName] = useState("");
  const [password, setPassword] = useState("");

  const preview = useSuspenseQuery({
    queryKey: ["invitation", token],
    queryFn: () => unwrap(api.POST("/api/v1/invitations/preview", { body: { token } })),
  });

  const accept = useMutation({
    mutationFn: () =>
      unwrap(
        api.POST("/api/v1/invitations/accept", {
          body: preview.data.accountExists ? { token } : { token, fullName, password },
        }),
      ),
    onSuccess: async (result) => {
      await queryClient.invalidateQueries({ queryKey: ["me"] });
      await navigate(`/tiendas/${result.storeId}`, { replace: true });
    },
  });

  const data = preview.data;
  const signedInAsInvitee = me.data?.email === data.email;
  const next = encodeURIComponent(`/invitacion?token=${token}`);

  return (
    <AuthShell title={`Te invitaron a ${data.storeName}`}>
      <p className="mb-4 text-sm text-slate-600">
        Rol: <strong>{data.roleName}</strong> · Email: <strong>{data.email}</strong>
      </p>
      {data.accountExists ? (
        signedInAsInvitee ? (
          <Button
            onClick={() => {
              accept.mutate();
            }}
            disabled={accept.isPending}
          >
            Aceptar invitación
          </Button>
        ) : (
          <div className="flex flex-col gap-3">
            <Alert tone="info">
              Ya tienes una cuenta con este email. Ingresa para aceptar la invitación.
            </Alert>
            <Link to={`/login?next=${next}`} className="text-center text-sm underline">
              Ingresar
            </Link>
          </div>
        )
      ) : (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            accept.mutate();
          }}
          className="flex flex-col gap-4"
        >
          <Field label="Nombre completo">
            <Input
              required
              value={fullName}
              onChange={(e) => {
                setFullName(e.target.value);
              }}
            />
          </Field>
          <Field label="Contraseña (mínimo 10 caracteres)">
            <Input
              type="password"
              minLength={10}
              required
              value={password}
              onChange={(e) => {
                setPassword(e.target.value);
              }}
            />
          </Field>
          <Button type="submit" disabled={accept.isPending}>
            Crear cuenta y aceptar
          </Button>
        </form>
      )}
      {accept.error && (
        <div className="mt-4">
          <Alert>{errorText(accept.error)}</Alert>
        </div>
      )}
    </AuthShell>
  );
}
