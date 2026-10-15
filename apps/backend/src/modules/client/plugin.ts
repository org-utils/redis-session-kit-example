// The client feature module. On the mode client: health() and the raw multi-key commands, which run outside every
// namespace and show which raw commands are cluster-safe. On a temporary client created and closed per request, so the
// mode client's configuration never changes: config validation, namespace collisions, with*() overrides and shutdown.
// Registered once per mode under /api/<mode>/client; it only ever sees that mode's clients.
import {
  CLIENT_WITH_METHODS,
  ClientCollideRequestSchema,
  ClientHealthRequestSchema,
  ClientRawRequestSchema,
  ClientShutdownRequestSchema,
  ClientValidateRequestSchema,
  ClientWithRequestSchema,
} from '@showcase/contracts';
import { setTimeout as sleep } from 'node:timers/promises';
import type { PubSubMessage, RedisClientConfig } from 'ioredis-toolkit';
import type { FeatureModule } from '../../app.ts';
import { MODE_CLIENT_MODULES } from '../../redis/mode-clients.ts';
import { createTranscript, literal } from './transcript.ts';

/** The shutdown demo's Pub/Sub namespace. */
const SHUTDOWN_EVENTS = 'showcase:client:events';
/** Long enough for the blocking read to reach Redis (on cluster, after its reader connection loads the slots). */
const READ_SETTLE_MS = 250;
/** Long enough for a published message to reach a subscriber that is still listening. */
const DELIVERY_MS = 100;

export const clientModule: FeatureModule = async (app, { client, temporaryClients }) => {
  app.post('/health', { schema: { body: ClientHealthRequestSchema } }, ({ body }) => client.health(body));

  // The visitor's whole config, not this mode's connection; lazyConnect keeps an accepted one from connecting anywhere.
  app.post('/validate', { schema: { body: ClientValidateRequestSchema } }, ({ body }) =>
    temporaryClients.using(
      () => ({ ...(body.config as RedisClientConfig), lazyConnect: true }),
      async () => ({ created: true }),
    ),
  );

  app.post('/collide', { schema: { body: ClientCollideRequestSchema } }, ({ body }) =>
    temporaryClients.using(
      (connection) => ({
        ...connection,
        cache: { enabled: true, namespace: body.cache },
        sessions: { enabled: true, namespace: body.sessions },
      }),
      async ({ config }) => ({ created: true, namespaces: { cache: config.cache.namespace, sessions: config.sessions.namespace } }),
    ),
  );

  app.post('/with', { schema: { body: ClientWithRequestSchema } }, ({ body: { method, options, replace, whileSubscribed } }) =>
    temporaryClients.using(
      (connection) => ({ ...connection, ...MODE_CLIENT_MODULES }),
      async (redis) => {
        const { steps, step } = createTranscript();
        const section = CLIENT_WITH_METHODS[method];
        if (whileSubscribed) {
          await step("redis.pubsub.subscribe('orders.created', handler)", async () => {
            await redis.pubsub.subscribe('orders.created', () => undefined);
          });
        }
        await step(`redis.config.${section}`, () => ({ ...redis.config[section] }));
        const call = `redis.${method}(${literal(options)}${replace ? ", 'replace'" : ''})`;
        // Each section's options are checked by the package; the cast only names the method.
        const overridden = await step(call, () => void redis[method](options as never, replace ? 'replace' : 'merge'));
        await step(`redis.config.${section}`, () => ({ ...redis.config[section] }));
        if (overridden && method === 'withCache') {
          if (await step("redis.cache.set('with-demo', 'merged')", () => redis.cache.set('with-demo', 'merged'))) {
            await step("redis.cache.ttl('with-demo')", () => redis.cache.ttl('with-demo'));
          }
        }
        return { steps };
      },
    ),
  );

  // Its own Pub/Sub namespace, so the mode client can publish to it after the close and count who still listens.
  app.post('/shutdown', { schema: { body: ClientShutdownRequestSchema } }, ({ body: { liveWork, closeTwice } }) =>
    temporaryClients.using(
      (connection) => ({ ...connection, ...MODE_CLIENT_MODULES, pubsub: { enabled: true, namespace: SHUTDOWN_EVENTS } }),
      async (redis) => {
        const { steps, step } = createTranscript();
        const received: PubSubMessage[] = [];
        const handler = (message: PubSubMessage) => void received.push(message);
        const subscribe = async () => void (await redis.pubsub.subscribe('orders.created', handler));
        let reading: Promise<unknown> | undefined;
        if (liveWork) {
          await step("redis.pubsub.subscribe('orders.created', handler)", subscribe);
          await step("redis.pubsub.publish('orders.created', { orderId: '42' })", () => redis.pubsub.publish('orders.created', { orderId: '42' }));
          // Waits in Redis for an entry that never comes; how it ends is recorded after the close.
          reading = redis.streams.read('orders', { id: '$', blockMs: 0 });
          reading.catch(() => undefined);
          await sleep(READ_SETTLE_MS);
        }
        await step('redis.close()', () => redis.close());
        if (reading) {
          await step("redis.streams.read('orders', { id: '$', blockMs: 0 })", () => reading);
          const channel = `${SHUTDOWN_EVENTS}:orders.created`;
          await step(`modeClient.publish('${channel}', JSON.stringify({ orderId: '43' }))`, () =>
            client.publish(channel, JSON.stringify({ orderId: '43' })),
          );
          await sleep(DELIVERY_MS);
          await step('messages the handler received', () => received);
          await step("redis.pubsub.subscribe('orders.created', handler)", subscribe);
        }
        if (closeTwice) await step('redis.close()', () => redis.close());
        return { steps };
      },
    ),
  );

  app.post('/raw', { schema: { body: ClientRawRequestSchema } }, async ({ body }) => {
    switch (body.command) {
      case 'mget':
        return client.mget(...body.keys);
      case 'exists':
        return client.exists(...body.keys);
      case 'eval':
        return client.eval(body.script, body.keys.length, ...body.keys, ...body.args);
      case 'mgetClusterAware':
        return client.mgetClusterAware(body.keys);
      case 'del':
        return client.del(...body.keys);
      case 'scanCluster':
        return client.scanCluster(body.pattern);
      case 'deletePatternClusterAware':
        return client.deletePatternClusterAware(body.pattern);
      case 'pipeline': {
        const pipeline = client.pipeline();
        for (const key of body.keys) pipeline.get(key);
        // exec() resolves to [error, value] per command; an error is sent as its message.
        const replies = (await pipeline.exec()) ?? [];
        return replies.map(([error, value]) => [error ? error.message : null, value]);
      }
    }
  });
};
