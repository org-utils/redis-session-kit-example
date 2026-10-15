// Zod schemas shared by the backend and the frontend: the backend validates and serializes with them, the frontend
// parses responses and server-sent events with the same ones.
import { z } from 'zod';

export const MODES = ['standalone', 'sentinel', 'cluster'] as const;
export const ModeSchema = z.enum(MODES);
export type Mode = z.infer<typeof ModeSchema>;

/* ───────────── status: GET /api/status ───────────── */

export const HealthStatusSchema = z.enum(['healthy', 'degraded', 'unhealthy']);
export type HealthStatus = z.infer<typeof HealthStatusSchema>;

/** The package's `health()` result, as returned. */
export const RedisHealthSchema = z.object({
  status: HealthStatusSchema,
  latencyMs: z.number(),
  error: z.string().optional(),
  nodes: z
    .array(z.object({ address: z.string(), status: HealthStatusSchema, latencyMs: z.number(), error: z.string().optional() }))
    .optional(),
});

/** What each sentinel says about the monitored master, and whether a failover can succeed right now. */
export const SentinelStatusSchema = z.object({
  /** `host:port` of the current master, as the first sentinel that answers names it. */
  master: z.string().nullable(),
  sentinels: z.array(
    z.object({
      address: z.string(),
      /** `SENTINEL CKQUORUM`'s reply, or its error. */
      quorum: z.string(),
      /** Every configured sentinel is usable and the quorum can be reached. */
      quorumOk: z.boolean(),
      replicas: z.array(z.object({ address: z.string(), flags: z.string(), masterLinkStatus: z.string() })),
      error: z.string().optional(),
    }),
  ),
  /** Every sentinel reaches quorum and sees a replica up with its link to the master ok (upstream's Docker health check). */
  failoverReady: z.boolean(),
});
export type SentinelStatus = z.infer<typeof SentinelStatusSchema>;

export const ClusterStatusSchema = z.object({
  /** `cluster_state` from `CLUSTER INFO` on the first node that answers, or null if none does. */
  state: z.string().nullable(),
  slots: z.array(z.object({ start: z.number(), end: z.number(), master: z.string() })),
});
export type ClusterStatus = z.infer<typeof ClusterStatusSchema>;

export const ModeStatusSchema = z.object({
  mode: ModeSchema,
  /** The latest `health()`, or null before the first check. */
  health: RedisHealthSchema.nullable(),
  /** False while requests to this mode answer 503 MODE_UNAVAILABLE. */
  available: z.boolean(),
  checkedAt: z.number().nullable(),
  sentinel: SentinelStatusSchema.optional(),
  cluster: ClusterStatusSchema.optional(),
});
export type ModeStatus = z.infer<typeof ModeStatusSchema>;

/** Only the modes in the backend's SHOWCASE_MODES, in standalone, sentinel, cluster order. */
export const StatusResponseSchema = z.object({ modes: z.array(ModeStatusSchema) });
export type StatusResponse = z.infer<typeof StatusResponseSchema>;

/* ───────────── event log: GET /api/events ───────────── */

export const EventLogEntrySchema = z.object({
  id: z.number(),
  ts: z.number(),
  mode: ModeSchema,
  /** `error`: something a mode client reported through `onError`. `health`: the mode's health changed. */
  kind: z.enum(['error', 'health']),
  /** The `onError` source (`connection`, `subscriber`, …), or `health`. */
  source: z.string(),
  channel: z.string().optional(),
  message: z.string(),
});
export type EventLogEntry = z.infer<typeof EventLogEntrySchema>;

/* ───────────── Redis trace: every feature module response ───────────── */

/** A command the package sent while the request ran, as ioredis sent it, and the node (`host:port`) it went to. */
export const TracedCommandSchema = z.object({ name: z.string(), args: z.array(z.string()), node: z.string().nullable() });
export type TracedCommand = z.infer<typeof TracedCommandSchema>;

/** A key one of those commands touched, as it is after the request: its type (`none` once gone) and TTL. */
export const TracedKeySchema = z.object({
  key: z.string(),
  type: z.string(),
  /** Seconds left, or null when the key has no expiry or no longer exists. */
  ttl: z.number().nullable(),
  /** Cluster only: the key's hash slot and the master that owns it. */
  slot: z.number().optional(),
  node: z.string().optional(),
});
export type TracedKey = z.infer<typeof TracedKeySchema>;

