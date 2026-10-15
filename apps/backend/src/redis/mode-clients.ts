// The mode clients: exactly one package client per connection mode in SHOWCASE_MODES, built through the public
// facade, with all six modules enabled under identical `showcase:<module>` namespaces on every mode. The rate limiter
// allows 10 requests per 20 s (not the package's 100 per 60 s), so a window fills and resets in front of the visitor.
import type { Mode } from '@showcase/contracts';
import { createRedisClient, type RedisClient, type RedisConfig, type RedisErrorContext } from 'ioredis-toolkit';
import type { Config } from '../config/index.ts';

export type ModeClients = Map<Mode, RedisClient>;

export interface ModeClientHooks {
  /** Errors no caller can be given (connection, subscriber, handler…), tagged with the mode they came from. */
  onError: (mode: Mode, error: unknown, context: RedisErrorContext) => void;
}

/** Every module enabled, under the same namespaces on every mode. */
export const MODE_CLIENT_MODULES = {
  cache: { enabled: true, namespace: 'showcase:cache' },
  lock: { enabled: true, namespace: 'showcase:lock' },
  rateLimit: { enabled: true, namespace: 'showcase:rate-limit', maxRequests: 10, windowSeconds: 20 },
  pubsub: { enabled: true, namespace: 'showcase:events' },
  streams: { enabled: true, namespace: 'showcase:stream' },
  sessions: { enabled: true, namespace: 'showcase:session' },
};

export function connectionConfig(mode: Mode, config: Config): RedisConfig {
  switch (mode) {
    case 'standalone': {
      const url = new URL(config.REDIS_URL);
      return {
        mode,
        host: url.hostname,
        port: Number(url.port || 6379),
        db: Number(url.pathname.slice(1) || 0),
        ...(url.username && { username: decodeURIComponent(url.username) }),
        ...(url.password && { password: decodeURIComponent(url.password) }),
        ...(url.protocol === 'rediss:' && { tls: {} }),
      };
    }
    case 'sentinel':
      return { mode, sentinels: config.REDIS_SENTINELS, name: config.REDIS_SENTINEL_NAME };
    case 'cluster':
      return { mode, nodes: config.REDIS_CLUSTER_NODES };
  }
}

/** Creates the mode clients. Nothing waits for Redis, so a mode whose Redis is down still gets its client. */
export function createModeClients(config: Config, hooks: ModeClientHooks): ModeClients {
  return new Map(
    config.SHOWCASE_MODES.map((mode) => [
      mode,
      createRedisClient(
        { ...connectionConfig(mode, config), ...MODE_CLIENT_MODULES },
        { onError: (error, context) => hooks.onError(mode, error, context) },
      ),
    ]),
  );
}

export async function closeModeClients(clients: ModeClients): Promise<void> {
  await Promise.all([...clients.values()].map((client) => client.close()));
}
