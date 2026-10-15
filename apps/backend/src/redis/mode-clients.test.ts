// Smoke test against the Docker stacks (`pnpm infra:up`): each mode client reaches its connection mode.
import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { testConfig } from '../test-config.ts';
import { closeModeClients, createModeClients } from './mode-clients.ts';

const clients = createModeClients(testConfig(), { onError: () => {} });
after(() => closeModeClients(clients));

for (const [mode, client] of clients) {
  test(`${mode}: health() answers healthy`, async () => {
    const health = await client.health({ timeoutMs: 2000, degradedMs: 1000 });
    assert.equal(health.status, 'healthy', health.error);
  });
}

test('cluster: health() checks every master', async () => {
  const health = await clients.get('cluster')!.health({ timeoutMs: 2000 });
  assert.deepEqual(health.nodes?.map((n) => n.address).sort(), ['127.0.0.1:7001', '127.0.0.1:7002', '127.0.0.1:7003']);
});
