// Live connection-mode status and the event log, from the backend's GET /api/events stream (first render: GET
// /api/status, fetched by the page on the server).
'use client';

import { MODES, ServerEventSchema, type EventLogEntry, type HealthStatus, type Mode, type ModeStatus, type StatusResponse } from '@showcase/contracts';
import { useState } from 'react';
import { useEventSource, type StreamState } from './use-event-source';

export type Health = HealthStatus | 'unknown';

/** What the sidebar and the status rail show for one mode. */
export interface ModeView {
  mode: Mode;
  health: Health;
  latencyMs: number | null;
  /** False while the backend answers this mode's requests with 503 MODE_UNAVAILABLE. */
  available: boolean;
  detail: string[];
  failoverReady?: boolean;
}

const EVENTS_KEPT = 300;

function unknownView(mode: Mode, why: string): ModeView {
  return { mode, health: 'unknown', latencyMs: null, available: false, detail: [why] };
}

function toView(mode: Mode, status: ModeStatus | undefined): ModeView {
  if (!status) return unknownView(mode, 'not in the backend’s SHOWCASE_MODES');
  if (!status.health) return unknownView(mode, 'not checked yet');
  const { health, sentinel, cluster } = status;
  const detail: string[] = [];
  if (health.error) detail.push(health.error);
  if (sentinel) {
    const quorum = sentinel.sentinels.filter((s) => s.quorumOk).length;
    detail.push(`master ${sentinel.master ?? 'unknown'}`);
    const answering = sentinel.sentinels.find((s) => !s.error);
    for (const r of answering?.replicas ?? []) detail.push(`replica ${r.address} link ${r.masterLinkStatus}`);
    detail.push(`quorum OK ${quorum}/${sentinel.sentinels.length}`);
  }
  if (cluster) {
    detail.push(`cluster_state ${cluster.state ?? 'unknown'}`);
    for (const r of cluster.slots) detail.push(`${r.master.split(':').pop()} slots ${r.start}-${r.end}`);
  }
  return {
    mode,
    health: health.status,
    latencyMs: health.latencyMs,
    available: status.available,
    detail,
    ...(sentinel && { failoverReady: sentinel.failoverReady }),
  };
}

export function useLive(initial: StatusResponse | null) {
  const [modes, setModes] = useState<ModeStatus[] | null>(initial?.modes ?? null);
  const [events, setEvents] = useState<EventLogEntry[]>([]); // newest first

  const stream: StreamState = useEventSource('/api/events', {
    // The backend replays its whole buffer on every connect, so a reconnect starts the list over.
    onOpen: () => setEvents([]),
    onMessage(data) {
      let event;
      try {
        event = ServerEventSchema.parse(JSON.parse(data));
      } catch (error) {
        console.warn('Skipped a malformed /api/events message', error);
        return;
      }
      if (event.type === 'status') setModes(event.modes);
      else setEvents((prev) => [event.entry, ...prev].slice(0, EVENTS_KEPT));
    },
  });

  const status = Object.fromEntries(
    MODES.map((mode) => [
      mode,
      stream === 'lost' || !modes ? unknownView(mode, 'backend not reachable') : toView(mode, modes.find((m) => m.mode === mode)),
    ]),
  ) as Record<Mode, ModeView>;
  return { status, events, stream };
}

export const formatLatency = (ms: number | null) => (ms === null ? '—' : `${ms < 10 ? ms.toFixed(1) : Math.round(ms)}ms`);

// Token classes only (see the showcase tokens in app/globals.css).
export const healthDot: Record<Health, string> = {
  healthy: 'bg-success', degraded: 'bg-warning', unhealthy: 'bg-destructive', unknown: 'bg-muted-foreground',
};
export const healthText: Record<Health, string> = {
  healthy: 'text-success', degraded: 'text-warning', unhealthy: 'text-destructive', unknown: 'text-muted-foreground',
};

export const REDIS_INSIGHT: Record<Mode, string> = {
  standalone: 'http://localhost:5542',
  sentinel: 'http://localhost:5541',
  cluster: 'http://localhost:5540',
};
export const redisCli = (mode: Mode) => `pnpm redis:${mode}`;
