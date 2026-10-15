// PROTOTYPE (throwaway): an in-memory failover drill for the failover section prototype. It replays the timings
// measured against the upstream sentinel stack (see the resolution of "Mode-specific modules: what the failover and
// cluster demos show"), sped up 4x. Module outcomes for "Unresponsive master" are guesses until the real backend runs.
'use client';

import { useEffect, useRef, useState } from 'react';
import type { OpSpec } from './examples';

export type Port = '6380' | '6381';
export type DrillKind = 'graceful' | 'unresponsive';
export type EventKind = 'setup' | 'trigger' | 'call' | 'sentinel' | 'onError' | 'check';

export interface DrillEvent {
  id: number; t: number; kind: EventKind; text: string;
  op?: string; latencyMs?: number; ok?: boolean; node?: Port; stale?: boolean;
}
export interface NodeView { sentinel: 'master' | 'replica' | 'down'; own: 'master' | 'replica' | 'paused'; link?: 'ok' | 'syncing' | 'down' }
export interface Check { label: string; outcome: 'kept' | 'lost' | 'unknown'; detail: string }
export interface DrillState {
  id: number; kind: DrillKind; withWorkload: boolean; from: Port; to: Port; t: number; endT: number; done: boolean;
  events: DrillEvent[]; checks: Check[];
}

export const SPEED = 4;
export const WINDOW_MS = 45_000;
const other = (p: Port): Port => (p === '6380' ? '6381' : '6380');
const OPS = ['cache.set', 'rateLimiter.consume', 'sessions.validate', 'pubsub.publish'];

export const DRILL_SPEC: OpSpec = {
  fields: [
    { name: 'kind', label: 'how the master goes away', kind: 'select', options: ['graceful', 'unresponsive'] },
    { name: 'pauseMs', label: 'pause (ms, unresponsive only)', kind: 'number' },
  ],
  examples: [
    { id: 'graceful', title: 'Graceful failover', description: 'SENTINEL FAILOVER: the replica is promoted and the package carries on without a single error.', values: { kind: 'graceful', pauseMs: '' } },
    { id: 'unresponsive', title: 'Unresponsive master', description: 'CLIENT PAUSE 8000 ALL on the master: calls stall, onError fires, and for ~10 s two nodes both think they are master.', values: { kind: 'unresponsive', pauseMs: 8000 } },
  ],
  call: (v) => (v.kind === 'unresponsive'
    ? `CLIENT PAUSE ${v.pauseMs || 8000} ALL   // sent to the current master by the showcase, not the package`
    : 'SENTINEL FAILOVER mymaster   // sent to 127.0.0.1:26379 by the showcase, not the package'),
};

