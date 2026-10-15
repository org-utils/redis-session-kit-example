// Smoke test of the client feature module's mode-client operations (health() and raw multi-key commands) per connection
// mode, against the Docker stacks (`pnpm infra:up`).
import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { MODES } from '@showcase/contracts';
import { buildApp } from '../../app.ts';
import { testConfig } from '../../test-config.ts';

const app = await buildApp({ config: testConfig() });
before(() => app.ready());
after(() => app.close());

for (const mode of MODES) {
  describe(mode, () => {
    const call = async (op: string, body: unknown = {}) => {
      const res = await app.inject({ method: 'POST', url: `/api/${mode}/client/${op}`, payload: body as object });
      return { status: res.statusCode, body: res.json() };
    };

    test('health() answers with its status and latency; on cluster, one entry per master', async () => {
      const { status, body } = await call('health', { timeoutMs: 3000, degradedMs: 500 });
      assert.equal(status, 200);
      assert.equal(body.result.status, 'healthy');
      assert.equal(typeof body.result.latencyMs, 'number');
      const nodes = body.result.nodes?.map((n: { address: string }) => n.address).sort();
      assert.deepEqual(nodes, mode === 'cluster' ? ['127.0.0.1:7001', '127.0.0.1:7002', '127.0.0.1:7003'] : undefined);
    });

    const PROFILE = 'showcase:cache:user:42'; // slot 15914
    const OTP = 'showcase:cache:otp:42'; // slot 13606, also on 7003
    const OTHER_NODE = 'showcase:cache:user:1'; // slot 3830, on 7001
    const TAGGED = ['showcase:client:{user:42}:profile', 'showcase:client:{user:42}:cart']; // both slot 15880
    before(async () => {
      const set = (key: string, value: unknown) =>
        app.inject({ method: 'POST', url: `/api/${mode}/cache/set`, payload: { key, value, ttl: 300 } });
      await set('user:42', { id: '42' });
      await set('otp:42', '731902');
      await set('user:1', { id: '1' });
    });

    test('raw mget across slots: the values everywhere but cluster, where Redis answers CROSSSLOT as a 502', async () => {
      const res = await call('raw', { command: 'mget', keys: [PROFILE, OTP] });
      if (mode === 'cluster') {
        assert.equal(res.status, 502);
        assert.equal(res.body.error.code, 'CROSSSLOT');
        assert.match(res.body.error.message, /^CROSSSLOT Keys in request don't hash to the same slot/);
        assert.deepEqual(res.body.redis.commands.map((c: { name: string }) => c.name), ['mget']);
      } else {
        assert.deepEqual([res.status, res.body.result], [200, ['{"id":"42"}', '"731902"']]);
      }
    });

    test('raw exists and two-key eval across slots: answered everywhere but cluster (CROSSSLOT)', async () => {
      const exists = await call('raw', { command: 'exists', keys: [PROFILE, OTP] });
      const evaluated = await call('raw', {
        command: 'eval', script: "return redis.call('MGET', KEYS[1], KEYS[2])", keys: [PROFILE, OTP], args: [],
      });
      if (mode === 'cluster') {
        assert.deepEqual([exists.status, exists.body.error.code], [502, 'CROSSSLOT']);
        assert.deepEqual([evaluated.status, evaluated.body.error.code], [502, 'CROSSSLOT']);
      } else {
        assert.deepEqual([exists.status, exists.body.result], [200, 2]);
        assert.deepEqual([evaluated.status, evaluated.body.result], [200, ['{"id":"42"}', '"731902"']]);
      }
    });

    test('raw pipeline across nodes: [error, value] per command, but on cluster ioredis refuses it before sending', async () => {
      const res = await call('raw', { command: 'pipeline', keys: [PROFILE, OTHER_NODE] });
      if (mode === 'cluster') {
        assert.equal(res.status, 502);
        assert.deepEqual([res.body.error.code, res.body.error.name], ['PIPELINE_SLOTS', 'Error']);
        assert.equal(res.body.error.message, 'All keys in the pipeline should belong to the same slots allocation group');
        assert.deepEqual(res.body.redis.commands, []);
      } else {
        assert.deepEqual([res.status, res.body.result], [200, [[null, '{"id":"42"}'], [null, '{"id":"1"}']]]);
      }
    });

    test('raw pipeline across slots on one node works on every mode: ioredis only needs one node', async () => {
      const res = await call('raw', { command: 'pipeline', keys: [PROFILE, OTP] });
      assert.deepEqual([res.status, res.body.result], [200, [[null, '{"id":"42"}'], [null, '"731902"']]]);
    });

    test('raw pipeline with a hash tag works on every mode', async () => {
      const res = await call('raw', { command: 'pipeline', keys: TAGGED });
      assert.deepEqual([res.status, res.body.result], [200, [[null, null], [null, null]]]);
    });

    test('raw mget with a hash tag works on every mode: one slot', async () => {
      const res = await call('raw', { command: 'mget', keys: TAGGED });
      assert.deepEqual([res.status, res.body.result], [200, [null, null]]);
    });

    type Sent = { name: string; node: string };
    const sent = (body: { redis: { commands: Sent[] } }, name: string) => body.redis.commands.filter((c) => c.name === name);

    test('mgetClusterAware works on every mode, in input order; on cluster one MGET per slot', async () => {
      const res = await call('raw', { command: 'mgetClusterAware', keys: [PROFILE, OTHER_NODE, OTP] });
      assert.deepEqual([res.status, res.body.result], [200, ['{"id":"42"}', '{"id":"1"}', '"731902"']]);
      assert.equal(sent(res.body, 'mget').length, mode === 'cluster' ? 3 : 1);
    });

    test('scanCluster finds the matching keys; on cluster it scans every master', async () => {
      const res = await call('raw', { command: 'scanCluster', pattern: 'showcase:cache:user:*' });
      assert.equal(res.status, 200);
      assert.deepEqual([...res.body.result].sort(), [OTHER_NODE, PROFILE]);
      const nodes = new Set(sent(res.body, 'scan').map((c) => c.node));
      assert.equal(nodes.size, mode === 'cluster' ? 3 : 1);
    });

    test('del across slots works on every mode, counting what existed; on cluster one DEL per slot', async () => {
      const res = await call('raw', { command: 'del', keys: [PROFILE, OTP, 'showcase:cache:missing'] });
      assert.deepEqual([res.status, res.body.result], [200, 2]);
      assert.equal(sent(res.body, 'del').length, mode === 'cluster' ? 3 : 1);
    });

    test('deletePatternClusterAware deletes every matching key on every mode', async () => {
      const res = await call('raw', { command: 'deletePatternClusterAware', pattern: 'showcase:cache:user:*' });
      assert.deepEqual([res.status, res.body.result], [200, 1]);
      assert.deepEqual((await call('raw', { command: 'scanCluster', pattern: 'showcase:cache:user:*' })).body.result, []);
    });
  });
}
