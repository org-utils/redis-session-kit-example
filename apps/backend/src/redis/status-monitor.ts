// Mode availability: a background job checks every mode every 2 s and caches the result. A mode answers 503
// MODE_UNAVAILABLE only after 3 unhealthy checks in a row, or if it has never been healthy, so a short failover stall
// still reaches the package instead of being cut off by the guard.
import type { ClusterStatus, Mode, ModeStatus, SentinelStatus } from '@showcase/contracts';
import type { RedisHealth } from 'ioredis-toolkit';
import type { EventLog } from './event-log.ts';

export interface ModeCheckResult {
  health: RedisHealth;
  sentinel?: SentinelStatus;
  cluster?: ClusterStatus;
}

/** One check of one mode. Must not throw: an unreachable Redis is reported as unhealthy. */
export type ModeCheck = () => Promise<ModeCheckResult>;

export interface StatusMonitor {
  /** Checks every mode once, in parallel. */
  refresh(): Promise<void>;
  start(): void;
  stop(): void;
  snapshot(): ModeStatus[];
  isAvailable(mode: Mode): boolean;
  /** Calls `listener` with a fresh snapshot after every refresh until the returned function is called. */
  subscribe(listener: (modes: ModeStatus[]) => void): () => void;
}

export const UNHEALTHY_CHECKS_BEFORE_UNAVAILABLE = 3;
const CHECK_INTERVAL_MS = 2000;

interface State {
  result: ModeCheckResult | null;
  checkedAt: number | null;
  everHealthy: boolean;
  unhealthyInARow: number;
}

export function createStatusMonitor({
  checks,
  eventLog,
}: {
  checks: Map<Mode, ModeCheck>;
  eventLog: EventLog;
}): StatusMonitor {
  const states = new Map<Mode, State>(
    [...checks.keys()].map((mode) => [mode, { result: null, checkedAt: null, everHealthy: false, unhealthyInARow: 0 }]),
  );
  const listeners = new Set<(modes: ModeStatus[]) => void>();
  let timer: NodeJS.Timeout | undefined;

  const available = (state: State) => state.everHealthy && state.unhealthyInARow < UNHEALTHY_CHECKS_BEFORE_UNAVAILABLE;

  async function refreshMode(mode: Mode, check: ModeCheck) {
    // A check is not meant to throw; if one does, it reads as unhealthy rather than stopping the background job.
    const result = await check().catch((error: unknown) => ({
      health: { status: 'unhealthy' as const, latencyMs: 0, error: error instanceof Error ? error.message : String(error) },
    }));
    const state = states.get(mode)!;
    const previous = state.result?.health.status;
    const { status, latencyMs, error } = result.health;
    if (status !== previous) {
      const change = previous ? `${previous} → ${status}` : status;
      const detail = error ?? `${latencyMs.toFixed(1)} ms`;
      eventLog.append(mode, { kind: 'health', source: 'health', message: `${change} (${detail})` });
    }
    const answered = status !== 'unhealthy';
    state.result = result;
    state.checkedAt = Date.now();
    state.everHealthy ||= answered;
    state.unhealthyInARow = answered ? 0 : state.unhealthyInARow + 1;
  }

  const monitor: StatusMonitor = {
    async refresh() {
      await Promise.all([...checks].map(([mode, check]) => refreshMode(mode, check)));
      const modes = monitor.snapshot();
      for (const listener of listeners) listener(modes);
    },
    start() {
      timer ??= setInterval(() => void monitor.refresh(), CHECK_INTERVAL_MS);
    },
    stop() {
      clearInterval(timer);
      timer = undefined;
    },
    snapshot: () =>
      [...states].map(([mode, state]) => ({
        mode,
        health: state.result?.health ?? null,
        available: available(state),
        checkedAt: state.checkedAt,
        ...(state.result?.sentinel && { sentinel: state.result.sentinel }),
        ...(state.result?.cluster && { cluster: state.result.cluster }),
      })),
    isAvailable: (mode) => {
      const state = states.get(mode);
      return !!state && available(state);
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
  return monitor;
}
