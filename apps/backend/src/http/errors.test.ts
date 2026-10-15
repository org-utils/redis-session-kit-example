// The error handler over HTTP: the `{ error: { code, name, message, mode } }` body and the agreed status codes.
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { ErrorBodySchema } from '@showcase/contracts';
import {
  CacheError, LockError, RateLimitError, RedisConfigurationError, SessionConflictError, SessionLimitError, SessionNotFoundError,
} from 'ioredis-toolkit';
import { z } from 'zod';
import { buildApp, type FeatureModule } from '../app.ts';
import { testConfig } from '../test-config.ts';

const thrown: Record<string, () => Error> = {
  'cache-input': () => new CacheError('CACHE_INPUT', 'key must not be empty'),
  'session-not-found': () => new SessionNotFoundError(),
  'session-conflict': () => new SessionConflictError(),
  'lock-held': () => new LockError('LOCK_HELD', 'lock job:1 is held'),
  'session-limit': () => new SessionLimitError('metadata exceeds maxMetadataBytes'),
  'rate-limit-configuration': () => new RateLimitError('RATE_LIMIT_CONFIGURATION', 'limit must be positive'),
  'redis-configuration': () => new RedisConfigurationError('namespaces overlap'),
  'plain-error': () => new TypeError('something broke'),
};

const failing: FeatureModule = async (app, { client }) => {
  app.get('/throw/:kind', async (request) => {
    throw thrown[(request.params as { kind: string }).kind]();
  });
  // Two keys in different hash slots: Redis Cluster answers CROSSSLOT.
  app.get('/crossslot', async () => client.eval('return 1', 2, 'a', 'b'));
  app.get('/validated', { schema: { querystring: z.object({ n: z.coerce.number().int() }) } }, async () => 'ok');
};

const app = await buildApp({ config: testConfig({ SHOWCASE_MODES: 'cluster' }), modules: [failing] });
before(() => app.ready());
after(() => app.close());

async function call(url: string) {
  const res = await app.inject(url);
  return { status: res.statusCode, error: ErrorBodySchema.parse(res.json()).error };
}

const cases: [kind: string, status: number, code: string][] = [
  ['cache-input', 400, 'CACHE_INPUT'],
  ['session-not-found', 404, 'SESSION_NOT_FOUND'],
  ['session-conflict', 409, 'SESSION_CONFLICT'],
  ['lock-held', 409, 'LOCK_HELD'],
  ['session-limit', 413, 'SESSION_LIMIT'],
  ['rate-limit-configuration', 500, 'RATE_LIMIT_CONFIGURATION'],
  ['redis-configuration', 500, 'REDIS_CONFIGURATION'],
  ['plain-error', 500, 'INTERNAL'],
];
for (const [kind, status, code] of cases) {
  test(`${code} answers ${status}`, async () => {
    const res = await call(`/api/cluster/throw/${kind}`);
    assert.deepEqual([res.status, res.error.code, res.error.mode], [status, code, 'cluster']);
  });
}

test('the body carries the error class name and message', async () => {
  const { error } = await call('/api/cluster/throw/lock-held');
  assert.deepEqual(error, { code: 'LOCK_HELD', name: 'LockError', message: 'lock job:1 is held', mode: 'cluster' });
});

test("a raw Redis error answers 502 with Redis's own message", async () => {
  const { status, error } = await call('/api/cluster/crossslot');
  assert.equal(status, 502);
  assert.equal(error.code, 'CROSSSLOT');
  assert.match(error.message, /^CROSSSLOT /);
});

test('invalid input answers 400 with Fastify’s validation code', async () => {
  const { status, error } = await call('/api/cluster/validated?n=abc');
  assert.deepEqual([status, error.code], [400, 'FST_ERR_VALIDATION']);
});

test('an unknown route answers 404 in the same shape, with no mode', async () => {
  const { status, error } = await call('/api/nowhere');
  assert.deepEqual([status, error.code, error.mode], [404, 'NOT_FOUND', null]);
});
