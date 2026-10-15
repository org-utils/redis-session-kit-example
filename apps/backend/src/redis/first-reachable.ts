// A connection of the showcase's own (not the package's) to the first of several Redis endpoints that answers, for
// commands the package's facade doesn't have (CLUSTER, SENTINEL…). Always tried in the given order, so it is the same
// endpoint while that one is up. The caller ends it with disconnect() (Redis 8 sentinels reject QUIT).
import { Redis } from 'ioredis';

export interface Address {
  host: string;
  port: number;
}

const CONNECT_TIMEOUT_MS = 1000;

/** A connection that fails fast and never reconnects: for one request's commands. */
export function oneOff({ host, port }: Address): Redis {
  const redis = new Redis({ host, port, lazyConnect: true, connectTimeout: CONNECT_TIMEOUT_MS, maxRetriesPerRequest: 0, retryStrategy: () => null });
  redis.on('error', () => {}); // a failure surfaces as the connect() or command rejection
  return redis;
}

export async function firstReachable(addresses: Address[]): Promise<{ redis: Redis; address: string }> {
  const failures: string[] = [];
  for (const address of addresses) {
    const redis = oneOff(address);
    try {
      await redis.connect();
      return { redis, address: `${address.host}:${address.port}` };
    } catch (error) {
      redis.disconnect();
      failures.push(`${address.host}:${address.port}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  throw new Error(`None answered (${failures.join('; ')})`);
}
