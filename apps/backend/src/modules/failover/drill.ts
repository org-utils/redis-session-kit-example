// A failover drill: a lock, a session, a stream group with a blocked read and a subscription are set up on the sentinel
// mode client, then the master is failed over while a workload runs every ~100 ms, until the stack is failover-ready
// again (at most 45 s). Every call, Sentinel announcement and onError is an event; at the end, five checks say what
// survived. Its keys carry the drill id inside the usual showcase namespaces and are deleted when it ends.
import { setTimeout as sleep } from 'node:timers/promises';
import type { DrillCheck, DrillEvent, FailoverKind, FailoverTriggerResult, SentinelStatus } from '@showcase/contracts';
import type { RedisClient, StreamEntry } from 'ioredis-toolkit';
import type { ModeEvents } from '../../app.ts';
import { lastNode } from '../../redis/redis-trace.ts';
import { userKeys } from '../session/records.ts';

const TICK_MS = 100;
const WATCH_MS = 45_000;
const LOCK_TTL = 120;
/** The blocked read outlasts the watch, so it is still waiting when the failover happens. */
const READ_BLOCK_MS = 60_000;
const CHECK_WAIT_MS = 3000;

export interface Drill {
  id: string;
  /** Every event so far, oldest first. */
  events: DrillEvent[];
  done: boolean;
  /** Calls `listener` with each new event until the returned function is called. */
  listen(listener: (event: DrillEvent) => void): () => void;
}

export interface DrillDeps {
  id: string;
  kind: FailoverKind;
  pauseMs?: number;
  client: RedisClient;
  events: ModeEvents;
  sentinelStatus: () => SentinelStatus | undefined;
  trigger: (kind: FailoverKind, pauseMs?: number) => Promise<FailoverTriggerResult>;
}

const message = (error: unknown) => (error instanceof Error ? error.message : String(error));
const kept = (label: string, detail: string): DrillCheck => ({ label, outcome: 'kept', detail });
const lost = (label: string, detail: string): DrillCheck => ({ label, outcome: 'lost', detail });
const unknown = (label: string, detail: string): DrillCheck => ({ label, outcome: 'unknown', detail });

