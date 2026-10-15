// Temporary clients: package clients the client feature module creates for one request and closes before it answers, so
// its demos (config validation, namespace collisions, with*() overrides, shutdown) never change a mode client.
import { createRedisClient, type RedisClient, type RedisClientConfig, type RedisConfig, type RedisErrorContext } from 'ioredis-toolkit';

export interface TemporaryClients {
  /**
   * Creates a client from the config `configure` builds on this mode's connection settings, hands it to `use`, and closes
   * it once `use` settles, however it ends. A config the package rejects throws before anything is created.
   */
  using<T>(configure: (connection: RedisConfig) => RedisClientConfig, use: (client: RedisClient) => Promise<T>): Promise<T>;
  /** How many temporary clients are open right now: 0 between requests. */
  readonly open: number;
}

/** Temporary clients on one mode's connection; their background errors go to `onError`. */
export function createTemporaryClients(
  connection: RedisConfig,
  onError: (error: unknown, context: RedisErrorContext) => void,
): TemporaryClients {
  let open = 0;
  return {
    get open() {
      return open;
    },
    async using(configure, use) {
      const client = createRedisClient(configure(connection), { onError });
      open++;
      try {
        return await use(client);
      } finally {
        await client.close();
        open--;
      }
    },
  };
}
