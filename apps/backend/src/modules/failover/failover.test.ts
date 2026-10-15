// The failover mode-specific module against the sentinel Docker stack (`pnpm infra:up`). These tests fail over for real:
// each moves the master between 6380 and 6381 and waits until the stack is failover-ready again (~25 s).
import assert from 'node:assert/strict';
import { setTimeout as sleep } from 'node:timers/promises';
import { after, before, test } from 'node:test';
import { StatusResponseSchema, type SentinelStatus } from '@showcase/contracts';
import { buildApp } from '../../app.ts';
import { userKeys } from '../session/records.ts';
import { testConfig } from '../../test-config.ts';
import { eventLogEntries, openSse } from '../../test-sse.ts';

const app = await buildApp({ config: testConfig({ SHOWCASE_MODES: 'sentinel' }) });
let base: string;
before(async () => {
  base = await app.listen({ port: 0, host: '127.0.0.1' });
  await readyAgain();
});
after(() => app.close());

async function sentinelStatus(): Promise<SentinelStatus> {
  const status = StatusResponseSchema.parse((await app.inject('/api/status')).json());
  return status.modes.find((m) => m.mode === 'sentinel')!.sentinel!;
}

/** Waits until the stack can fail over again: the replica back in sync on every sentinel. */
async function readyAgain(timeoutMs = 60_000) {
  for (const deadline = Date.now() + timeoutMs; Date.now() < deadline; await sleep(500)) {
    if ((await sentinelStatus()).failoverReady) return;
  }
  assert.fail('the sentinel stack never became failover-ready');
}

const trigger = (body: object) => app.inject({ method: 'POST', url: '/api/sentinel/failover/trigger', payload: body });

test('a plain graceful failover moves the master; asking again before the replica is back answers FAILOVER_NOT_READY', async () => {
  const started = Date.now();
  const { master: from } = await sentinelStatus();

  const res = await trigger({ kind: 'graceful' });
  assert.equal(res.statusCode, 200, res.body);
  const { result, redis } = res.json();
  assert.deepEqual([result.command, result.reply, result.sentTo], ['SENTINEL FAILOVER mymaster', 'OK', '127.0.0.1:26379']);
  assert.deepEqual(
    redis.commands.filter((c: { name: string }) => c.name.toLowerCase() === 'sentinel').map((c: { args: string[] }) => c.args),
    [['GET-MASTER-ADDR-BY-NAME', 'mymaster'], ['FAILOVER', 'mymaster']],
  );

  const again = await trigger({ kind: 'graceful' });
  assert.equal(again.statusCode, 409);
  assert.equal(again.json().error.code, 'FAILOVER_NOT_READY');

  // Sentinel's announcements land in the sentinel event log, and +switch-master refreshes the status at once.
  const switched = await eventLogEntries(base, 'sentinel', (e) => e.kind === 'sentinel' && e.source === '+switch-master' && e.ts >= started);
  assert.equal(switched.length, 1);
  assert.match(switched[0].message, new RegExp(`^mymaster ${from!.replace(':', ' ')} 127\\.0\\.0\\.1 638[01]$`));
  assert.notEqual((await sentinelStatus()).master, from);

  await readyAgain();
  assert.equal((await trigger({ kind: 'nonsense' })).statusCode, 400);
});

type DrillEvent = { kind: string; [key: string]: unknown };

/** Every event of a drill's stream, up to and including `end`. */
async function drillEvents(id: string): Promise<DrillEvent[]> {
  const stream = await openSse(`${base}/api/sentinel/failover/drills/${id}/stream`);
  assert.equal(stream.status, 200);
  const events: DrillEvent[] = [];
  try {
    for (;;) {
      const event = (await stream.next(70_000)) as DrillEvent;
      events.push(event);
      if (event.kind === 'end') return events;
    }
  } finally {
    await stream.close();
  }
}

test('a graceful drill: setup, the trigger, Sentinel announcements, a workload throughout, and every check kept but Pub/Sub at the switch', async () => {
  const res = await app.inject({ method: 'POST', url: '/api/sentinel/failover/drills', payload: { kind: 'graceful' } });
  assert.equal(res.statusCode, 200, res.body);
  const { id } = res.json().result;

  // One drill at a time, and no plain failover beside it.
  for (const url of ['/api/sentinel/failover/drills', '/api/sentinel/failover/trigger']) {
    const refused = await app.inject({ method: 'POST', url, payload: { kind: 'graceful' } });
    assert.deepEqual([refused.statusCode, refused.json().error.code], [409, 'DRILL_IN_PROGRESS']);
  }

  const events = await drillEvents(id);
  const of = (kind: string) => events.filter((e) => e.kind === kind);
  assert.equal(of('setup').length, 4, JSON.stringify(of('setup')));
  assert.match(String(of('trigger')[0]?.text), /^SENTINEL FAILOVER mymaster → 127\.0\.0\.1:26379: OK$/);
  assert.ok(of('sentinel').some((e) => e.channel === '+switch-master'), 'saw +switch-master');

  const calls = of('call');
  assert.ok(calls.length > 40, `${calls.length} calls`);
  assert.deepEqual([...new Set(calls.map((c) => c.op))].sort(), ['cache.set', 'pubsub.publish', 'rateLimiter.consume', 'sessions.validate']);
  assert.deepEqual(calls.filter((c) => !c.ok), [], 'a graceful failover fails no call');
  assert.equal(new Set(calls.map((c) => c.node)).size, 2, 'calls reached the old master, then the new one');

  const [end] = of('end') as unknown as [{ checks: { label: string; outcome: string; detail: string }[] }];
  const outcomes = Object.fromEntries(end.checks.map((c) => [c.label, c]));
  assert.deepEqual(Object.keys(outcomes), ['Lock', 'Session', 'Stream group', 'Subscription', 'Writes in the two-master window']);
  for (const label of ['Lock', 'Session', 'Stream group', 'Writes in the two-master window']) {
    assert.equal(outcomes[label].outcome, 'kept', `${label}: ${outcomes[label].detail}`);
  }
  // Pub/Sub delivers at most once: a message or two published while the subscriber moves to the new master can be lost
  // (measured in about 2 graceful drills of 3). Any other gap is a failure.
  const { outcome, detail } = outcomes.Subscription;
  if (outcome !== 'kept') {
    assert.equal(outcome, 'lost', detail);
    const offsets = [...detail.matchAll(/#\d+ at ([+−])(\d+\.\d+) s/g)].map(([, sign, s]) => (sign === '+' ? 1 : -1) * Number(s));
    assert.ok(offsets.length && offsets.every((s) => s >= 0 && s <= 1), `lost only right after +switch-master: ${detail}`);
  }

  // A late listener gets the whole drill replayed.
  assert.deepEqual((await drillEvents(id)).length, events.length);

  // Its keys are gone, the session's (which carry the user's hash tag, not the drill id) included.
  for (const pattern of [`showcase:*drill:${id}*`, userKeys('showcase:session', `drill:${id}`).all]) {
    const left = await app.inject({ method: 'POST', url: '/api/sentinel/client/raw', payload: { command: 'scanCluster', pattern } });
    assert.deepEqual(left.json().result, [], pattern);
  }
});
