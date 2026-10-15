// The mode guard over HTTP. Standalone points at a port nothing listens on, so it has never been healthy; cluster is
// the real Docker stack. Sentinel is left out of SHOWCASE_MODES.
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { buildApp, type FeatureModule } from '../app.ts';
import { testConfig } from '../test-config.ts';

const ping: FeatureModule = async (app, { client }) => {
  app.get('/ping', async () => ({ pong: await client.ping() }));
};

const app = await buildApp({
  config: testConfig({ REDIS_URL: 'redis://127.0.0.1:1', SHOWCASE_MODES: 'standalone,cluster' }),
  modules: { probe: ping },
});
before(() => app.ready());
after(() => app.close());

test('a mode that has never been healthy answers 503 MODE_UNAVAILABLE without reaching the module', async () => {
  const res = await app.inject('/api/standalone/probe/ping');
  assert.equal(res.statusCode, 503);
  const { error } = res.json();
  assert.deepEqual([error.code, error.name, error.mode], ['MODE_UNAVAILABLE', 'ModeUnavailableError', 'standalone']);
  assert.match(error.message, /standalone/);
});

test('an available mode reaches the module with its mode client', async () => {
  const res = await app.inject('/api/cluster/probe/ping');
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.json().result, { pong: 'PONG' });
});

test('a mode left out of SHOWCASE_MODES has no routes', async () => {
  const res = await app.inject('/api/sentinel/probe/ping');
  assert.equal(res.statusCode, 404);
  assert.equal(res.json().error.code, 'NOT_FOUND');
});