/** Builds the whole timeline up front; the hook reveals it as time passes. */
function script(kind: DrillKind, from: Port, withWorkload: boolean, pauseMs: number) {
  const to = other(from);
  const ev: Omit<DrillEvent, 'id'>[] = [];
  const add = (t: number, kind: EventKind, text: string, extra: Partial<DrillEvent> = {}) => ev.push({ t, kind, text, ...extra });
  if (withWorkload) {
    add(0, 'setup', 'lock.acquire("drill:7") → acquired (ttl 120 s)');
    add(40, 'setup', 'sessions.create({ userId: "drill-7" }) → session j_d7a1');
    add(80, 'setup', 'streams.createGroup("drill:7", "billing") and a blocked group read (blockMs 0)');
    add(120, 'setup', 'pubsub.subscribe("drill:7") → subscribed');
  }
  const trigger = 500;
  if (kind === 'graceful') add(trigger, 'trigger', 'SENTINEL FAILOVER mymaster → 127.0.0.1:26379: OK');
  else add(trigger, 'trigger', `CLIENT PAUSE ${pauseMs} ALL → 127.0.0.1:${from}: OK`);

  // Sentinel announcements and node roles, from the measured runs.
  const S = (dt: number, text: string) => add(trigger + dt, 'sentinel', text);
  let switchAt: number, ownMasterUntil: number, linkOkAt: number, readyAt: number, pauseEnd = 0;
  if (kind === 'graceful') {
    S(60, '+new-epoch 1'); S(80, '+try-failover master mymaster'); S(150, `+selected-slave slave 127.0.0.1:${to}`);
    S(250, '+failover-state-wait-promotion'); S(1050, `+promoted-slave slave 127.0.0.1:${to}`);
    switchAt = trigger + 1100;
    S(1100, `+switch-master mymaster 127.0.0.1 ${from} 127.0.0.1 ${to}`); S(1120, '+failover-end');
    ownMasterUntil = switchAt + 11_000; linkOkAt = switchAt + 16_000; readyAt = switchAt + 20_200;
    S(11_000 + 1100, `+convert-to-slave slave 127.0.0.1:${from}`);
  } else {
    pauseEnd = trigger + pauseMs;
    S(1070, `+sdown master mymaster 127.0.0.1 ${from}`); S(1130, '+odown master mymaster #quorum 2/2');
    S(1150, '+try-failover master mymaster'); S(1280, `+selected-slave slave 127.0.0.1:${to}`);
    S(2150, `+promoted-slave slave 127.0.0.1:${to}`);
    switchAt = trigger + 2210;
    S(2210, `+switch-master mymaster 127.0.0.1 ${from} 127.0.0.1 ${to}`); S(2230, '+failover-end');
    S(3280, `+sdown slave 127.0.0.1:${from}`);
    S(pauseMs + 30, `-sdown slave 127.0.0.1:${from} (pause over; it still reports role master)`);
    ownMasterUntil = trigger + pauseMs + 10_000; linkOkAt = ownMasterUntil + 10_000; readyAt = switchAt + 28_000;
    S(pauseMs + 10_000, `+convert-to-slave slave 127.0.0.1:${from}`);
  }
  add(readyAt, 'sentinel', 'all three sentinels see the replica in sync: failover ready');

  const endT = Math.min(readyAt + 800, WINDOW_MS);
  let staleWrites = 0;
  if (withWorkload) {
    let t = 200, i = 0;
    while (t < endT - 600) {
      const op = OPS[i++ % OPS.length];
      let latency = 0.5 + Math.random() * 1.5, node: Port = t < switchAt ? from : to, stale = false;
      if (kind === 'graceful' && t >= switchAt - 100 && t < switchAt + 100) latency = 23;
      if (kind === 'unresponsive' && t >= trigger && t < pauseEnd) {
        latency = pauseEnd - t; node = from; // stuck on the paused master until the pause ends
      } else if (kind === 'unresponsive' && t >= pauseEnd && t < ownMasterUntil) {
        node = from; stale = op !== 'sessions.validate'; // the old master still answers as master
        if (stale) staleWrites++;
      } else if (kind === 'unresponsive' && t >= ownMasterUntil && t < ownMasterUntil + 400) {
        latency = 380; // reconnect through the sentinels after +convert-to-slave kills the connection
      }
      add(t + latency, 'call', `${op}()`, { op, latencyMs: +latency.toFixed(1), ok: true, node, stale });
      t += Math.max(100, latency);
    }
    if (kind === 'unresponsive') {
      for (const src of ['connection', 'subscriber', 'stream-reader']) {
        add(ownMasterUntil + 20, 'onError', `${src}: read ECONNRESET`);
        add(ownMasterUntil + 60, 'onError', `${src}: All sentinels are unreachable. Retrying from scratch after 10ms.`);
      }
    }
  }
  const checks: Check[] = !withWorkload ? [] : kind === 'graceful' ? [
    { label: 'Lock', outcome: 'kept', detail: 'still held; a second acquire was refused; release with the token returned true' },
    { label: 'Session', outcome: 'kept', detail: 'validate → valid' },
    { label: 'Stream group', outcome: 'kept', detail: 'the blocked read was resent to the new master and got the next entry' },
    { label: 'Subscription', outcome: 'kept', detail: 'resubscribed; sequence 1…214 with no gaps' },
    { label: 'Writes in the two-master window', outcome: 'kept', detail: 'none went to the old master' },
  ] : [
    { label: 'Lock', outcome: 'kept', detail: 'written before the pause and replicated (guess until measured)' },
    { label: 'Session', outcome: 'kept', detail: 'validate → valid (guess until measured)' },
    { label: 'Stream group', outcome: 'unknown', detail: 'measured at build' },
    { label: 'Subscription', outcome: 'unknown', detail: 'gaps depend on which node the publisher reached (measured at build)' },
    { label: 'Writes in the two-master window', outcome: 'lost', detail: `${staleWrites} writes answered OK by the old master, gone after +convert-to-slave (guess until measured)` },
  ];
  ev.sort((a, b) => a.t - b.t);
  return { to, endT, events: ev.map((e, i) => ({ ...e, id: i })), checks, switchAt, ownMasterUntil, linkOkAt, readyAt, pauseEnd, trigger };
}