export const RedisTraceSchema = z.object({
  commands: z.array(TracedCommandSchema),
  keys: z.array(TracedKeySchema),
  /** How many commands and keys were left out, when there were too many to show. */
  omitted: z.object({ commands: z.number(), keys: z.number() }).optional(),
});
export type RedisTrace = z.infer<typeof RedisTraceSchema>;

/** A 2xx from a feature module: the package's own result, untouched, and the Redis trace beside it. */
export const TracedResultSchema = z.object({ result: z.unknown(), redis: RedisTraceSchema });
export type TracedResult = z.infer<typeof TracedResultSchema>;

/* ───────────── cache: POST /api/:mode/cache/<operation> ───────────── */

// Only the shape is checked here: the package itself validates the values (a non-integer ttl, nx with xx…) and its
// CACHE_INPUT error is what the visitor should see.
export const CacheKeyRequestSchema = z.object({ key: z.string() });
export const CacheGetRequestSchema = z.object({
  key: z.string(),
  /** Call `getValue(key)` (the value, or null on a miss) instead of `get(key)`. */
  getValue: z.boolean().optional(),
});
export const CacheSetRequestSchema = z.object({
  key: z.string(),
  value: z.json(),
  ttl: z.number().optional(),
  nx: z.boolean().optional(),
  xx: z.boolean().optional(),
});
export const CacheSetIfAbsentRequestSchema = z.object({ key: z.string(), value: z.json(), ttl: z.number().optional() });
export const CacheDeleteRequestSchema = z.object({ keys: z.array(z.string()) });
export const CacheClearRequestSchema = z.object({ pattern: z.string().optional() });

/* ───────────── client: POST /api/:mode/client/<operation> ───────────── */

/** `health(options)` on the mode client. Blank fields fall back to the package's defaults (1000 ms, 100 ms). */
export const ClientHealthRequestSchema = z.object({ timeoutMs: z.number().optional(), degradedMs: z.number().optional() });

/** One raw command on the mode client, outside every namespace: keys are full Redis keys. */
export const ClientRawRequestSchema = z.discriminatedUnion('command', [
  z.object({ command: z.literal('mget'), keys: z.array(z.string()) }),
  z.object({ command: z.literal('exists'), keys: z.array(z.string()) }),
  /** One GET per key, in one pipeline. */
  z.object({ command: z.literal('pipeline'), keys: z.array(z.string()) }),
  z.object({ command: z.literal('eval'), script: z.string(), keys: z.array(z.string()), args: z.array(z.string()) }),
  // The cluster-safe ones: they group keys by slot, or scan every master.
  z.object({ command: z.literal('mgetClusterAware'), keys: z.array(z.string()) }),
  z.object({ command: z.literal('del'), keys: z.array(z.string()) }),
  z.object({ command: z.literal('scanCluster'), pattern: z.string() }),
  z.object({ command: z.literal('deletePatternClusterAware'), pattern: z.string() }),
]);

/* ───────────── errors: every non-2xx response ───────────── */

export const ErrorBodySchema = z.object({
  error: z.object({
    /** The package's code (`LOCK_HELD`, …), Redis's error word (`CROSSSLOT`, …), `MODE_UNAVAILABLE`, `NOT_FOUND`… */
    code: z.string(),
    name: z.string(),
    message: z.string(),
    /** The connection mode of the `/api/:mode` route that failed, or null when no such route matched (e.g. a 404). */
    mode: ModeSchema.nullable(),
  }),
  /** On a feature module's error: what the package sent before it failed. */
  redis: RedisTraceSchema.optional(),
});
export type ErrorBody = z.infer<typeof ErrorBodySchema>;

/* ───────────── server-sent events: GET /api/events ───────────── */

/**
 * One SSE `data:` payload. On connect: the current status, then every buffered entry (all modes, oldest first); then
 * live entries as they happen and a fresh status after every check (every 2 s).
 */
export const ServerEventSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('status'), modes: z.array(ModeStatusSchema) }),
  z.object({ type: z.literal('entry'), entry: EventLogEntrySchema }),
]);
export type ServerEvent = z.infer<typeof ServerEventSchema>;
