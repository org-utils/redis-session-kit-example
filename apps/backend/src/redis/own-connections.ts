// Connections of the showcase's own (not the package's), for commands the package's facade doesn't have (CLUSTER,
// SENTINEL, CLIENT LIST…). They are named `showcase-probe`, so CLIENT LIST tells them apart from the package's. A
// one-off connection fails fast and never reconnects; its caller ends it with disconnect() (Redis 8 sentinels reject
// QUIT).
import { Redis } from 'ioredis';

export interface Address {
  host: string;
  port: number;
}

/** The connection name CLIENT LIST shows for every connection of the showcase's own. */
export const PROBE_NAME = 'showcase-probe';
const CONNECT_TIMEOUT_MS = 1000;
const COMMAND_TIMEOUT_MS = 2000;

/** `[k1, v1, k2, v2, …]` → `{ k1: v1, … }`: the shape of SENTINEL REPLICAS and CLUSTER SHARDS entries. */
export function pairs<V = string>(flat: unknown[]): Record<string, V> {
  const out: Record<string, V> = {};
  for (let i = 0; i < flat.length; i += 2) out[String(flat[i])] = flat[i + 1] as V;
  return out;
}

/** A connection for one request's commands: a node that accepts the connection but stalls fails it within 2 s. */
export function oneOff({ host, port }: Address): Redis {
  const redis = new Redis({
    host, port, connectionName: PROBE_NAME, lazyConnect: true,
    connectTimeout: CONNECT_TIMEOUT_MS, commandTimeout: COMMAND_TIMEOUT_MS, maxRetriesPerRequest: 0, retryStrategy: () => null,
  });
  redis.on('error', () => {}); // a failure surfaces as the connect() or command rejection
  return redis;
}

/** A one-off connection to the first of `addresses` that answers, always tried in that order. */
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
