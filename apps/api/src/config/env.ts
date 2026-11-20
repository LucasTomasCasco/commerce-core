import { z } from "zod";

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().default(3000),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]).default("info"),
  DATABASE_URL: z.string().min(1),
  APP_ORIGIN: z.url().default("http://localhost:5173"),
  SMTP_URL: z.string().default("smtp://localhost:1025"),
  MAIL_FROM: z.string().default("Commerce Core <no-reply@commerce-core.local>"),
  SESSION_TTL_DAYS: z.coerce.number().int().positive().default(7),
  AUTH_RATE_LIMIT_MAX: z.coerce.number().int().positive().default(10),
  // Saltos de proxy de confianza (nginx = 1). Con 0 la IP del cliente sale del socket, no de X-Forwarded-For.
  TRUST_PROXY: z.coerce.number().int().min(0).default(0),
  LOGIN_MAX_FAILURES: z.coerce.number().int().positive().default(5),
  LOGIN_LOCK_MINUTES: z.coerce.number().int().positive().default(15),
  ORDER_PENDING_TTL_HOURS: z.coerce.number().int().positive().default(48),
  IDEMPOTENCY_RETENTION_HOURS: z.coerce.number().int().positive().default(24),
  JOB_INTERVAL_SECONDS: z.coerce.number().int().positive().default(5),
});

export type Env = z.infer<typeof envSchema>;

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  return envSchema.parse(source);
}