/** Starts a drill and returns it at once; it runs in the background. */
export function startDrill(deps: DrillDeps): Drill {
  const listeners = new Set<(event: DrillEvent) => void>();
  const drill: Drill = {
    id: deps.id,
    events: [],
    done: false,
    listen(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
  const started = Date.now();
  const emit = (event: DrillEvent) => {
    drill.events.push(event);
    for (const listener of listeners) listener(event);
  };
  void run(deps, () => Date.now() - started, emit).then((checks) => {
    drill.done = true;
    emit({ kind: 'end', t: Date.now() - started, checks });
  });
  return drill;
}

async function run(
  { id, kind, pauseMs, client, events, sentinelStatus, trigger }: DrillDeps,
  at: () => number,
  emit: (event: DrillEvent) => void,
): Promise<DrillCheck[]> {
  const { cache, lock, pubsub, rateLimiter, sessions, streams } = client;
  const tag = `drill:${id}`;
  /** When `+switch-master` reached the backend, ms since the drill started. */
  let switchedAt: number | null = null;
  const stopWatching = events.subscribe((entry) => {
    if (entry.kind === 'sentinel') {
      emit({ kind: 'sentinel', t: at(), channel: entry.source, message: entry.message });
      if (entry.source === '+switch-master') switchedAt ??= at();
    } else if (entry.kind === 'error') {
      emit({ kind: 'onError', t: at(), source: entry.source, message: entry.message });
    }
  });
  let subscription: Awaited<ReturnType<typeof pubsub.subscribe>> | undefined;
  try {
    // Setup.
    const { token: lockToken } = await lock.acquire(tag, LOCK_TTL);
    emit({ kind: 'setup', t: at(), text: `lock.acquire("${tag}", ${LOCK_TTL}) → acquired` });
    const { token: sessionToken } = await sessions.create({ userId: tag, deviceId: 'drill', securityVersion: 1 });
    emit({ kind: 'setup', t: at(), text: `sessions.create({ userId: "${tag}" }) → a session` });
    await streams.createGroup(tag, 'billing', '$');
    const blockedRead = settle(streams.read(tag, { group: 'billing', consumer: 'drill', count: 1, blockMs: READ_BLOCK_MS }));
    emit({ kind: 'setup', t: at(), text: `streams.createGroup("${tag}", "billing") and a group read blocked for up to ${READ_BLOCK_MS / 1000} s` });
    const received = new Set<number>();
    subscription = await pubsub.subscribe<{ n: number }>(tag, ({ value }) => void received.add(value.n));
    emit({ kind: 'setup', t: at(), text: `pubsub.subscribe("${tag}") → subscribed` });

    // The failover, with the workload running until the stack is failover-ready again.
    const sent = await trigger(kind, pauseMs);
    emit({ kind: 'trigger', t: at(), text: `${sent.command} → ${sent.sentTo}: ${sent.reply}` });
    const from = sent.from;
    let stop = false;
    /** Each message published OK: its number, and when (ms since the drill started). */
    const published = new Map<number, number>();
    const staleWrites: string[] = [];
    const workload = (async () => {
      for (let n = 1; !stop; n++) {
        const tick = Date.now();
        const key = `${tag}:w:${n}`;
        const calls: [string, () => Promise<unknown>][] = [
          ['cache.set', () => cache.set(key, { n }, { ttl: 300 })],
          ['rateLimiter.consume', () => rateLimiter.consume(tag)],
          ['sessions.validate', () => sessions.validate(sessionToken)],
          ['pubsub.publish', () => pubsub.publish(tag, { n })],
        ];
        for (const [op, call] of calls) {
          const begun = performance.now();
          const { outcome, node } = await lastNode(call);
          const ok = outcome.status === 'fulfilled';
          const stale = switchedAt !== null && node === from;
          emit({
            kind: 'call', t: at(), op, latencyMs: +(performance.now() - begun).toFixed(1), ok, node, stale,
            ...(!ok && { error: message(outcome.reason) }),
          });
          if (ok && stale && op === 'cache.set') staleWrites.push(key);
          if (ok && op === 'pubsub.publish') published.set(n, at());
        }
        await sleep(Math.max(0, TICK_MS - (Date.now() - tick)));
      }
    })();
    const deadline = Date.now() + WATCH_MS;
    while (Date.now() < deadline) {
      const status = sentinelStatus();
      if (status?.master && status.master !== from && status.failoverReady) break;
      await sleep(250);
    }
    stop = true;
    await workload;

    // What survived.
    return [
      await check('Lock', async () => {
        const second = await lock.acquire(tag, LOCK_TTL);
        if (second.acquired) await lock.release(tag, second.token);
        const extended = await lock.extend(tag, lockToken, LOCK_TTL);
        return !second.acquired && extended
          ? kept('Lock', 'still held: a second acquire was refused, and extend with the token returned true')
          : lost('Lock', `${second.acquired ? 'a second caller acquired it' : 'a second acquire was refused'}; extend with the token → ${extended}`);
      }),
      await check('Session', async () => {
        const result = await sessions.validate(sessionToken);
        return result.valid ? kept('Session', 'validate → valid') : lost('Session', `validate → ${result.reason}`);
      }),
      await check('Stream group', async () => {
        const entryId = await streams.add(tag, { check: 'after the failover' });
        const read = await Promise.race([blockedRead, sleep(CHECK_WAIT_MS).then(() => null)]);
        const got = read?.status === 'fulfilled' && read.value.some((e: StreamEntry) => e.id === entryId);
        const readDetail = got
          ? 'the blocked read got the entry added after the failover'
          : read?.status === 'rejected' ? `the blocked read ended with "${message(read.reason)}"` : 'the blocked read was still waiting';
        try {
          await streams.read(tag, { group: 'billing', consumer: 'drill-check', id: '0', blockMs: 100 });
          return kept('Stream group', `the group still exists; ${readDetail}`);
        } catch (error) {
          return /NOGROUP/.test(message(error)) ? lost('Stream group', `NOGROUP: the group is gone; ${readDetail}`) : unknown('Stream group', message(error));
        }
      }),
      await check('Subscription', async () => {
        await sleep(300); // the last messages may still be on their way
        if (!published.size) return unknown('Subscription', 'no publish succeeded');
        const missing = [...published].filter(([n]) => !received.has(n));
        const last = Math.max(...published.keys());
        if (!missing.length) return kept('Subscription', `messages #1…#${last}: all ${published.size} published ones arrived, no gaps`);
        // Pub/Sub delivers at most once: a message published while the subscriber is moving to the new master is gone.
        const when = (t: number) => (switchedAt === null ? '' : ` at ${t >= switchedAt ? '+' : '−'}${(Math.abs(t - switchedAt) / 1000).toFixed(2)} s`);
        const list = missing.slice(0, 5).map(([n, t]) => `#${n}${when(t)}`).join(', ');
        return lost('Subscription', `${missing.length} of ${published.size} published messages never arrived: ${list}${missing.length > 5 ? ', …' : ''}${switchedAt === null ? '' : ' (relative to +switch-master)'}`);
      }),
      await check('Writes in the two-master window', async () => {
        if (!staleWrites.length) return kept('Writes in the two-master window', 'none went to the old master');
        let gone = 0;
        for (const key of staleWrites) if (!(await cache.has(key))) gone++;
        const detail = `${staleWrites.length} ${staleWrites.length === 1 ? 'write' : 'writes'} answered OK by the old master after Sentinel switched away; ${gone} gone now`;
        return gone ? lost('Writes in the two-master window', detail) : kept('Writes in the two-master window', detail);
      }),
    ];
  } catch (error) {
    emit({ kind: 'failed', t: at(), message: message(error) });
    return [];
  } finally {
    stopWatching();
    await subscription?.unsubscribe().catch(() => {});
    // revokeAll removes the token locator; the session's other keys carry the user's hash tag, not the drill id, so
    // they go by the user's own pattern.
    await sessions.revokeAll(tag).catch(() => {});
    await client.deletePatternClusterAware(userKeys(client.config.sessions.namespace, tag).all).catch(() => {});
    await client.deletePatternClusterAware(`showcase:*${tag}*`).catch(() => {});
  }
}

/** Runs one check; one that throws reads as unknown, with why. */
async function check(label: string, fn: () => Promise<DrillCheck>): Promise<DrillCheck> {
  try {
    return await fn();
  } catch (error) {
    return unknown(label, message(error));
  }
}

/** A promise that never rejects: its outcome, for a call whose result is looked at later. */
const settle = <T>(promise: Promise<T>): Promise<PromiseSettledResult<T>> =>
  promise.then(
    (value) => ({ status: 'fulfilled', value }),
    (reason: unknown) => ({ status: 'rejected', reason }),
  );
