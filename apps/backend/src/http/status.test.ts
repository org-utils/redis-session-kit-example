// GET /api/status against the Docker stacks (`pnpm infra:up`).
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { StatusResponseSchema, type StatusResponse } from '@showcase/contracts';
import { buildApp } from '../app.ts';
import { testConfig } from '../test-config.ts';

const app = await buildApp({ config: testConfig() });
let status: StatusResponse;
before(async () => {
  await app.ready();
  const res = await app.inject('/api/status');
  assert.equal(res.statusCode, 200, res.body);
  status = StatusResponseSchema.parse(res.json());
});
after(() => app.close());

const of = (mode: string) => status.modes.find((m) => m.mode === mode)!;

test('reports a health() result for every mode, all available', () => {
  assert.deepEqual(status.modes.map((m) => [m.mode, m.health?.status, m.available]), [
    ['standalone', 'healthy', true],
    ['sentinel', 'healthy', true],
    ['cluster', 'healthy', true],
  ]);
});

test('sentinel: the master, quorum on every sentinel, the replica in sync and failover ready', () => {
  const sentinel = of('sentinel').sentinel!;
  assert.match(sentinel.master ?? '', /^127\.0\.0\.1:638[01]$/);
  assert.deepEqual(sentinel.sentinels.map((s) => [s.address, s.quorumOk]), [
    ['127.0.0.1:26379', true],
    ['127.0.0.1:26380', true],
    ['127.0.0.1:26381', true],
  ]);
  for (const s of sentinel.sentinels) {
    assert.deepEqual(s.replicas.map((r) => [r.flags, r.masterLinkStatus]), [['slave', 'ok']]);
  }
  assert.equal(sentinel.failoverReady, true);
});

test('cluster: cluster_state ok and slot ranges covering all 16384 slots across the 3 masters', () => {
  const cluster = of('cluster').cluster!;
  assert.equal(cluster.state, 'ok');
  assert.equal(cluster.slots.reduce((n, r) => n + r.end - r.start + 1, 0), 16384);
  assert.deepEqual([...new Set(cluster.slots.map((r) => r.master))].sort(), ['127.0.0.1:7001', '127.0.0.1:7002', '127.0.0.1:7003']);
});

test('standalone has no sentinel or cluster extras', () => {
  assert.equal(of('standalone').sentinel, undefined);
  assert.equal(of('standalone').cluster, undefined);
});
