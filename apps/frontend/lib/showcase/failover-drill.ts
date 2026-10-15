// The failover drill against the backend: POST /api/sentinel/failover/drills starts one, its SSE stream sends every
// setup step, the trigger, each workload call, Sentinel announcement and onError, then the checks. "Fail over only"
// is POST …/trigger. The backend gates both (409 FAILOVER_NOT_READY, 409 DRILL_IN_PROGRESS); the page shows its refusal.
'use client';

import { DrillEventSchema, type DrillEvent, type FailoverKind, type SentinelStatus } from '@showcase/contracts';
import { useEffect, useState } from 'react';
import { runOperation, type RunResult } from './api';

export type DrillEventKind = DrillEvent['kind'];

export interface DrillRun {
  id: string;
  kind: FailoverKind;
  /** Every event so far, oldest first. */
  events: DrillEvent[];
  done: boolean;
}

/** What Sentinel says about a data node, next to what the node says about itself (`ROLE`). */
export interface NodeView {
  address: string;
  /** `master`, `replica` (with Sentinel's flags when it has more to say, `s_down`…), or `unknown`. */
  sentinel: string;
  /** What `ROLE` answered, `replica` for `slave`, or null when the node did not answer (paused, down). */
  own: string | null;
  /** A replica's link to its master, as the node reports it (`connected`, `sync`…). */
  link?: string;
  error?: string;
}

/** Each data node Sentinel has named, as Sentinel sees it and as it sees itself. */
export function nodeViews(status: SentinelStatus | null): NodeView[] {
  if (!status) return [];
  const replicas = status.sentinels.find((s) => !s.error)?.replicas ?? [];
  return status.nodes.map(({ address, role, linkState, error }) => {
    const replica = replicas.find((r) => r.address === address);
    const flags = replica?.flags.split(',').filter((f) => f !== 'slave') ?? [];
    const sentinel = address === status.master ? 'master' : replica ? ['replica', ...flags].join(' · ') : 'unknown';
    return { address, sentinel, own: role === 'slave' ? 'replica' : role, ...(linkState && { link: linkState }), ...(error && { error }) };
  });
}

const refusalOf = (r: RunResult) => {
  const error = (r.body as { error?: { code: string; message: string } }).error;
  return error ? `${r.httpStatus || ''} ${error.code}: ${error.message}`.trim() : null;
};

/** One drill at a time, followed over its stream; `onResult` gets each request the section sends. */
export function useFailoverDrill(onResult: (r: RunResult) => void) {
  const [run, setRun] = useState<DrillRun | null>(null);
  const [refusal, setRefusal] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const id = run?.id;

  useEffect(() => {
    if (!id) return;
    const source = new EventSource(`/api/sentinel/failover/drills/${id}/stream`);
    // The backend replays the whole drill to every listener, so a reconnect starts the list over.
    source.onopen = () => setRun((r) => r && { ...r, events: [] });
    source.onmessage = (message) => {
      let event: DrillEvent;
      try {
        event = DrillEventSchema.parse(JSON.parse(message.data));
      } catch (error) {
        console.warn('Skipped a malformed drill event', error);
        return;
      }
      // The stream ends after `end`; closing first keeps the browser from reconnecting to replay it.
      if (event.kind === 'end') source.close();
      setRun((r) => r && { ...r, events: [...r.events, event], done: event.kind === 'end' });
    };
    return () => source.close();
  }, [id]);

  const send = async (op: 'drills' | 'trigger', kind: FailoverKind, pauseMs?: number) => {
    setSending(true);
    setRefusal(null);
    const r = await runOperation('sentinel', 'failover', op, () => ({ kind, ...(kind === 'unresponsive' && pauseMs && { pauseMs }) }));
    setSending(false);
    onResult(r);
    if (r.httpStatus !== 200) return setRefusal(refusalOf(r));
    if (op === 'drills') setRun({ id: (r.body as { id: string }).id, kind, events: [], done: false });
  };

  const calls = run?.events.filter((e) => e.kind === 'call') ?? [];
  const stats = {
    calls: calls.length,
    failed: calls.filter((c) => !c.ok).length,
    worstMs: calls.reduce((m, c) => Math.max(m, c.latencyMs), 0),
    onError: run?.events.filter((e) => e.kind === 'onError').length ?? 0,
    staleWrites: calls.filter((c) => c.stale && c.op === 'cache.set' && c.ok).length,
  };
  return {
    run,
    running: !!run && !run.done,
    sending,
    refusal,
    stats,
    drill: (kind: FailoverKind, pauseMs?: number) => send('drills', kind, pauseMs),
    failOver: (kind: FailoverKind, pauseMs?: number) => send('trigger', kind, pauseMs),
  };
}
