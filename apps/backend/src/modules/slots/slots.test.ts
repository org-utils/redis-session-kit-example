// The slots mode-specific module against the cluster Docker stack (`pnpm infra:up`). Expected slots are what the
// cluster itself answered to `redis-cli CLUSTER KEYSLOT`.
import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { buildApp } from '../../app.ts';
import { testConfig } from '../../test-config.ts';
import { openSse } from '../../test-sse.ts';

const app = await buildApp({ config: testConfig({ SHOWCASE_MODES: 'cluster' }) });
let base: string;
before(async () => {
  base = await app.listen({ port: 0, host: '127.0.0.1' });
});
after(() => app.close());

const inspect = async (keys: string[]) => {
  const res = await app.inject({ method: 'POST', url: '/api/cluster/slots/inspect', payload: { keys } });
  return { status: res.statusCode, body: res.json() };
};
const overview = async () => (await app.inject({ method: 'GET', url: '/api/cluster/slots/overview' })).json();

describe('key inspector', () => {
  test('hash-tagged keys share a slot: one group, so multi-key commands work', async () => {
    const { status, body } = await inspect(['{user:42}:profile', '{user:42}:cart', '{user:42}:orders']);
    assert.equal(status, 200);
    assert.deepEqual(body.result.keys.map((k: { slot: number; node: string }) => [k.slot, k.node]), [
      [15880, '127.0.0.1:7003'],
      [15880, '127.0.0.1:7003'],
      [15880, '127.0.0.1:7003'],
    ]);
    assert.equal(body.result.sameSlot, true);
    assert.deepEqual(body.result.groups, [{ slot: 15880, node: '127.0.0.1:7003', keys: ['{user:42}:profile', '{user:42}:cart', '{user:42}:orders'] }]);
  });

  test('plain related keys do not: three slots on three nodes', async () => {
    const { body } = await inspect(['user:42:profile', 'user:42:cart', 'user:42:orders']);
    assert.deepEqual(body.result.keys.map((k: { key: string; slot: number; node: string }) => [k.key, k.slot, k.node]), [
      ['user:42:profile', 9133, '127.0.0.1:7002'],
      ['user:42:cart', 12984, '127.0.0.1:7003'],
      ['user:42:orders', 3309, '127.0.0.1:7001'],
    ]);
    assert.equal(body.result.sameSlot, false);
    assert.equal(body.result.groups.length, 3);
  });

  test('an empty hash tag hashes the whole key: two slots on one node', async () => {
    const { body } = await inspect(['foo{}bar', 'foo{}baz']);
    assert.deepEqual(body.result.groups.map((g: { slot: number; node: string }) => [g.slot, g.node]), [
      [14292, '127.0.0.1:7003'],
      [14044, '127.0.0.1:7003'],
    ]);
  });

  test('slots and ranges come from Redis: CLUSTER KEYSLOT per key and CLUSTER SHARDS, in the trace', async () => {
    const { body } = await inspect(['user:42:profile', 'user:42:cart']);
    const sent = body.redis.commands.map((c: { name: string; args: string[] }) => [c.name.toLowerCase(), ...c.args]);
    assert.deepEqual(sent, [
      ['cluster', 'KEYSLOT', 'user:42:profile'],
      ['cluster', 'KEYSLOT', 'user:42:cart'],
      ['cluster', 'SHARDS'],
    ]);
    const ranges = body.result.shards.flatMap((s: { slots: { start: number; end: number }[] }) => s.slots);
    assert.equal(ranges.reduce((n: number, r: { start: number; end: number }) => n + r.end - r.start + 1, 0), 16384);
  });

  test('no keys, or too many, is a validation error', async () => {
    assert.equal((await inspect([])).status, 400);
    assert.equal((await inspect(Array.from({ length: 51 }, (_, i) => `k${i}`))).status, 400);
  });
});

describe('node overview', () => {
  test('each master: its slot ranges, key count, showcase keys by namespace', async () => {
    await app.inject({ method: 'POST', url: '/api/cluster/cache/set', payload: { key: 'user:42', value: { id: '42' }, ttl: 60 } });
    const { nodes } = await overview();
    assert.deepEqual(nodes.map((n: { address: string }) => n.address), ['127.0.0.1:7001', '127.0.0.1:7002', '127.0.0.1:7003']);
    assert.deepEqual(nodes.map((n: { slots: unknown }) => n.slots), [
      [{ start: 0, end: 5460 }],
      [{ start: 5461, end: 10922 }],
      [{ start: 10923, end: 16383 }],
    ]);
    // showcase:cache:user:42 is slot 15914, on 7003.
    const owner = nodes[2];
    assert.ok(owner.namespaces['showcase:cache'] >= 1, JSON.stringify(owner.namespaces));
    for (const n of nodes) {
      const showcase = Object.values(n.namespaces as Record<string, number>).reduce((a, b) => a + b, 0);
      assert.ok(n.keys >= showcase, `${n.address}: ${n.keys} keys, ${showcase} showcase keys`);
    }
  });

  test('client connections per node: the Pub/Sub subscriber is pinned to one node', async () => {
    const card = await openSse(`${base}/api/cluster/pubsub/channels/slots-test/stream`);
    try {
      assert.deepEqual(await card.next(), { type: 'subscribed', channel: 'slots-test' });
      const { nodes } = await overview();
      const subscribers = nodes.map((n: { clients: { kind: string; count: number }[] }) =>
        n.clients.find((c) => c.kind === 'subscriber')?.count ?? 0,
      );
      assert.equal(subscribers.filter((c: number) => c > 0).length, 1, JSON.stringify(nodes.map((n: { clients: unknown }) => n.clients)));
    } finally {
      await card.close();
    }
  });

  test('a stream read shows as a blocked read while it waits; the showcase\'s own probes are listed apart', async () => {
    const follower = await openSse(`${base}/api/cluster/streams/slots-test/follow`);
    try {
      await follower.next(); // following: the shared read loop has started
      await new Promise((resolve) => setTimeout(resolve, 300));
      const { nodes } = await overview();
      const count = (kind: string) => nodes.reduce(
        (n: number, node: { clients: { kind: string; count: number }[] }) => n + (node.clients.find((c) => c.kind === kind)?.count ?? 0), 0,
      );
      assert.ok(count('blocked read') >= 1, JSON.stringify(nodes.map((n: { clients: unknown }) => n.clients)));
      // The status monitor's probes (one per seed node) are named showcase-probe, not counted as the package's.
      assert.ok(count('showcase probe') >= 3, JSON.stringify(nodes.map((n: { clients: unknown }) => n.clients)));
    } finally {
      await follower.close();
    }
  });
});
