// The client feature module's temporary-client demos per connection mode, against the Docker stacks (`pnpm infra:up`):
// config validation, namespace collisions, with*() overrides and shutdown, each on a client created and closed per request.
import assert from 'node:assert/strict';
import { after, afterEach, before, describe, test } from 'node:test';
import { MODES } from '@showcase/contracts';
import { buildApp, FEATURE_MODULES, type FeatureModule } from '../../app.ts';
import type { TemporaryClients } from '../../redis/temporary-clients.ts';
import { testConfig } from '../../test-config.ts';
import { clientModule } from './plugin.ts';

// Every mode's temporary-client factory, as the client module is handed it, so each test can check none is left open.
const factories: TemporaryClients[] = [];
const spied: FeatureModule = async (app, options) => {
  factories.push(options.temporaryClients);
  await clientModule(app, options);
};

const app = await buildApp({ config: testConfig(), modules: { ...FEATURE_MODULES, client: spied } });
before(() => app.ready());
after(() => app.close());
afterEach(() => {
  assert.equal(factories.length, MODES.length);
  assert.deepEqual(factories.map((f) => f.open), MODES.map(() => 0), 'a temporary client was left open');
});

for (const mode of MODES) {
  describe(mode, () => {
    const call = async (op: string, body: unknown = {}) => {
      const res = await app.inject({ method: 'POST', url: `/api/${mode}/client/${op}`, payload: body as object });
      return { status: res.statusCode, body: res.json() };
    };

    describe('config validation: rejected before anything connects', () => {
      const rejects = (title: string, config: object, code: string, message: RegExp) =>
        test(title, async () => {
          const res = await call('validate', { config });
          assert.equal(res.status, 500);
          assert.equal(res.body.error.code, code);
          assert.match(res.body.error.message, message);
          assert.deepEqual(res.body.redis.commands, []);
        });

      rejects('sentinel without a master name', { mode: 'sentinel', sentinels: [{ host: '127.0.0.1', port: 26379 }] }, 'REDIS_CONFIGURATION', /name/);
      rejects('cluster with no nodes', { mode: 'cluster', nodes: [] }, 'REDIS_CONFIGURATION', /nodes/);
      rejects('port 70000', { mode: 'standalone', host: '127.0.0.1', port: 70000 }, 'REDIS_CONFIGURATION', /port/);
      rejects(
        'lock defaultTtl above maxTtl',
        { mode: 'standalone', lock: { enabled: true, namespace: 'app:lock', defaultTtl: 600, maxTtl: 300 } },
        'LOCK_CONFIGURATION',
        /defaultTtl must not exceed maxTtl/,
      );

      test('a valid config is accepted and closed before it connects', async () => {
        const res = await call('validate', { config: { mode: 'standalone', host: '127.0.0.1', port: 6379 } });
        assert.equal(res.status, 200);
        assert.deepEqual(res.body.result, { created: true });
        assert.deepEqual(res.body.redis.commands, []);
      });
    });

    describe('namespace collision', () => {
      for (const [title, cache, sessions] of [
        ['prefix overlap', 'app:cache', 'app'],
        ['same namespace', 'shared', 'shared'],
      ]) {
        test(`${title}: rejected before anything connects`, async () => {
          const res = await call('collide', { cache, sessions });
          assert.equal(res.status, 500);
          assert.equal(res.body.error.code, 'REDIS_CONFIGURATION');
          assert.equal(res.body.error.message, `Modules cache and sessions have overlapping namespaces "${cache}" and "${sessions}"`);
          assert.deepEqual(res.body.redis.commands, []);
        });
      }

      test('similar but safe: accepted on this mode, then closed', async () => {
        const res = await call('collide', { cache: 'application', sessions: 'app' });
        assert.equal(res.status, 200);
        assert.deepEqual(res.body.result, { created: true, namespaces: { cache: 'application', sessions: 'app' } });
      });
    });

    describe('with*() overrides on a client configured like the mode client', () => {
      type Step = { call: string; ok: boolean; value?: Record<string, unknown>; error?: { code: string; message: string } };
      const steps = async (body: object) => {
        const res = await call('with', { replace: false, whileSubscribed: false, ...body });
        assert.equal(res.status, 200);
        return { steps: res.body.result.steps as Step[], redis: res.body.redis };
      };

      test('merge: withCache({ defaultTtl: 5 }), then a set without a ttl gets 5 s', async () => {
        const { steps: [before, override, after, set, ttl], redis } = await steps({ method: 'withCache', options: { defaultTtl: 5 } });
        assert.deepEqual([before.call, before.value?.defaultTtl], ['redis.config.cache', 300]);
        assert.deepEqual([override.call, override.ok], ['redis.withCache({ defaultTtl: 5 })', true]);
        assert.deepEqual([after.value?.defaultTtl, after.value?.namespace, after.value?.enabled], [5, 'showcase:cache', true]);
        assert.deepEqual([set.call, set.ok], ["redis.cache.set('with-demo', 'merged')", true]);
        assert.deepEqual([ttl.call, ttl.value], ["redis.cache.ttl('with-demo')", 5]);
        assert.deepEqual(redis.keys.map((k: { key: string; ttl: number }) => [k.key, k.ttl]), [['showcase:cache:with-demo', 5]]);
      });

      test("replace: the omitted fields reset, so enabled is false and cache throws", async () => {
        const { steps: [, override, after, set, ...rest] } = await steps({ method: 'withCache', options: { defaultTtl: 5 }, replace: true });
        assert.deepEqual([override.call, override.ok], ["redis.withCache({ defaultTtl: 5 }, 'replace')", true]);
        assert.deepEqual([after.value?.enabled, after.value?.defaultTtl], [false, 5]);
        assert.deepEqual([set.ok, set.error?.code, set.error?.message], [false, 'REDIS_CONFIGURATION', 'Cache module is disabled']);
        assert.deepEqual(rest, []);
      });

      test('a colliding override throws and keeps the config in effect', async () => {
        const { steps: [before, override, after, ...rest] } = await steps({ method: 'withLock', options: { namespace: 'showcase:cache' } });
        assert.equal(before.value?.namespace, 'showcase:lock');
        assert.deepEqual([override.ok, override.error?.code], [false, 'REDIS_CONFIGURATION']);
        assert.match(override.error!.message, /overlapping namespaces "showcase:cache" and "showcase:cache"/);
        assert.deepEqual(after, { ...before });
        assert.deepEqual(rest, []);
      });

      test('withPubSub() while subscribed throws PUBSUB_STATE', async () => {
        const { steps: [subscribe, , override] } = await steps({ method: 'withPubSub', options: {}, whileSubscribed: true });
        assert.deepEqual([subscribe.call, subscribe.ok], ["redis.pubsub.subscribe('orders.created', handler)", true]);
        assert.deepEqual([override.ok, override.error?.code], [false, 'PUBSUB_STATE']);
      });
    });

    describe('shutdown', () => {
      type Step = { call: string; ok: boolean; value?: unknown; error?: { message: string } };
      const shutdown = async (body: object) => {
        const res = await call('shutdown', body);
        assert.equal(res.status, 200);
        return { steps: res.body.result.steps as Step[], redis: res.body.redis };
      };
      const outcome = ({ call, ok, value, error }: Step) => {
        // On cluster, PUBLISH counts only the subscribers on the node that took it, so the count depends on the node.
        if (mode === 'cluster' && call.includes('publish(')) return [call, typeof value];
        return [call, ok ? (value ?? 'ok') : error?.message];
      };
      const count = (n: number) => (mode === 'cluster' ? 'number' : n);

      test('close with a live subscription and a blocked stream read: what each sees, then what fails after', async () => {
        const { steps, redis } = await shutdown({ liveWork: true, closeTwice: false });
        assert.deepEqual(steps.map(outcome), [
          ["redis.pubsub.subscribe('orders.created', handler)", 'ok'],
          ["redis.pubsub.publish('orders.created', { orderId: '42' })", count(1)],
          ['redis.close()', 'ok'],
          ["redis.streams.read('orders', { id: '$', blockMs: 0 })", 'Connection is closed.'],
          ["modeClient.publish('showcase:client:events:orders.created', JSON.stringify({ orderId: '43' }))", count(0)],
          ['messages the handler received', [{ channel: 'orders.created', value: { orderId: '42' } }]],
          // The same text on every mode, cluster included (the package rejects it itself since 1.0.6).
          ["redis.pubsub.subscribe('orders.created', handler)", 'Connection is closed.'],
        ]);
        // The read was waiting in Redis when the client closed.
        const { args } = redis.commands.find((c: { name: string }) => c.name === 'xread');
        assert.equal(args[args.indexOf('BLOCK') + 1], '0');
        // The subscribe after close never reached Redis, so the trace lists only the first.
        assert.equal(redis.commands.filter((c: { name: string }) => c.name === 'subscribe').length, 1);
      });

      test('close twice: the second close resolves too', async () => {
        const { steps } = await shutdown({ liveWork: false, closeTwice: true });
        assert.deepEqual(steps.map(outcome), [['redis.close()', 'ok'], ['redis.close()', 'ok']]);
      });
    });
  });
}
