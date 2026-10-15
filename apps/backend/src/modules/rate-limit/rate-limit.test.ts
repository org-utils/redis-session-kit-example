// Smoke test of the rate-limit feature module per connection mode, against the Docker stacks (`pnpm infra:up`). The
// mode clients' limiter allows 10 requests per 20 s window.
import assert from 'node:assert/strict';
import { setTimeout as sleep } from 'node:timers/promises';
import { after, before, beforeEach, describe, test } from 'node:test';
import { MODES } from '@showcase/contracts';
import { buildApp } from '../../app.ts';
import { testConfig } from '../../test-config.ts';

const app = await buildApp({ config: testConfig() });
before(() => app.ready());
after(() => app.close());

// Windows end on every multiple of 20 s: a test that lands within 2 s of the end waits for the next window, so its calls
// all count in one.
beforeEach(async () => {
  const left = 20_000 - (Date.now() % 20_000);
  if (left < 2000) await sleep(left + 50);
});

for (const mode of MODES) {
  describe(mode, () => {
    const call = async (op: string, body: unknown = {}) => {
      const res = await app.inject({ method: 'POST', url: `/api/${mode}/rate-limit/${op}`, payload: body as object });
      return { status: res.statusCode, body: res.json() };
    };
    const consume = async (subject: string, cost?: number) => (await call('consume', { subject, cost })).body.result;

    before(() => call('reset-section'));

    test('one request: allowed, one counted, nine remaining, in a window of 10 per 20 s', async () => {
      const res = await call('consume', { subject: 'user:42', cost: 1 });
      assert.equal(res.status, 200);
      const { allowed, limit, remaining, count, retryAfterSeconds, resetAt } = res.body.result;
      assert.deepEqual({ allowed, limit, remaining, count, retryAfterSeconds }, { allowed: true, limit: 10, remaining: 9, count: 1, retryAfterSeconds: 0 });
      // Fixed windows are aligned to the clock: this one ends at the next multiple of 20 s, not 20 s after this call.
      assert.equal(resetAt % 20, 0, `resetAt ${resetAt}`);
      const left = resetAt - Date.now() / 1000;
      assert.ok(left > -1 && left <= 21, `window ends in ${left}s`);
      assert.deepEqual(res.body.redis.keys.map((k: { key: string }) => k.key), ['showcase:rate-limit:{user:42}']);
    });

    test('an expensive request costs 4 of the window at once', async () => {
      const result = await consume('expensive', 4);
      assert.deepEqual([result.allowed, result.count, result.remaining], [true, 4, 6]);
    });

    test('a cost bigger than the window is denied, with retryAfterSeconds, and still counts', async () => {
      const result = await consume('big', 11);
      assert.equal(result.allowed, false);
      assert.ok(result.retryAfterSeconds > 0 && result.retryAfterSeconds <= 20, `retryAfterSeconds ${result.retryAfterSeconds}`);
      assert.equal(result.count, 11);
    });

    test('an invalid cost or subject answers RATE_LIMIT_INPUT', async () => {
      for (const body of [{ subject: 'user:42', cost: 0 }, { subject: '}oops', cost: 1 }]) {
        const res = await call('consume', body);
        assert.equal(res.status, 400);
        assert.deepEqual([res.body.error.code, res.body.error.name], ['RATE_LIMIT_INPUT', 'RateLimitError']);
      }
    });

    test('check peeks without consuming', async () => {
      await consume('peek', 3);
      const res = await call('check', { subject: 'peek' });
      assert.deepEqual([res.body.result.allowed, res.body.result.count], [true, 3]);
      assert.equal((await call('check', { subject: 'peek' })).body.result.count, 3);
    });

    test('at exactly the limit: consume allows the 10th, check then reports denied', async () => {
      const results = [];
      for (let i = 0; i < 10; i++) results.push(await consume('edge'));
      assert.deepEqual([results[9].allowed, results[9].count, results[9].remaining], [true, 10, 0]);
      const check = (await call('check', { subject: 'edge' })).body.result;
      assert.deepEqual([check.allowed, check.count], [false, 10]);
    });

    test('a burst of 15: 10 allowed, 5 denied with retryAfterSeconds', async () => {
      const results = [];
      for (let i = 0; i < 15; i++) results.push(await consume('burst'));
      assert.deepEqual(results.map((r) => r.allowed), [...Array(10).fill(true), ...Array(5).fill(false)]);
      assert.ok(results.slice(10).every((r) => r.retryAfterSeconds > 0));
    });

    test('reset: true for a subject with a window, false for an unknown one', async () => {
      await consume('resettable');
      assert.equal((await call('reset', { subject: 'resettable' })).body.result, true);
      assert.equal((await consume('resettable')).count, 1, 'the next consume starts a fresh window');
      assert.equal((await call('reset', { subject: 'nobody' })).body.result, false);
    });

    test('reset-section deletes every key in the rate-limit namespace on this mode', async () => {
      await consume('section');
      assert.ok((await call('reset-section')).body.result >= 1);
      assert.equal((await call('check', { subject: 'section' })).body.result.count, 0);
    });
  });
}
