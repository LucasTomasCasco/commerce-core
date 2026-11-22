import {
  Component,
  Suspense,
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
} from "react";
import { Link } from "react-router";

export function PageHeader({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4 sm:mb-8">
      <h1 className="text-2xl font-extrabold tracking-tight sm:text-3xl">{title}</h1>
      <div className="flex flex-wrap items-center gap-2">{children}</div>
    </div>
  );
}

export function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <section className={`rounded-2xl border border-line bg-surface p-6 shadow-card ${className}`}>
      {children}
    </section>
  );
}

const BUTTON_STYLES = {
  primary:
    "bg-accent text-accent-fg shadow-[0_8px_24px_-10px_var(--accent)] hover:bg-accent-hover hover:-translate-y-px",
  secondary: "border border-line bg-surface-2 text-fg hover:border-fg-muted",
  danger: "bg-bad/15 text-bad border border-bad/30 hover:bg-bad/25",
  ghost: "text-fg-muted hover:text-fg hover:bg-surface-2",
} as const;

const BUTTON_SIZES = {
  md: "rounded-xl px-4 py-2.5 text-sm",
  sm: "rounded-lg px-3 py-1.5 text-xs",
} as const;

export function Button({
  variant = "primary",
  size = "md",
  className = "",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: keyof typeof BUTTON_STYLES;
  size?: keyof typeof BUTTON_SIZES;
}) {
  return (
    <button
      {...props}
      className={`inline-flex items-center justify-center gap-2 font-semibold transition duration-150 disabled:cursor-not-allowed disabled:opacity-40 ${BUTTON_SIZES[size]} ${BUTTON_STYLES[variant]} ${className}`}
    />
  );
}

export function LinkButton({ to, children }: { to: string; children: ReactNode }) {
  return (
    <Link
      to={to}
      className="inline-flex items-center gap-2 rounded-xl border border-line bg-surface-2 px-4 py-2.5 text-sm font-semibold text-fg transition hover:border-fg-muted"
    >
      {children}
    </Link>
  );
}

export function Field({
  label,
  className = "",
  children,
}: {
  label: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <label
      className={`flex flex-col gap-2 text-xs font-semibold uppercase tracking-wider text-fg-muted ${className}`}
    >
      {label}
      {children}
    </label>
  );
}

const CONTROL =
  "rounded-xl border border-line bg-surface-2 px-3.5 py-2.5 text-sm normal-case tracking-normal text-fg placeholder:text-fg-muted/70 outline-none transition focus:border-accent focus:ring-4 focus:ring-accent/20";

export function Input(props: InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={`${CONTROL} ${props.className ?? ""}`} />;
}

export function Select(props: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select {...props} className={`${CONTROL} ${props.className ?? ""}`} />;
}

const ALERT_TONES = {
  error: "border-bad/30 bg-bad/10 text-bad",
  info: "border-info/30 bg-info/10 text-info",
} as const;

export function Alert({
  tone = "error",
  children,
}: {
  tone?: keyof typeof ALERT_TONES;
  children: ReactNode;
}) {
  return (
    <div
      role={tone === "error" ? "alert" : "status"}
      className={`rounded-xl border px-4 py-3 text-sm ${ALERT_TONES[tone]}`}
    >
      {children}
    </div>
  );
}

const BADGE_TONES = {
  neutral: "bg-surface-2 text-fg-muted border-line",
  good: "bg-good/15 text-good border-good/25",
  warn: "bg-warn/15 text-warn border-warn/25",
  bad: "bg-bad/15 text-bad border-bad/25",
  info: "bg-info/15 text-info border-info/25",
} as const;

export function Badge({
  tone = "neutral",
  children,
}: {
  tone?: keyof typeof BADGE_TONES;
  children: ReactNode;
}) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-semibold ${BADGE_TONES[tone]}`}
    >
      <span aria-hidden className="size-1.5 rounded-full bg-current" />
      {children}
    </span>
  );
}

export function Table({ headers, children }: { headers: string[]; children: ReactNode }) {
  return (
    <div className="overflow-x-auto rounded-2xl border border-line bg-surface shadow-card">
      <table className="min-w-full text-sm">
        <thead>
          <tr className="border-b border-line text-left text-[11px] font-semibold uppercase tracking-widest text-fg-muted">
            {headers.map((h) => (
              <th key={h} className="px-5 py-3.5 font-semibold">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-line [&>tr]:transition-colors [&>tr:hover]:bg-surface-2/60">
          {children}
        </tbody>
      </table>
    </div>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return (
    <div className="rounded-2xl border border-dashed border-line px-6 py-14 text-center text-sm text-fg-muted">
      {children}
    </div>
  );
}

export function Spinner() {
  return (
    <div className="flex items-center justify-center gap-3 p-12 text-sm text-fg-muted">
      <span className="size-2 animate-pulse rounded-full bg-accent" />
      Cargando…
    </div>
  );
}

export function formatDate(value: string | Date): string {
  return new Intl.DateTimeFormat("es-AR", { dateStyle: "medium", timeStyle: "short" }).format(
    new Date(value),
  );
}

class ErrorBoundary extends Component<{ children: ReactNode }, { error: unknown }> {
  constructor(props: { children: ReactNode }) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error: unknown) {
    return { error };
  }

  override render() {
    if (this.state.error) {
      const message =
        this.state.error instanceof Error
          ? this.state.error.message
          : "Ocurrió un error inesperado";
      return <Alert>{message}</Alert>;
    }
    return this.props.children;
  }
}

// Carga con useSuspenseQuery: muestra Cargando mientras espera y el error si falla.
export function Boundary({ children }: { children: ReactNode }) {
  return (
    <ErrorBoundary>
      <Suspense fallback={<Spinner />}>{children}</Suspense>
    </ErrorBoundary>
  );
}

// Paginación de listas con total, límite y offset (los mismos campos que devuelve la API).
export function Pager({
  total,
  limit,
  offset,
  onChange,
}: {
  total: number;
  limit: number;
  offset: number;
  onChange: (offset: number) => void;
}) {
  if (total <= limit) return null;
  const page = Math.floor(offset / limit) + 1;
  const pages = Math.ceil(total / limit);
  return (
    <div className="flex items-center justify-end gap-3 text-sm text-fg-muted">
      <Button
        variant="secondary"
        disabled={offset === 0}
        onClick={() => {
          onChange(Math.max(0, offset - limit));
        }}
      >
        Anterior
      </Button>
      <span className="num">
        Página {page} de {pages}
      </span>
      <Button
        variant="secondary"
        disabled={offset + limit >= total}
        onClick={() => {
          onChange(offset + limit);
        }}
      >
        Siguiente
      </Button>
    </div>
  );
}

// Marca de la app: un bloque con degradado y las iniciales de Commerce Core.
export function BrandMark({ size = "md" }: { size?: "sm" | "md" | "lg" }) {
  const dims = { sm: "size-7 text-[11px]", md: "size-9 text-xs", lg: "size-12 text-sm" }[size];
  return (
    <span
      aria-hidden
      className={`inline-flex ${dims} items-center justify-center rounded-xl bg-gradient-to-br from-accent to-[#ff7a1a] font-extrabold tracking-tight text-accent-fg shadow-[0_10px_30px_-12px_var(--accent)]`}
    >
      CC
    </span>
  );
}