type Script = ReturnType<typeof script>;

/** What Sentinel says and what each node says about itself, at time t of a drill. */
export function nodesAt(s: Script | null, from: Port, t: number): Record<Port, NodeView> {
  const to = other(from);
  if (!s || t < s.trigger) return { [from]: { sentinel: 'master', own: 'master' }, [to]: { sentinel: 'replica', own: 'replica', link: 'ok' } } as Record<Port, NodeView>;
  const switched = t >= s.switchAt;
  const paused = s.pauseEnd > 0 && t < s.pauseEnd;
  const oldOwn: NodeView['own'] = paused ? 'paused' : t < s.ownMasterUntil ? 'master' : 'replica';
  const oldSentinel: NodeView['sentinel'] = !switched ? 'master' : paused ? 'down' : 'replica';
  const link: NodeView['link'] = t < s.ownMasterUntil ? 'down' : t < s.linkOkAt ? 'syncing' : 'ok';
  return {
    [from]: { sentinel: oldSentinel, own: oldOwn, link: switched ? link : undefined },
    [to]: { sentinel: switched ? 'master' : 'replica', own: t >= s.switchAt - 50 ? 'master' : 'replica', link: switched ? undefined : 'ok' },
  } as Record<Port, NodeView>;
}

/** Runs one drill (or a plain failover without the workload) at a time, gated on failover readiness. */
export function useFailoverDrill() {
  const [master, setMaster] = useState<Port>('6380');
  const [run, setRun] = useState<{ state: DrillState; script: Script } | null>(null);
  const [refusal, setRefusal] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  useEffect(() => () => { if (timer.current) clearInterval(timer.current); }, []);

  const running = !!run && !run.state.done;
  const ready = !run || run.state.t >= run.script.readyAt;
  const t = run?.state.t ?? 0;

  const start = (kind: DrillKind, withWorkload: boolean, pauseMs = 8000) => {
    if (running && withWorkload && run!.state.withWorkload) return setRefusal('409 DRILL_IN_PROGRESS: one drill at a time.');
    if (!ready) return setRefusal(`409 FAILOVER_NOT_READY: the replica is resyncing (ready in ~${Math.ceil((run!.script.readyAt - t) / 1000)} s).`);
    setRefusal(null);
    const from = master, sc = script(kind, from, withWorkload, pauseMs || 8000);
    const state: DrillState = { id: Date.now(), kind, withWorkload, from, to: sc.to, t: 0, endT: sc.endT, done: false, events: [], checks: [] };
    setRun({ state, script: sc });
    if (timer.current) clearInterval(timer.current);
    timer.current = setInterval(() => {
      setRun((r) => {
        if (!r) return r;
        const nt = r.state.t + 100 * SPEED;
        const done = nt >= r.script.endT;
        if (nt >= r.script.switchAt && r.state.t < r.script.switchAt) setMaster(r.script.to);
        if (done && timer.current) clearInterval(timer.current);
        return { ...r, state: { ...r.state, t: nt, done, events: r.script.events.filter((e) => e.t <= nt), checks: done ? r.script.checks : [] } };
      });
    }, 100);
  };

  const nodes = nodesAt(run?.script ?? null, run?.state.from ?? master, t);
  const calls = run?.state.events.filter((e) => e.kind === 'call') ?? [];
  const stats = {
    calls: calls.length, failed: calls.filter((c) => !c.ok).length,
    worstMs: calls.reduce((m, c) => Math.max(m, c.latencyMs ?? 0), 0),
    onError: run?.state.events.filter((e) => e.kind === 'onError').length ?? 0,
    staleWrites: calls.filter((c) => c.stale).length,
  };
  const readyInMs = run && !ready ? run.script.readyAt - t : 0;
  return { master, run: run?.state ?? null, script: run?.script ?? null, running, ready, readyInMs, refusal, nodes, stats, start };
}
