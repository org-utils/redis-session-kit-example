// The backend's environment, validated with zod. Every default matches the infra ports, so a fresh clone runs with no
// env file except the session encryption key that `scripts/ensure-env.mjs` writes to apps/backend/.env.
import { MODES, ModeSchema } from '@showcase/contracts';
import { z } from 'zod';

const list = (fallback: string) =>
  z.string().default(fallback).transform((s) => s.split(',').map((x) => x.trim()).filter(Boolean));

const address = z.string().regex(/^[^:]+:\d+$/, 'expected host:port').transform((s) => {
  const [host, port] = s.split(':');
  return { host, port: Number(port) };
});

const seconds = (fallback: number) => z.coerce.number().int().positive().default(fallback);

const EnvSchema = z.object({
  PORT: z.coerce.number().int().min(0).max(65535).default(4000),
  SHOWCASE_MODES: list(MODES.join(','))
    .pipe(z.array(ModeSchema).min(1))
    .refine((modes) => new Set(modes).size === modes.length, 'lists a mode twice')
    .transform((modes) => MODES.filter((mode) => modes.includes(mode))),
  REDIS_URL: z.url({ protocol: /^rediss?$/ }).default('redis://127.0.0.1:6379'),
  REDIS_SENTINELS: list('127.0.0.1:26379,127.0.0.1:26380,127.0.0.1:26381').pipe(z.array(address).min(1)),
  REDIS_SENTINEL_NAME: z.string().min(1).default('mymaster'),
  REDIS_CLUSTER_NODES: list('127.0.0.1:7001,127.0.0.1:7002,127.0.0.1:7003').pipe(z.array(address).min(1)),
  SESSION_TTL: seconds(3600),
  SESSION_IDLE_TIMEOUT: seconds(900),
  SESSION_ABSOLUTE_TIMEOUT: seconds(3600),
  SESSION_TOUCH_INTERVAL: seconds(10),
  SESSION_ENCRYPTION_KEY: z
    .base64({ error: 'missing or not base64: run `node scripts/ensure-env.mjs` from the repo root to generate one' })
    .refine((s) => Buffer.from(s, 'base64').length === 32, 'must decode to 32 bytes'),
  COOKIE_SECURE: z.stringbool().default(false),
});

export type Config = z.infer<typeof EnvSchema>;

/** Parses the environment. Throws a readable error listing every invalid variable. */
export function loadConfig(env: Record<string, string | undefined> = process.env): Config {
  const parsed = EnvSchema.safeParse(env);
  if (!parsed.success) throw new Error(`Invalid backend environment:\n${z.prettifyError(parsed.error)}`);
  return parsed.data;
}
