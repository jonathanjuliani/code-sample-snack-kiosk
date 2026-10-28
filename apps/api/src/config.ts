import { fileURLToPath } from 'node:url';
import { z } from 'zod';

const DEFAULT_SEED_PATH = fileURLToPath(new URL('../seed/menu.json', import.meta.url));

const envSchema = z.object({
  PORT: z.coerce.number().int().positive().default(3000),
  HOST: z.string().default('0.0.0.0'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  DB_PATH: z.string().default('data/kiosk.db'),
  SEED_PATH: z.string().default(DEFAULT_SEED_PATH),
  PAYMENT_SLOW_MS: z.coerce.number().int().nonnegative().default(15_000),
  CHAOS_LATENCY_MS: z.coerce.number().int().nonnegative().default(0),
  CHAOS_FAIL_RATE: z.coerce.number().min(0).max(1).default(0),
});

export type Config = z.infer<typeof envSchema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = envSchema.safeParse(env);
  if (!parsed.success) {
    throw new Error(`Invalid environment: ${z.prettifyError(parsed.error)}`);
  }
  return parsed.data;
}
