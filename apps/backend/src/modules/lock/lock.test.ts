// Smoke test of the lock feature module per connection mode, against the Docker stacks (`pnpm infra:up`).
import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { MODES } from '@showcase/contracts';
import { buildApp } from '../../app.ts';
import { testConfig } from '../../test-config.ts';
import { eventLogEntries } from '../../test-sse.ts';

const app = await buildApp({ config: testConfig() });
let base: string;
before(async () => {
  base = await app.listen({ port: 0, host: '127.0.0.1' });
});
after(() => app.close());

const NAME = 'report:nightly';

for (const mode of MODES) {
  describe(mode, () => {
    const call = async (op: string, body: unknown = {}) => {
      const res = await app.inject({ method: 'POST', url: `/api/${mode}/lock/${op}`, payload: body as object });
      return { status: res.statusCode, body: res.json() };
    };
    const lease = async (name = NAME) =>
      (await app.inject({ method: 'GET', url: `/api/${mode}/lock/lease`, query: { name } })).json();

    before(() => call('reset-section'));

    test('A acquires; B is refused while A holds the lease, but still gets a token of its own', async () => {
      const a = await call('acquire', { name: NAME, ttl: 30 });
      const b = await call('acquire', { name: NAME, ttl: 30 });
      assert.equal(a.status, 200);
      assert.equal(a.body.result.acquired, true);
      assert.equal(b.body.result.acquired, false);
      assert.equal(typeof b.body.result.token, 'string');
      assert.notEqual(a.body.result.token, b.body.result.token);
      // One script since 2.0.1, so an acquire ioredis resends still counts as acquired: EVAL follows only while Redis lacks the script.
      assert.match(a.body.redis.commands.map((c: { name: string }) => c.name).join(' '), /^evalsha( eval)?$/);
    });

    test('the lease is read from Redis: the stored token and the key’s remaining TTL', async () => {
      await call('reset-section');
      const { body } = await call('acquire', { name: NAME, ttl: 30 });
      const state = await lease();
      assert.deepEqual([state.key, state.token], [`showcase:lock:${NAME}`, body.result.token]);
      assert.ok(state.ttlMs > 29_000 && state.ttlMs <= 30_000, `ttlMs ${state.ttlMs}`);
      await call('reset-section');
      assert.deepEqual(await lease(), { key: `showcase:lock:${NAME}`, token: null, ttlMs: null });
    });

    test('a blank ttl takes the default lease, 30 s', async () => {
      await call('reset-section');
      await call('acquire', { name: NAME });
      const { ttlMs } = await lease();
      assert.ok(ttlMs > 29_000 && ttlMs <= 30_000, `ttlMs ${ttlMs}`);
    });

    test('extend resets the lease with the holder’s token, and refuses the refused token', async () => {
      await call('reset-section');
      const a = (await call('acquire', { name: NAME, ttl: 5 })).body.result.token;
      const b = (await call('acquire', { name: NAME, ttl: 5 })).body.result.token;
      assert.equal((await call('extend', { name: NAME, token: a, ttl: 30 })).body.result, true);
      assert.ok((await lease()).ttlMs > 29_000);
      assert.equal((await call('extend', { name: NAME, token: b, ttl: 30 })).body.result, false);
    });

    test('release with the other lane’s token is refused and the lock survives; with the holder’s it frees it', async () => {
      await call('reset-section');
      const a = (await call('acquire', { name: NAME, ttl: 30 })).body.result.token;
      const b = (await call('acquire', { name: NAME, ttl: 30 })).body.result.token;
      assert.equal((await call('release', { name: NAME, token: b })).body.result, false);
      assert.equal((await lease()).token, a);
      assert.equal((await call('release', { name: NAME, token: a })).body.result, true);
      assert.equal((await lease()).token, null);
    });

    test('a sub-second lease is accepted and expires on its own', async () => {
      const res = await call('acquire', { name: 'cart:42', ttl: 0.5 });
      assert.equal(res.body.result.acquired, true);
      await new Promise((resolve) => setTimeout(resolve, 600));
      assert.equal((await lease('cart:42')).token, null);
    });

    test('a ttl over maxTtl answers LOCK_LIMIT before anything is sent', async () => {
      const res = await call('acquire', { name: 'migration', ttl: 600 });
      assert.equal(res.status, 413);
      assert.deepEqual([res.body.error.code, res.body.error.name], ['LOCK_LIMIT', 'LockError']);
      assert.deepEqual(res.body.redis.commands, []);
    });

    test('using holds the lease server-side for the work; a second using meanwhile answers LOCK_HELD', async () => {
      await call('reset-section');
      const using = call('using', { name: NAME, work: 1, ttl: 30 });
      await new Promise((resolve) => setTimeout(resolve, 200));
      const held = await lease();
      assert.equal(typeof held.token, 'string');
      const second = await call('using', { name: NAME, work: 1, ttl: 30 });
      assert.deepEqual([second.status, second.body.error.code], [409, 'LOCK_HELD']);
      assert.equal((await call('acquire', { name: NAME, ttl: 30 })).body.result.acquired, false);

      const done = await using;
      assert.equal(done.status, 200);
      assert.deepEqual(done.body.result, { token: held.token, workedSeconds: 1 });
      assert.equal((await lease()).token, null, 'released after the work');
    });

    test('work outlasting the lease: B acquires mid-work, and the release that finds it gone shows in the event log', async () => {
      await call('reset-section');
      const started = Date.now();
      const using = call('using', { name: NAME, work: 1.2, ttl: 0.5 });
      await new Promise((resolve) => setTimeout(resolve, 700));
      const b = await call('acquire', { name: NAME, ttl: 30 });
      assert.equal(b.body.result.acquired, true, 'B acquires once the lease has run out');

      const done = await using;
      assert.equal(done.status, 200, 'using() still resolves with the callback’s result');
      assert.equal((await lease()).token, b.body.result.token, 'B’s lease survives the release');
      const [entry] = await eventLogEntries(base, mode, (e) => e.source === 'lock-release' && e.ts >= started);
      assert.equal(entry?.kind, 'showcase');
      assert.match(entry.message, /^report:nightly: the lease ran out mid-work/);
    });

    test('reset-section deletes every key in the lock namespace on this mode', async () => {
      await call('acquire', { name: NAME, ttl: 30 });
      await call('acquire', { name: 'cart:42', ttl: 30 });
      const reset = await call('reset-section');
      assert.ok(reset.body.result >= 2, `deleted ${reset.body.result}`);
      assert.equal((await lease()).token, null);
    });
  });
}
