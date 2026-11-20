import { z } from "zod";

// Política de contraseña única para alta, invitación y reseteo: mínimo 10, con letras y números.
export const passwordSchema = z
  .string()
  .min(10)
  .max(200)
  .regex(/[A-Za-z]/, "La contraseña debe incluir letras")
  .regex(/\d/, "La contraseña debe incluir números");
