import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { api, unwrap } from "../api/client.js";
import { useMe } from "../auth/session.js";
import { Button } from "./ui.js";

type Step = { title: string; body: string };

const PANEL_STEPS: Step[] = [
  {
    title: "Tus tiendas",
    body: "Desde el inicio ves todas las tiendas a las que perteneces. Entrá a una para empezar a trabajar.",
  },
  {
    title: "Catálogo",
    body: "Categorías y productos con búsqueda y filtros. Lo que archivás deja de verse en el storefront, pero el historial queda intacto.",
  },
  {
    title: "Stock con historial",
    body: "Cada entrada, venta, cancelación o ajuste queda registrado. El saldo siempre coincide con sus movimientos.",
  },
  {
    title: "Pedidos",
    body: "Cargá pedidos manuales con nombre, teléfono y nota. Pasan de pendiente a confirmado y a entregado. Cancelar devuelve el stock.",
  },
  {
    title: "Equipo y roles",
    body: "Invitá personas por email y creá roles con solo los permisos que necesitan. Podés revocar o reenviar invitaciones.",
  },
  {
    title: "Storefront público",
    body: "Tu catálogo se publica en /t/tu-tienda con precios y disponibilidad, sin mostrar cantidades exactas.",
  },
];

const ADMIN_STEPS: Step[] = [
  {
    title: "Tiendas",
    body: "Creá tiendas, invitá a sus propietarios y reenviá la invitación si hace falta. Cada tienda arranca con sus roles por defecto.",
  },
  {
    title: "Estado y auditoría",
    body: "Suspendé o reactivá una tienda y revisá su actividad. Tu acceso es de administración: no ves productos ni pedidos de los clientes.",
  },
  {
    title: "Monedas",
    body: "Agregá monedas nuevas. Cada tienda elige la suya al crearse y puede ser distinta a las demás.",
  },
  {
    title: "Transferir propiedad",
    body: "Podés pasar la propiedad de una tienda a otra persona. El propietario anterior conserva acceso con el rol que elijas.",
  },
];

// Tutorial de primer ingreso. Se muestra una vez por usuario (queda guardado en la base) y se puede
// reabrir desde el header con el evento "cc-open-tour".
export function OnboardingTour() {
  const me = useMe();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState(0);

  const finish = useMutation({
    mutationFn: () => unwrap(api.POST("/api/v1/auth/onboarding/complete")),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["me"] }),
  });

  useEffect(() => {
    if (me.data && !me.data.onboardingCompleted) setOpen(true);
    const reopen = () => {
      setStep(0);
      setOpen(true);
    };
    window.addEventListener("cc-open-tour", reopen);
    return () => {
      window.removeEventListener("cc-open-tour", reopen);
    };
  }, [me.data]);

  if (!open || !me.data) return null;

  const steps = me.data.isPlatformAdmin ? ADMIN_STEPS : PANEL_STEPS;
  const current = steps[step];
  const last = step === steps.length - 1;

  function close() {
    setOpen(false);
    setStep(0);
    if (me.data && !me.data.onboardingCompleted) finish.mutate();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-canvas/70 px-5 backdrop-blur-sm">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="tour-title"
        className="w-full max-w-md rounded-3xl border border-line bg-surface p-7 shadow-card"
      >
        <div className="mb-6 flex gap-1.5" aria-hidden>
          {steps.map((_, i) => (
            <span
              key={i}
              className={`h-1.5 flex-1 rounded-full transition ${i <= step ? "bg-accent" : "bg-surface-2"}`}
            />
          ))}
        </div>
        <p className="num text-xs font-semibold uppercase tracking-[0.2em] text-fg-muted">
          Paso {step + 1} de {steps.length}
        </p>
        <h2 id="tour-title" className="mt-2 text-2xl font-extrabold tracking-tight">
          {current?.title}
        </h2>
        <p className="mt-3 leading-relaxed text-fg-muted">{current?.body}</p>

        <div className="mt-8 flex items-center justify-between gap-3">
          <Button variant="ghost" onClick={close}>
            Omitir
          </Button>
          <div className="flex gap-2">
            {step > 0 && (
              <Button
                variant="secondary"
                onClick={() => {
                  setStep(step - 1);
                }}
              >
                Anterior
              </Button>
            )}
            <Button
              onClick={() => {
                if (last) close();
                else setStep(step + 1);
              }}
            >
              {last ? "Empezar" : "Siguiente"}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
