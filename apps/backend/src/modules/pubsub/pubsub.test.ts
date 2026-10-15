// Smoke test of the pub/sub feature module per connection mode, against the Docker stacks (`pnpm infra:up`). Each card
// is one SSE stream on GET /api/<mode>/pubsub/channels/:channel/stream.
import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { MODES, type Mode } from '@showcase/contracts';
import { Redis } from 'ioredis';
import { buildApp } from '../../app.ts';
import { testConfig } from '../../test-config.ts';
import { eventLogEntries, openSse, type SseReader } from '../../test-sse.ts';

const app = await buildApp({ config: testConfig() });
let base: string;
before(async () => {
  base = await app.listen({ port: 0, host: '127.0.0.1' });
});
after(() => app.close());

/**
 * What Redis itself sees: subscribers to a channel summed over every node a mode's subscriber could be on (PUBSUB
 * NUMSUB counts one node's own subscribers). Sentinel's master is whichever of 6380/6381 Sentinel names.
 */
const NODES: Record<Mode, number[]> = { standalone: [6379], sentinel: [6380, 6381], cluster: [7001, 7002, 7003] };
async function subscribers(mode: Mode, channel: string): Promise<number> {
  const counts = await Promise.all(
    NODES[mode].map(async (port) => {
      const node = new Redis({ port, lazyConnect: true });
      try {
        const [, count] = (await node.call('PUBSUB', 'NUMSUB', `showcase:events:${channel}`)) as [string, number];
        return count;
      } finally {
        node.disconnect();
      }
    }),
  );
  return counts.reduce((a, b) => a + b, 0);
}

/** Waits until `check` holds, for what Redis applies just after a response (an UNSUBSCRIBE on a stream's close). */
async function eventually(check: () => Promise<boolean>, what: string) {
  for (const deadline = Date.now() + 2000; Date.now() < deadline; ) {
    if (await check()) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  assert.fail(what);
}

for (const mode of MODES) {
  describe(mode, () => {
    const publish = async (channel: string, message: unknown) => {
      const res = await app.inject({ method: 'POST', url: `/api/${mode}/pubsub/publish`, payload: { channel, message } });
      return { status: res.statusCode, body: res.json() };
    };
    const cards: SseReader[] = [];
    /** Opens a card and waits for Redis to confirm its subscription. */
    const subscribe = async (channel: string) => {
      const card = await openSse(`${base}/api/${mode}/pubsub/channels/${encodeURIComponent(channel)}/stream`);
      cards.push(card);
      assert.equal(card.status, 200);
      assert.deepEqual(await card.next(), { type: 'subscribed', channel });
      return card;
    };
    after(() => Promise.all(cards.map((c) => c.close().catch(() => {}))));

    test('a card receives what is published to its channel; publish returns the package’s count', async () => {
      const card = await subscribe('orders.created');
      const res = await publish('orders.created', { orderId: '42', total: 19.99 });
      assert.equal(res.status, 200);
      // On cluster the count is only the subscribers on the node that took the PUBLISH: possibly 0.
      if (mode === 'cluster') assert.ok([0, 1].includes(res.body.result), `count ${res.body.result}`);
      else assert.equal(res.body.result, 1);
      assert.deepEqual(res.body.redis.commands.map((c: { name: string; args: string[] }) => [c.name, ...c.args]), [
        ['publish', 'showcase:events:orders.created', '{"orderId":"42","total":19.99}'],
      ]);
      assert.deepEqual(await card.next(), { type: 'message', channel: 'orders.created', value: { orderId: '42', total: 19.99 } });
      await card.close();
    });

    test('nobody listening: publish returns 0', async () => {
      assert.equal((await publish('orders.cancelled', { orderId: '7' })).body.result, 0);
    });

    test('cards on one channel share one Redis SUBSCRIBE; closing the last sends the real UNSUBSCRIBE', async () => {
      const first = await subscribe('orders.shared');
      const second = await subscribe('orders.shared');
      assert.equal(await subscribers(mode, 'orders.shared'), 1);

      await publish('orders.shared', { n: 1 });
      assert.deepEqual([await first.next(), await second.next()].map((m) => (m as { value: unknown }).value), [{ n: 1 }, { n: 1 }]);

      await first.close();
      await publish('orders.shared', { n: 2 });
      assert.deepEqual(await second.next(), { type: 'message', channel: 'orders.shared', value: { n: 2 } });
      assert.equal(await subscribers(mode, 'orders.shared'), 1, 'one card left: still subscribed');

      await second.close();
      await eventually(async () => (await subscribers(mode, 'orders.shared')) === 0, 'UNSUBSCRIBE after the last card closed');
    });

    test('a raw non-JSON publish is dropped by the subscriber and shows once in the event log as PUBSUB_SERIALIZATION', async () => {
      const started = Date.now();
      const cards = [await subscribe('orders.raw'), await subscribe('orders.raw')];
      const raw = await app.inject({ method: 'POST', url: `/api/${mode}/pubsub/publish-raw`, payload: { channel: 'orders.raw', message: 'not json' } });
      assert.equal(raw.statusCode, 200);
      assert.deepEqual(raw.json().redis.commands.map((c: { args: string[] }) => c.args), [['showcase:events:orders.raw', 'not json']]);

      // Dropped: the next message either card sees is the JSON one sent after it.
      await publish('orders.raw', { after: true });
      for (const card of cards) assert.deepEqual(await card.next(), { type: 'message', channel: 'orders.raw', value: { after: true } });

      const entries = await eventLogEntries(base, mode, (e) => e.code === 'PUBSUB_SERIALIZATION' && e.ts >= started);
      assert.equal(entries.length, 1, 'reported once, however many cards listen');
      assert.deepEqual([entries[0].source, entries[0].channel], ['pubsub-handler', 'orders.raw']);
      await Promise.all(cards.map((c) => c.close()));
    });

    test('a JSON value is required: publish without one answers a validation error', async () => {
      const res = await app.inject({ method: 'POST', url: `/api/${mode}/pubsub/publish`, payload: { channel: 'orders.created' } });
      assert.equal(res.statusCode, 400);
    });
  });
}
