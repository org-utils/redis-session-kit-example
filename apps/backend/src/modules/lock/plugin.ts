// The lock feature module: one POST per public lock method, each returning exactly what the package returned, and the
// lease as Redis holds it for the live pane. Registered once per mode under /api/<mode>/lock; it only ever sees that
// mode's client.
import { setTimeout as sleep } from 'node:timers/promises';
import {
  LockAcquireRequestSchema, LockExtendRequestSchema, LockLeaseQuerySchema, LockReleaseRequestSchema, LockUsingRequestSchema,
  type LockLease,
} from '@showcase/contracts';
import type { RedisClient } from 'ioredis-toolkit';
import type { FeatureModule } from '../../app.ts';
import { untraced } from '../../redis/redis-trace.ts';

/** GET and PTTL in one round trip, on whichever node owns the key. A missing key's GET comes back as null. */
const LEASE = "return { redis.call('GET', KEYS[1]), redis.call('PTTL', KEYS[1]) }";

async function readLease(client: RedisClient, key: string): Promise<LockLease> {
  const [token, pttl] = (await client.eval(LEASE, 1, key)) as [string | null, number];
  return { key, token: token ?? null, ttlMs: token === null || pttl < 0 ? null : pttl };
}

export const lockModule: FeatureModule = async (app, { client, events }) => {
  const { lock } = client;

  app.post('/acquire', { schema: { body: LockAcquireRequestSchema } }, ({ body }) => lock.acquire(body.name, body.ttl));
  app.post('/extend', { schema: { body: LockExtendRequestSchema } }, ({ body: { name, token, ttl } }) =>
    lock.extend(name, token, ttl),
  );
  app.post('/release', { schema: { body: LockReleaseRequestSchema } }, ({ body }) => lock.release(body.name, body.token));

  // The request stays open while the callback "works"; it answers with what using() resolved to, or LOCK_HELD.
  app.post('/using', { schema: { body: LockUsingRequestSchema } }, ({ body: { name, work, ttl } }) =>
    lock.using(
      name,
      async (token) => {
        await sleep(work * 1000);
        // A release after the lease lapsed deletes nothing and returns false: the package reports only a release that
        // throws, so the showcase checks for itself (outside the trace: this read is not the package's).
        const { token: holder } = await untraced(() => readLease(client, lock.key(name)));
        if (holder !== token) {
          events.append({
            kind: 'showcase',
            source: 'lock-release',
            message:
              `${name}: the lease ran out mid-work, so the release inside using() will delete nothing (release returns false). ` +
              'Noticed by the showcase: the package reports a release only when it throws.',
          });
        }
        return { token, workedSeconds: work };
      },
      ttl,
    ),
  );

  // The live pane's view of the lease: native GET + PTTL, not a package call, so it is not traced.
  app.get('/lease', { schema: { querystring: LockLeaseQuerySchema } }, ({ query }) => readLease(client, lock.key(query.name)));

  // Reset section: a showcase convenience, not a lock call. Deletes everything under the lock namespace on this mode.
  app.post('/reset', () => client.deletePatternClusterAware(`${client.config.lock.namespace}:*`));
};
