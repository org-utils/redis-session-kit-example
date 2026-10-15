// A mode client's session metrics sink: in memory, one per mode, read by GET /api/<mode>/session/metrics. The package
// (1.1.2) only ever increments counters (`session.created`, `session.validate` with its result and reason, …), so
// observations and gauges are accepted and dropped.
import type { SessionMetricsSnapshot } from '@showcase/contracts';
import type { SessionMetrics } from 'ioredis-toolkit';

export interface SessionMetricsSink extends SessionMetrics {
  /** Every counter since the backend started, one per name and labels, in the order first reported. */
  snapshot(): SessionMetricsSnapshot;
}

export function createSessionMetrics(): SessionMetricsSink {
  const counters = new Map<string, { name: string; labels: Record<string, string>; value: number }>();
  return {
    increment(name, value = 1, labels = {}) {
      const id = JSON.stringify([name, labels]);
      const counter = counters.get(id) ?? { name, labels, value: 0 };
      counter.value += value;
      counters.set(id, counter);
    },
    observe() {},
    gauge() {},
    snapshot: () => ({ counters: [...counters.values()].map((c) => ({ ...c })) }),
  };
}
