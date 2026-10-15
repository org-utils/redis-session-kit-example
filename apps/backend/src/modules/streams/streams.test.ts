// Smoke test of the streams feature module per connection mode, against the Docker stacks (`pnpm infra:up`).
import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { MODES } from '@showcase/contracts';
import { buildApp } from '../../app.ts';
import { testConfig } from '../../test-config.ts';
import { openSse, type SseReader } from '../../test-sse.ts';

const app = await buildApp({ config: testConfig() });
let base: string;
before(async () => {
  base = await app.listen({ port: 0, host: '127.0.0.1' });
});
after(() => app.close());

type Entry = { id: string; fields: Record<string, string> };

for (const mode of MODES) {
  describe(mode, () => {
    const call = async (op: string, body: unknown = {}) => {
      const res = await app.inject({ method: 'POST', url: `/api/${mode}/streams/${op}`, payload: body as object });
      return { status: res.statusCode, body: res.json() };
    };
    const add = async (stream: string, fields: Record<string, string>) => (await call('add', { stream, fields })).body.result as string;
    const read = async (options: Record<string, unknown>) => call('read', { stream: 'orders', ...options });
    const pending = async (stream = 'orders') =>
      (await app.inject({ method: 'GET', url: `/api/${mode}/streams/pending`, query: { stream } })).json();

    before(() => call('reset-section'));

    test('createGroup creates the stream with it; again, BUSYGROUP counts as success', async () => {
      const first = await call('createGroup', { stream: 'orders', group: 'billing', start: '$' });
      assert.deepEqual([first.status, first.body.result], [200, null]);
      assert.deepEqual(first.body.redis.commands.map((c: { name: string; args: string[] }) => [c.name, ...c.args]), [
        ['xgroup', 'CREATE', 'showcase:stream:orders', 'billing', '$', 'MKSTREAM'],
      ]);
      const again = await call('createGroup', { stream: 'orders', group: 'billing', start: '$' });
      assert.deepEqual([again.status, again.body.result], [200, null]);
    });

    test('add appends an entry and returns its id; no fields answers STREAMS_INPUT', async () => {
      const res = await call('add', { stream: 'orders', fields: { orderId: '42', type: 'created' } });
      assert.equal(res.status, 200);
      assert.match(res.body.result, /^\d+-\d+$/);
      const empty = await call('add', { stream: 'orders', fields: {} });
      assert.deepEqual([empty.status, empty.body.error.code], [400, 'STREAMS_INPUT']);
    });

    test('a capped stream is trimmed approximately: MAXLEN ~ drops whole nodes of 100 entries at a time', async () => {
      for (let i = 0; i < 150; i++) await call('add', { stream: 'recent', fields: { n: String(i) }, maxEntries: 10 });
      const res = await call('add', { stream: 'recent', fields: { n: 'last' }, maxEntries: 10 });
      assert.deepEqual(res.body.redis.commands[0].args.slice(0, 4), ['showcase:stream:recent', 'MAXLEN', '~', '10']);
      // Redis trims only whole nodes of 100 entries (stream-node-max-entries): 151 adds keep the last 51, not 10.
      assert.equal((await call('length', { stream: 'recent' })).body.result, 51);
    });

    test('group reads: each entry goes to one consumer, pending until acked; id 0 recovers a consumer’s pending', async () => {
      await call('reset-section');
      await call('createGroup', { stream: 'orders', group: 'billing', start: '$' });
      const ids = [];
      for (const n of ['1', '2', '3', '4']) ids.push(await add('orders', { orderId: n }));

      const w1 = await read({ group: 'billing', consumer: 'worker-1', count: 2 });
      const w2 = await read({ group: 'billing', consumer: 'worker-2', count: 2 });
      assert.deepEqual(w1.body.result.map((e: Entry) => e.id), ids.slice(0, 2));
      assert.deepEqual(w2.body.result.map((e: Entry) => e.id), ids.slice(2));
      assert.deepEqual(w1.body.result[0].fields, { orderId: '1' });

      const recovered = await read({ group: 'billing', consumer: 'worker-1', count: 10, id: '0' });
      assert.deepEqual(recovered.body.result.map((e: Entry) => e.id), ids.slice(0, 2));
      assert.deepEqual((await read({ group: 'billing', consumer: 'worker-1', count: 2 })).body.result, [], 'nothing new');
    });

    test('the pending table: native XPENDING per group and consumer, cleared by ack', async () => {
      const table = await pending();
      const billing = table.groups.find((g: { name: string }) => g.name === 'billing');
      const byConsumer = Object.fromEntries(billing.consumers.map((c: { name: string; pending: { id: string }[] }) => [c.name, c.pending.map((p) => p.id)]));
      assert.equal(byConsumer['worker-1'].length, 2);
      assert.equal(byConsumer['worker-2'].length, 2);

      const ack = await call('ack', { stream: 'orders', group: 'billing', ids: byConsumer['worker-1'] });
      assert.deepEqual([ack.status, ack.body.result], [200, 2]);
      const after = (await pending()).groups.find((g: { name: string }) => g.name === 'billing');
      assert.deepEqual(after.consumers.find((c: { name: string }) => c.name === 'worker-1').pending, []);
    });

    test('a deleted pending entry comes back from recovery with empty fields', async () => {
      const [id] = (await pending()).groups[0].consumers.find((c: { name: string }) => c.name === 'worker-2').pending.map((p: { id: string }) => p.id);
      assert.equal((await call('delete', { stream: 'orders', ids: [id] })).body.result, 1);
      const recovered = await read({ group: 'billing', consumer: 'worker-2', count: 10, id: '0' });
      assert.deepEqual(recovered.body.result[0], { id, fields: {} });
    });

    test('a missing group answers Redis’s NOGROUP; a group without a consumer, STREAMS_INPUT', async () => {
      const ghost = await read({ group: 'ghost', consumer: 'worker-1', count: 2 });
      assert.deepEqual([ghost.status, ghost.body.error.code], [502, 'NOGROUP']);
      const noConsumer = await read({ group: 'billing', count: 2 });
      assert.deepEqual([noConsumer.status, noConsumer.body.error.code], [400, 'STREAMS_INPUT']);
    });

    test('length counts the entries in the stream', async () => {
      assert.equal((await call('length', { stream: 'orders' })).body.result, 3);
    });

    test('a plain read from id 0 lists the stream from the start', async () => {
      const res = await read({ id: '0', count: 10 });
      assert.deepEqual(res.body.result.map((e: Entry) => e.fields.orderId), ['1', '2', '4']);
    });

    describe('following', () => {
      const followers: SseReader[] = [];
      const follow = async (stream = 'orders') => {
        const follower = await openSse(`${base}/api/${mode}/streams/${stream}/follow`);
        followers.push(follower);
        return follower;
      };
      after(() => Promise.all(followers.map((f) => f.close().catch(() => {}))));
      type Following = { type: 'following'; stream: string; loop: number; listeners: number };
      let sharedLoop = 0;

      test('one shared read loop per stream: the second follower joins the first one’s loop, and both get each entry', async () => {
        const first = await follow();
        const joined = (await first.next()) as Following;
        assert.deepEqual([joined.type, joined.stream, joined.listeners], ['following', 'orders', 1]);
        const second = await follow();
        const both = (await second.next()) as Following;
        assert.deepEqual([both.loop, both.listeners], [joined.loop, 2]);
        sharedLoop = joined.loop;
        assert.deepEqual(await first.next(), { type: 'listeners', listeners: 2 });

        const id = await add('orders', { orderId: '5' });
        for (const follower of [first, second]) {
          assert.deepEqual(await follower.next(), { type: 'entries', entries: [{ id, fields: { orderId: '5' } }] });
        }
      });

      test('the last follower to leave stops the loop: the next one starts a new loop', async () => {
        const [first, second] = followers.splice(0, 2);
        await second.close();
        assert.deepEqual(await first.next(), { type: 'listeners', listeners: 1 });
        await first.close();
        // The backend notices the close a moment later; until then a newcomer would still join the old loop.
        for (const deadline = Date.now() + 2000; ; ) {
          const next = await follow();
          const fresh = (await next.next()) as Following;
          if (fresh.loop !== sharedLoop) {
            assert.equal(fresh.listeners, 1);
            return;
          }
          await next.close();
          assert.ok(Date.now() < deadline, 'the old loop never stopped');
          await new Promise((resolve) => setTimeout(resolve, 50));
        }
      });
    });
  });
}
