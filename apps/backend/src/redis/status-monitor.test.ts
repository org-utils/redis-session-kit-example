// The availability rule: a mode answers 503 only after 3 unhealthy checks in a row, or if it has never been healthy.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { RedisHealthStatus } from 'ioredis-toolkit';
import { createEventLog } from './event-log.ts';
import { createStatusMonitor } from './status-monitor.ts';

/** A monitor over one standalone mode whose checks return the given statuses in turn. */
function scripted(...statuses: RedisHealthStatus[]) {
  const eventLog = createEventLog();
  const monitor = createStatusMonitor({
    checks: new Map([['standalone', async () => ({ health: { status: statuses.shift()!, latencyMs: 1 } })]]),
    eventLog,
  });
  return { monitor, eventLog, available: () => monitor.isAvailable('standalone') };
}

test('a mode is unavailable until its first healthy check', async () => {
  const { monitor, available } = scripted('unhealthy', 'unhealthy', 'healthy');
  assert.equal(available(), false, 'before any check');
  await monitor.refresh();
  await monitor.refresh();
  assert.equal(available(), false, 'never healthy yet');
  await monitor.refresh();
  assert.equal(available(), true);
});

test('a healthy mode stays available through 2 unhealthy checks and becomes unavailable on the 3rd', async () => {
  const { monitor, available } = scripted('healthy', 'unhealthy', 'unhealthy', 'unhealthy', 'healthy');
  await monitor.refresh();
  await monitor.refresh();
  await monitor.refresh();
  assert.equal(available(), true, 'after 2 unhealthy checks');
  await monitor.refresh();
  assert.equal(available(), false, 'after 3 unhealthy checks');
  await monitor.refresh();
  assert.equal(available(), true, 'healthy again');
});

test('a degraded mode still answers, so it counts as available', async () => {
  const { monitor, available } = scripted('degraded');
  await monitor.refresh();
  assert.equal(available(), true);
});

test('each health change is written to the event log, and a steady health is not', async () => {
  const { monitor, eventLog } = scripted('healthy', 'healthy', 'unhealthy', 'healthy');
  for (let i = 0; i < 4; i++) await monitor.refresh();
  assert.deepEqual(
    eventLog.entries().map((e) => [e.mode, e.kind, e.message.split(' (')[0]]),
    [
      ['standalone', 'health', 'healthy'],
      ['standalone', 'health', 'healthy → unhealthy'],
      ['standalone', 'health', 'unhealthy → healthy'],
    ],
  );
});

test('a check that throws counts as unhealthy instead of stopping the monitor', async () => {
  const eventLog = createEventLog();
  const monitor = createStatusMonitor({
    checks: new Map([['standalone', async () => { throw new Error('probe exploded'); }]]),
    eventLog,
  });
  await monitor.refresh();
  const [status] = monitor.snapshot();
  assert.deepEqual([status.health?.status, status.health?.error, status.available], ['unhealthy', 'probe exploded', false]);
});
