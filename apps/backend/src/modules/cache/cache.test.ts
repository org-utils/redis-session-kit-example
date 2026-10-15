// Smoke test of the cache feature module per connection mode, against the Docker stacks (`pnpm infra:up`).
import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { MODES } from '@showcase/contracts';
import { buildApp } from '../../app.ts';
import { testConfig } from '../../test-config.ts';

const app = await buildApp({ config: testConfig() });
before(() => app.ready());
after(() => app.close());

/** Where each mode's commands go: sentinel's master is whichever of 6380/6381 Sentinel names. */
const ADDRESS = { standalone: /^127\.0\.0\.1:6379$/, sentinel: /^127\.0\.0\.1:638[01]$/, cluster: /^127\.0\.0\.1:700[123]$/ };

for (const mode of MODES) {
  describe(mode, () => {
    const call = async (op: string, body: unknown = {}) => {
      const res = await app.inject({ method: 'POST', url: `/api/${mode}/cache/${op}`, payload: body as object });
      return { status: res.statusCode, body: res.json() };
    };

    before(() => call('reset-section'));

    test('reset-section deletes every key in the cache namespace on this mode', async () => {
      await call('set', { key: 'a', value: 1 });
      await call('set', { key: 'b:c', value: 2 });
      const reset = await call('reset-section');
      assert.equal(reset.status, 200);
      assert.ok(reset.body.result >= 2, `deleted ${reset.body.result}`);
      assert.deepEqual((await call('has', { key: 'b:c' })).body.result, false);
    });

    test('set then get returns the cached value', async () => {
      const set = await call('set', { key: 'user:42', value: { id: '42', name: 'Ada' }, ttl: 300 });
      assert.deepEqual([set.status, set.body.result], [200, true]);
      const get = await call('get', { key: 'user:42' });
      assert.deepEqual(get.body.result, { hit: true, value: { id: '42', name: 'Ada' } });
    });

    test('the response carries the Redis trace: commands sent and the keys touched, with their TTL', async () => {
      const res = await call('set', { key: 'user:42', value: { id: '42', name: 'Ada' }, ttl: 300 });
      const { commands, keys } = res.body.redis;
      assert.deepEqual(commands.map((c: { name: string; args: string[] }) => [c.name, ...c.args]), [
        ['set', 'showcase:cache:user:42', '{"id":"42","name":"Ada"}', 'EX', '300'],
      ]);
      assert.match(commands[0].node, ADDRESS[mode]);
      assert.equal(keys.length, 1);
      const [{ key, type, ttl, slot, node }] = keys;
      assert.deepEqual([key, type], ['showcase:cache:user:42', 'string']);
      assert.ok(ttl > 295 && ttl <= 300, `ttl ${ttl}`);
      if (mode === 'cluster') assert.deepEqual([slot, node], [15914, '127.0.0.1:7003']);
      else assert.deepEqual([slot, node], [undefined, undefined]);
    });

    test('an error response carries the trace too: the package refused before sending anything', async () => {
      const res = await call('set', { key: 'user:42', value: 1, nx: true, xx: true });
      assert.deepEqual(res.body.redis, { commands: [], keys: [] });
    });

    test("get: a miss is { hit: false }, and the getValue switch returns just the value", async () => {
      assert.deepEqual((await call('get', { key: 'user:missing' })).body.result, { hit: false, value: null });
      assert.deepEqual((await call('get', { key: 'user:42', getValue: true })).body.result, { id: '42', name: 'Ada' });
      assert.equal((await call('get', { key: 'user:missing', getValue: true })).body.result, null);
    });

    test('getValue on a cached string returns the string, traced like any result', async () => {
      await call('set', { key: 'otp:42', value: '731902', ttl: 5 });
      const res = await call('get', { key: 'otp:42', getValue: true });
      assert.equal(res.body.result, '731902');
      assert.deepEqual(res.body.redis.keys.map((k: { key: string }) => k.key), ['showcase:cache:otp:42']);
    });

    test('set XX on a missing key returns false', async () => {
      const res = await call('set', { key: 'user:404', value: { id: '404' }, ttl: 300, xx: true });
      assert.deepEqual([res.status, res.body.result], [200, false]);
    });

    test("NX and XX together answer the package's CACHE_INPUT error", async () => {
      const res = await call('set', { key: 'user:42', value: 1, nx: true, xx: true });
      assert.equal(res.status, 400);
      assert.deepEqual([res.body.error.code, res.body.error.name, res.body.error.mode], ['CACHE_INPUT', 'CacheError', mode]);
    });

    test('has and ttl: present with seconds left, missing as false and -2', async () => {
      assert.equal((await call('has', { key: 'user:42' })).body.result, true);
      const ttl = (await call('ttl', { key: 'user:42' })).body.result;
      assert.ok(ttl > 290 && ttl <= 300, `ttl ${ttl}`);
      assert.equal((await call('has', { key: 'user:missing' })).body.result, false);
      assert.equal((await call('ttl', { key: 'user:missing' })).body.result, -2);
    });

    test('setIfAbsent: the first writer wins', async () => {
      const first = await call('setIfAbsent', { key: 'job:42:result', value: { status: 'done' }, ttl: 60 });
      const second = await call('setIfAbsent', { key: 'job:42:result', value: { status: 'late' }, ttl: 60 });
      assert.deepEqual([first.body.result, second.body.result], [true, false]);
      assert.deepEqual((await call('get', { key: 'job:42:result' })).body.result.value, { status: 'done' });
    });

    test('delete counts only the keys that existed', async () => {
      await call('set', { key: 'otp:42', value: '731902', ttl: 5 });
      const res = await call('delete', { keys: ['user:42', 'otp:42', 'user:missing'] });
      assert.equal(res.body.result, 2);
    });

    test('clear deletes only the keys matching the pattern', async () => {
      await call('set', { key: 'user:1', value: 1 });
      await call('set', { key: 'user:2', value: 2 });
      assert.equal((await call('clear', { pattern: 'user:*' })).body.result, 2);
      assert.equal((await call('has', { key: 'job:42:result' })).body.result, true);
    });

    test('clear: the deleted keys show as gone, and on cluster every master was scanned', async () => {
      await call('set', { key: 'user:1', value: 1 });
      await call('set', { key: 'user:2', value: 2 });
      const { commands, keys } = (await call('clear', { pattern: 'user:*' })).body.redis;
      const byKey = Object.fromEntries(keys.map((k: { key: string }) => [k.key, k]));
      for (const key of ['showcase:cache:user:1', 'showcase:cache:user:2']) {
        assert.deepEqual([byKey[key].type, byKey[key].ttl], ['none', null]);
      }
      const scanned = new Set(commands.filter((c: { name: string }) => c.name === 'scan').map((c: { node: string }) => c.node));
      if (mode === 'cluster') {
        assert.deepEqual([...scanned].sort(), ['127.0.0.1:7001', '127.0.0.1:7002', '127.0.0.1:7003']);
        assert.deepEqual([byKey['showcase:cache:user:1'].slot, byKey['showcase:cache:user:1'].node], [3830, '127.0.0.1:7001']);
      } else {
        assert.equal(scanned.size, 1);
      }
    });
  });
}
