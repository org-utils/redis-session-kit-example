// Smoke test of the session feature module per connection mode, against the Docker stacks (`pnpm infra:up`).
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, describe, test } from 'node:test';
import { setTimeout as sleep } from 'node:timers/promises';
import { MODES, SessionRecordsSchema, type SessionRecord } from '@showcase/contracts';
import { buildApp } from '../../app.ts';
import { testConfig } from '../../test-config.ts';

/** Short, so a touch can land within a test; the other lifetimes keep their defaults (ttl 3600, idle 900). */
const TOUCH_INTERVAL = 1;
const app = await buildApp({ config: testConfig({ SESSION_TOUCH_INTERVAL: String(TOUCH_INTERVAL) }) });
before(() => app.ready());
after(() => app.close());

const LOGIN = { userId: 'user-42', deviceId: 'laptop', securityVersion: 1, metadata: { plan: 'pro' } };
/** A user no other test touches, for a test that changes the user's state or counts their sessions. */
const fresh = () => `user-${randomUUID()}`;

for (const mode of MODES) {
  describe(mode, () => {
    const cookieName = `showcase_session_${mode}`;
    /** The browser: the cookie it holds for this mode, sent with every request like a real one would. */
    let cookie: string | null = null;
    const call = async (op: string, body: unknown = {}) => {
      const res = await app.inject({
        method: 'POST',
        url: `/api/${mode}/session/${op}`,
        payload: body as object,
        headers: { 'user-agent': 'smoke-test', ...(cookie && { cookie: `${cookieName}=${cookie}` }) },
      });
      return { status: res.statusCode, body: res.json(), setCookie: res.headers['set-cookie'] };
    };
    const login = async (input: object = LOGIN) => {
      const res = await call('create', input);
      assert.equal(res.status, 200, JSON.stringify(res.body));
      cookie = res.body.result.token;
      return res;
    };
    const stored = async ({ userId, id }: { userId: string; id: string }) =>
      (await app.inject({ method: 'GET', url: `/api/${mode}/session/stored?${new URLSearchParams({ userId, id })}` })).json();

    test("create: a fake login sets this mode's cookie and echoes the exact Set-Cookie the package built", async () => {
      const res = await login();
      const { token, session } = res.body.result;
      assert.deepEqual([session.userId, session.deviceId, session.status, session.version], ['user-42', 'laptop', 'active', 1]);
      assert.equal(res.body.setCookie, res.setCookie);
      assert.match(res.body.setCookie, new RegExp(`^${cookieName}=${token.replace('.', '\\.')}; `));
      assert.match(res.body.setCookie, /HttpOnly/);
      assert.doesNotMatch(res.body.setCookie, /Secure/);
    });

    test('validate: without a token it checks the cookie, and the session holds the client details of the login', async () => {
      await login();
      const res = await call('validate');
      assert.equal(res.status, 200);
      const { valid, session } = res.body.result;
      assert.equal(valid, true);
      assert.deepEqual([session.userAgent, session.deviceId, session.securityVersion, session.metadata], ['smoke-test', 'laptop', 1, { plan: 'pro' }]);
      assert.equal(typeof session.ipAddress, 'string');
      assert.equal(res.body.setCookie, undefined);
    });

    test('stored: the record Redis holds is ciphertext under key v1, at the key create wrote', async () => {
      const created = await login();
      const { key, value, ttl } = await stored(created.body.result.session);
      assert.ok(created.body.redis.keys.some((k: { key: string }) => k.key === key), `${key} not among the keys create touched`);
      const envelope = JSON.parse(value);
      assert.deepEqual([envelope.enc, envelope.keyVersion], [1, 'v1']);
      assert.doesNotMatch(value, /pro|laptop|user-42/);
      assert.ok(ttl > 3590 && ttl <= 3600, `ttl ${ttl}`);
    });

    test('get: the session, or a typed error for a credential that cannot authenticate', async () => {
      const created = await login();
      const res = await call('get');
      assert.deepEqual([res.status, res.body.result.id], [200, created.body.result.session.id]);
      const unknown = await call('get', { token: `${'A'.repeat(22)}.${'B'.repeat(43)}` });
      assert.deepEqual([unknown.status, unknown.body.error.code], [404, 'SESSION_NOT_FOUND']);
    });

    test('per-session idleTimeout: idle past it, validate says idle_timeout and get answers SESSION_EXPIRED', async () => {
      await login({ ...LOGIN, idleTimeout: 1 });
      await sleep(2100);
      assert.deepEqual((await call('validate')).body.result, { valid: false, reason: 'idle_timeout' });
      const res = await call('get');
      assert.deepEqual([res.status, res.body.error.code], [401, 'SESSION_EXPIRED']);
    });

    test('per-session absoluteTimeout: under the configured ttl it is refused, unless a ttl within it comes too', async () => {
      const refused = await call('create', { ...LOGIN, absoluteTimeout: 45 });
      assert.deepEqual([refused.status, refused.body.error.code], [400, 'SESSION_INVALID']);
      const { session } = (await login({ ...LOGIN, ttl: 45, absoluteTimeout: 45 })).body.result;
      assert.equal(session.absoluteExpiresAt - session.createdAt, 45);
      assert.equal(session.expiresAt, session.absoluteExpiresAt);
    });

    test('touch: writes nothing within touchInterval, then moves the idle expiry on', async () => {
      const { session } = (await login()).body.result;
      const before = await stored(session);
      const skipped = await call('touch');
      assert.deepEqual([skipped.status, skipped.body.result], [200, null]);
      assert.equal((await stored(session)).value, before.value);
      await sleep(TOUCH_INTERVAL * 1000 + 1100);
      assert.equal((await call('touch')).status, 200);
      assert.notEqual((await stored(session)).value, before.value);
      const touched = (await call('get')).body.result;
      assert.ok(touched.idleExpiresAt > session.idleExpiresAt, `${touched.idleExpiresAt} after ${session.idleExpiresAt}`);
      assert.equal(touched.version, session.version);
    });

    test('update: replaces the metadata and bumps version; a stale expectedVersion answers SESSION_CONFLICT', async () => {
      await login();
      const res = await call('update', { metadata: { theme: 'dark' }, expectedVersion: 1 });
      assert.equal(res.status, 200);
      assert.deepEqual([res.body.result.version, res.body.result.metadata], [2, { theme: 'dark' }]);
      const stale = await call('update', { metadata: { theme: 'light' }, expectedVersion: 1 });
      assert.deepEqual([stale.status, stale.body.error.code], [409, 'SESSION_CONFLICT']);
      assert.deepEqual((await call('update', { metadata: { theme: 'light' } })).body.result.version, 3);
    });

    test("metrics: this mode's sink counts what the package reported, with its labels", async () => {
      const counted = async (name: string, labels: object = {}) => {
        const res = await app.inject(`/api/${mode}/session/metrics`);
        const entry = res.json().counters.find((c: { name: string; labels: object }) => c.name === name && JSON.stringify(c.labels) === JSON.stringify(labels));
        return entry?.value ?? 0;
      };
      const [created, valid] = [await counted('session.created'), await counted('session.validate', { result: 'valid' })];
      await login();
      await call('validate');
      assert.deepEqual([await counted('session.created'), await counted('session.validate', { result: 'valid' })], [created + 1, valid + 1]);
    });

    test("cookie: what this mode's cookie holds in the request, or null without one", async () => {
      const read = async (headers: Record<string, string>) => (await app.inject({ url: `/api/${mode}/session/cookie`, headers })).json();
      assert.deepEqual(await read({ cookie: `other=1; ${cookieName}=abc.def` }), { name: cookieName, value: 'abc.def' });
      assert.deepEqual(await read({}), { name: cookieName, value: null });
    });

    test('reset-section deletes every key in the session namespace on this mode', async () => {
      const { session } = (await login()).body.result;
      const reset = await call('reset-section');
      assert.equal(reset.status, 200);
      assert.ok(reset.body.result >= 3, `deleted ${reset.body.result}`);
      assert.equal((await stored(session)).value, null);
      assert.deepEqual((await call('validate')).body.result, { valid: false, reason: 'not_found' });
    });

    test('rotate: consumes the session, moves the cookie to its successor, and a replay of the old token is SESSION_REPLAY', async () => {
      const created = (await login()).body.result;
      const res = await call('rotate');
      assert.equal(res.status, 200, JSON.stringify(res.body));
      const { token, session, previousJti } = res.body.result;
      assert.equal(previousJti, created.session.jti);
      assert.deepEqual([session.rotatedFrom, session.status, session.userId], [created.session.jti, 'active', 'user-42']);
      assert.match(res.body.setCookie, new RegExp(`^${cookieName}=${token.replace('.', '\\.')}; `));
      cookie = token;
      assert.equal((await call('validate')).body.result.session.id, session.id);
      assert.deepEqual((await call('validate', { token: created.token })).body.result, { valid: false, reason: 'consumed' });
      const replay = await call('rotate', { token: created.token });
      assert.deepEqual([replay.status, replay.body.error.code, replay.body.error.name], [401, 'SESSION_REPLAY', 'SessionReplayError']);
      assert.equal(replay.body.setCookie, undefined);
      assert.equal((await call('validate')).body.result.valid, true, 'replay alone ends no session');
    });

    test("rotate: a token from the body (another device's) gets its successor, and this browser's cookie stays", async () => {
      const other = (await login({ ...LOGIN, deviceId: 'phone' })).body.result.token;
      await login();
      const res = await call('rotate', { token: other });
      assert.deepEqual([res.status, res.body.setCookie, res.body.result.session.deviceId], [200, undefined, 'phone']);
      assert.equal((await call('validate')).body.result.session.deviceId, 'laptop');
    });

    /** Logs in and rotates once: the consumed token, and the cookie now holding its successor. */
    const rotated = async () => {
      const predecessor = (await login()).body.result.token;
      cookie = (await call('rotate')).body.result.token;
      return predecessor;
    };

    test('revoke: logging out with the cookie revokes it and clears the cookie with the deletion cookie', async () => {
      await login();
      const res = await call('revoke');
      assert.deepEqual([res.status, res.body.result], [200, null]);
      assert.match(res.body.setCookie, new RegExp(`^${cookieName}=; `));
      assert.match(res.body.setCookie, /Max-Age=0/);
      assert.deepEqual((await call('validate')).body.result, { valid: false, reason: 'revoked' });
      assert.deepEqual((await call('revoke')).status, 200, 'idempotent');
    });

    test('revoke: a stale token follows the rotation chain and revokes its end; the stale one stays consumed', async () => {
      const stale = await rotated();
      const res = await call('revoke', { token: stale });
      assert.deepEqual([res.status, res.body.setCookie], [200, undefined], 'a token from the body is not the cookie');
      assert.deepEqual((await call('validate')).body.result, { valid: false, reason: 'revoked' });
      assert.deepEqual((await call('validate', { token: stale })).body.result, { valid: false, reason: 'consumed' });
    });

    test('destroy: deletes the record outright, no tombstone: not_found at once, and the cookie is cleared', async () => {
      const { session } = (await login()).body.result;
      const res = await call('destroy');
      assert.deepEqual([res.status, res.body.result], [200, null]);
      assert.match(res.body.setCookie, new RegExp(`^${cookieName}=; .*Max-Age=0`));
      assert.equal((await stored(session)).value, null);
      assert.deepEqual((await call('validate')).body.result, { valid: false, reason: 'not_found' });
      assert.equal((await call('destroy')).status, 200, 'idempotent');
    });

    test("setSecurityVersion: bumping the user's version invalidates every session created with the old one", async () => {
      const userId = fresh();
      await login({ ...LOGIN, userId });
      const res = await call('setSecurityVersion', { userId, version: 2 });
      assert.deepEqual([res.status, res.body.result], [200, null]);
      assert.deepEqual((await call('validate')).body.result, { valid: false, reason: 'invalid' });
      await login({ ...LOGIN, userId, securityVersion: 2 });
      assert.equal((await call('validate')).body.result.valid, true);
      const bad = await call('setSecurityVersion', { userId, version: 1.5 });
      assert.deepEqual([bad.status, bad.body.error.code], [400, 'SESSION_INVALID']);
    });

    test('list: the live sessions in the user\'s session set; a rotated or revoked one has left it', async () => {
      const userId = fresh();
      const laptop = (await login({ ...LOGIN, userId })).body.result.session;
      await login({ ...LOGIN, userId, deviceId: 'phone' });
      const successor = (await call('rotate')).body.result.session;
      const res = await call('list', { userId, offset: 0, limit: 50 });
      assert.equal(res.status, 200);
      assert.deepEqual(res.body.result.map((s: { id: string }) => s.id).sort(), [laptop.id, successor.id].sort());
      assert.deepEqual((await call('list', { userId: fresh() })).body.result, []);
    });

    test('revokeAll: deletes a batch outright and reports { affected, remaining } until none are left', async () => {
      const userId = fresh();
      for (const deviceId of ['laptop', 'phone', 'tablet']) await login({ ...LOGIN, userId, deviceId });
      assert.deepEqual((await call('revokeAll', { userId, limit: 1 })).body.result, { affected: 1, remaining: 2 });
      assert.deepEqual((await call('revokeAll', { userId, limit: 200 })).body.result, { affected: 2, remaining: 0 });
      assert.deepEqual((await call('validate')).body.result, { valid: false, reason: 'not_found' });
      assert.deepEqual((await call('revokeAll', { userId })).body.result, { affected: 0, remaining: 0 });
    });

    test("records: every record Redis holds for the user, tombstones included, with the rotation chain and validate's answer", async () => {
      const userId = fresh();
      const records = async () =>
        SessionRecordsSchema.parse((await app.inject(`/api/${mode}/session/records?${new URLSearchParams({ userId })}`)).json());
      assert.deepEqual((await records()).sessions, []);
      const first = (await login({ ...LOGIN, userId })).body.result.session;
      const successor = (await call('rotate')).body.result.session;
      cookie = (await login({ ...LOGIN, userId, deviceId: 'phone' })).body.result.token;
      await call('revoke', { token: cookie });

      const { serverTime, securityVersion, sessions } = await records();
      assert.equal(securityVersion, 1);
      assert.ok(Math.abs(serverTime - Date.now() / 1000) < 5, `server time ${serverTime}`);
      assert.equal(sessions.length, 3);
      const row = (match: (s: SessionRecord) => boolean) => sessions.find((r) => r.session && match(r.session))!;
      const [consumed, active, revoked] = [row((s) => s.id === first.id), row((s) => s.id === successor.id), row((s) => s.deviceId === 'phone')];
      assert.deepEqual([consumed.session?.status, consumed.reason, consumed.inSessionSet], ['consumed', 'consumed', false]);
      assert.equal(consumed.session?.successorId, successor.id);
      assert.ok(consumed.ttl! > 0 && consumed.ttl! <= 300, `tombstone ttl ${consumed.ttl}`);
      assert.deepEqual([active.session?.status, active.reason, active.inSessionSet, active.session?.rotatedFrom], ['active', null, true, first.jti]);
      assert.ok(active.ttl! > 3500, `ttl ${active.ttl}`);
      assert.deepEqual([revoked.session?.status, revoked.reason, revoked.inSessionSet], ['revoked', 'revoked', false]);

      await call('setSecurityVersion', { userId, version: 2 });
      const bumped = await records();
      assert.equal(bumped.securityVersion, 2);
      assert.equal(bumped.sessions.find((r) => r.session?.id === successor.id)?.reason, 'invalid');
    });

    test('validate: a bad credential is a result, not an error: malformed is invalid, unknown is not_found', async () => {
      assert.deepEqual((await call('validate', { token: 'j_fake.0000' })).body.result, { valid: false, reason: 'invalid' });
      const unknown = `${'A'.repeat(22)}.${'B'.repeat(43)}`;
      const res = await call('validate', { token: unknown });
      assert.deepEqual([res.status, res.body.result], [200, { valid: false, reason: 'not_found' }]);
    });
  });
}

test('COOKIE_SECURE=true marks the session cookie Secure', async () => {
  const secure = await buildApp({ config: testConfig({ SHOWCASE_MODES: 'standalone', COOKIE_SECURE: 'true' }) });
  try {
    await secure.ready();
    const res = await secure.inject({ method: 'POST', url: '/api/standalone/session/create', payload: LOGIN });
    assert.match(res.json().setCookie, /; Secure/);
  } finally {
    await secure.close();
  }
});
