// The failover mode-specific module, registered on sentinel only under /api/sentinel/failover. It fails the master over
// (graceful, or by pausing it), plainly or as a drill, but only while the stack is failover-ready and no drill is running.
import { randomBytes } from 'node:crypto';
import {
  DrillParamsSchema, FailoverTriggerRequestSchema, type DrillEvent, type FailoverKind, type FailoverTriggerResult,
} from '@showcase/contracts';
import type { ModeSpecificModule } from '../../app.ts';
import { ShowcaseError } from '../../http/errors.ts';
import { sseStreams } from '../../http/sse.ts';
import { firstReachable, oneOff } from '../../redis/own-connections.ts';
import { untraced } from '../../redis/redis-trace.ts';
import { startDrill, type Drill } from './drill.ts';

const DEFAULT_PAUSE_MS = 8000;
/** Longest a trigger keeps the gate shut waiting for the switch and the resync (measured: ~20 s after the switch). */
const SETTLE_TIMEOUT_MS = 60_000;
/** Finished drills kept for a late listener. */
const DRILLS_KEPT = 5;

export const failoverModule: ModeSpecificModule = async (app, { client, events, monitor, config }) => {
  const name = config.REDIS_SENTINEL_NAME;
  const sentinelStatus = () => monitor.snapshot().find((m) => m.mode === 'sentinel')?.sentinel;

  // The status is checked every 2 s, so right after a trigger it still says ready. Until a check shows the new master
  // and the replica back in sync, a trigger counts as still settling.
  let settling: { from: string; until: number } | null = null;
  const ready = () => {
    const status = sentinelStatus();
    if (settling && (Date.now() > settling.until || (status?.master !== settling.from && status?.failoverReady))) settling = null;
    return !settling && !!status?.failoverReady;
  };

  const drills = new Map<string, Drill>();
  const running = () => [...drills.values()].some((d) => !d.done);

  /** Refuses unless the stack can fail over now: no drill running, and failover-ready. */
  function assertReady() {
    if (running()) throw new ShowcaseError(409, 'DRILL_IN_PROGRESS', 'A failover drill is running: one at a time');
    if (!ready()) {
      throw new ShowcaseError(409, 'FAILOVER_NOT_READY', 'Not failover-ready: the replica is not back in sync with the master yet');
    }
  }

  /** Sends the failover and returns what was sent where; the gate stays shut until it has settled. */
  async function trigger(kind: FailoverKind, pauseMs = DEFAULT_PAUSE_MS): Promise<FailoverTriggerResult> {
    const { redis: sentinel, address } = await firstReachable(config.REDIS_SENTINELS);
    try {
      const [host, port] = (await sentinel.call('SENTINEL', 'GET-MASTER-ADDR-BY-NAME', name)) as [string, string];
      const from = `${host}:${port}`;
      settling = { from, until: Date.now() + SETTLE_TIMEOUT_MS };
      if (kind === 'graceful') {
        const reply = String(await sentinel.call('SENTINEL', 'FAILOVER', name));
        return { kind, command: `SENTINEL FAILOVER ${name}`, sentTo: address, reply, from };
      }
      const master = oneOff({ host, port: Number(port) });
      try {
        await master.connect();
        const reply = String(await master.call('CLIENT', 'PAUSE', String(pauseMs), 'ALL'));
        return { kind, command: `CLIENT PAUSE ${pauseMs} ALL`, sentTo: from, reply, from };
      } finally {
        master.disconnect();
      }
    } catch (error) {
      settling = null;
      throw error;
    } finally {
      sentinel.disconnect();
    }
  }

  // Not a package call: the package has no failover command. The trace shows what the showcase sent.
  app.post('/trigger', { schema: { body: FailoverTriggerRequestSchema } }, async ({ body }) => {
    assertReady();
    return trigger(body.kind, body.pauseMs);
  });

  // Starts a drill and answers with its id at once; the drill runs outside this request, so its calls are not traced.
  app.post('/drills', { schema: { body: FailoverTriggerRequestSchema } }, async ({ body }) => {
    assertReady();
    const id = randomBytes(4).toString('hex');
    const drill = untraced(() => startDrill({ id, kind: body.kind, pauseMs: body.pauseMs, client, events, sentinelStatus, trigger }));
    drills.set(id, drill);
    for (const old of [...drills.keys()].slice(0, -DRILLS_KEPT)) drills.delete(old);
    return { id };
  });

  const openStream = sseStreams(app);
  app.get('/drills/:id/stream', { schema: { params: DrillParamsSchema } }, (request, reply) => {
    const drill = drills.get(request.params.id);
    if (!drill) throw new ShowcaseError(404, 'DRILL_NOT_FOUND', `No drill ${request.params.id} (only the last ${DRILLS_KEPT} are kept)`);
    const stream = openStream<DrillEvent>(request, reply);
    const send = (event: DrillEvent) => {
      stream.send(event);
      if (event.kind === 'end') stream.end();
    };
    for (const event of drill.events) send(event);
    if (!drill.done) stream.onEnd(drill.listen(send));
  });
};
