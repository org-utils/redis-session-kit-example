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
  /**
   * `error`: something a mode client reported through `onError`. `health`: the mode's health changed. `showcase`:
   * something the showcase noticed that the package does not report (a release inside `lock.using()` that found the
   * lease already gone).
   */
  kind: z.enum(['error', 'health', 'showcase']),
  /** The `onError` source (`connection`, `subscriber`, …), or `health`. */
  source: z.string(),
  /** The package's error code, when the error has one (`PUBSUB_SERIALIZATION`, …). */
  code: z.string().optional(),
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

/**
 * A 2xx from a feature module: the package's own result, untouched, and the Redis trace beside it. A response that sets
 * or clears a cookie also carries that `Set-Cookie` header's value, so the page can show what the browser was told.
 */
export const TracedResultSchema = z.object({ result: z.unknown(), redis: RedisTraceSchema, setCookie: z.string().optional() });
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

/**
 * A whole `createRedisClient` config, on a temporary client. Only the shape is checked here: the package validates it.
 * The backend adds `lazyConnect: true`, so a config the package accepts is closed before it connects anywhere.
 */
export const ClientValidateRequestSchema = z.object({ config: z.record(z.string(), z.json()) });

/** A temporary client on this mode with cache and sessions enabled under these namespaces. */
export const ClientCollideRequestSchema = z.object({ cache: z.string(), sessions: z.string() });

/** The `with*()` methods, and the config section each one changes. */
export const CLIENT_WITH_METHODS = {
  withCache: 'cache',
  withLock: 'lock',
  withRateLimit: 'rateLimit',
  withPubSub: 'pubsub',
  withStreams: 'streams',
  withSessions: 'sessions',
} as const;

/**
 * One `with*()` override on a temporary client configured like the mode client, optionally while a Pub/Sub subscription
 * is live. After `withCache`, the client also runs `cache.set` without a ttl and reads that ttl back.
 */
export const ClientWithRequestSchema = z.object({
  method: z.enum(Object.keys(CLIENT_WITH_METHODS) as [keyof typeof CLIENT_WITH_METHODS]),
  options: z.record(z.string(), z.json()),
  /** Pass `'replace'` instead of the default `'merge'`. */
  replace: z.boolean(),
  /** Subscribe first, so the override meets a live subscription. */
  whileSubscribed: z.boolean(),
});

/**
 * `close()` on a temporary client, optionally while it has a live subscription and a stream read blocked in Redis, then
 * what still works; `closeTwice` calls `close()` again at the end.
 */
export const ClientShutdownRequestSchema = z.object({ liveWork: z.boolean(), closeTwice: z.boolean() });

/** One call a temporary-client demo made, in order: what it returned (if anything), or what it threw. */
export const ClientStepSchema = z.discriminatedUnion('ok', [
  z.object({ call: z.string(), ok: z.literal(true), value: z.unknown().optional() }),
  z.object({
    call: z.string(),
    ok: z.literal(false),
    error: z.object({ code: z.string().optional(), name: z.string(), message: z.string() }),
  }),
]);
export type ClientStep = z.infer<typeof ClientStepSchema>;

/* ───────────── lock: POST /api/:mode/lock/<operation>, GET /api/:mode/lock/lease ───────────── */

// The package validates the ttl itself (LOCK_INPUT, LOCK_LIMIT); a blank ttl is left out, so its defaultTtl applies.
export const LockAcquireRequestSchema = z.object({ name: z.string(), ttl: z.number().optional() });
export const LockExtendRequestSchema = z.object({ name: z.string(), token: z.string(), ttl: z.number().optional() });
export const LockReleaseRequestSchema = z.object({ name: z.string(), token: z.string() });
export const LockUsingRequestSchema = z.object({
  name: z.string(),
  /** How long the callback works while holding the lock, in seconds. The request stays open meanwhile. */
  work: z.number().positive().max(60),
  ttl: z.number().optional(),
});

/** The lease as Redis holds it: native GET and PTTL on the lock key, not a package call. */
export const LockLeaseQuerySchema = z.object({ name: z.string() });
export const LockLeaseSchema = z.object({
  key: z.string(),
  /** The ownership token stored in the key, or null when nobody holds the lock. */
  token: z.string().nullable(),
  /** Milliseconds left on the lease, or null when nobody holds the lock. */
  ttlMs: z.number().nullable(),
});
export type LockLease = z.infer<typeof LockLeaseSchema>;

/* ───────────── rate limit: POST /api/:mode/rate-limit/<operation> ───────────── */

// The package validates the cost and subject itself (RATE_LIMIT_INPUT); a blank cost is left out, so it counts 1.
export const RateLimitConsumeRequestSchema = z.object({ subject: z.string(), cost: z.number().optional() });
export const RateLimitSubjectRequestSchema = z.object({ subject: z.string() });

/** The package's `consume()` / `check()` result, as returned. */
export const RateLimitResultSchema = z.object({
  allowed: z.boolean(),
  limit: z.number(),
  remaining: z.number(),
  /** Unix seconds, in Redis server time, when the window ends. */
  resetAt: z.number(),
  retryAfterSeconds: z.number(),
  count: z.number(),
});
export type RateLimitResult = z.infer<typeof RateLimitResultSchema>;

/* ───────────── pub/sub: POST /api/:mode/pubsub/<operation>, GET …/channels/:channel/stream ───────────── */

export const PubSubPublishRequestSchema = z.object({ channel: z.string(), message: z.json() });
/** A raw PUBLISH of any text to the namespaced channel, as something outside the package would send it. */
export const PubSubPublishRawRequestSchema = z.object({ channel: z.string(), message: z.string() });
export const PubSubChannelParamsSchema = z.object({ channel: z.string() });

/**
 * One SSE `data:` payload on a channel's stream (one subscription, one card). `subscribed` once Redis confirmed the
 * subscription; `message` per message the package delivered; `error` if subscribing failed (the stream then ends).
 */
export const PubSubStreamEventSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('subscribed'), channel: z.string() }),
  z.object({ type: z.literal('message'), channel: z.string(), value: z.unknown() }),
  z.object({ type: z.literal('error'), error: z.object({ code: z.string(), name: z.string(), message: z.string() }) }),
]);
export type PubSubStreamEvent = z.infer<typeof PubSubStreamEventSchema>;

/* ───────────── streams: POST /api/:mode/streams/<operation>, GET …/pending, GET …/:stream/follow ───────────── */

export const StreamsStreamRequestSchema = z.object({ stream: z.string() });
export const StreamsCreateGroupRequestSchema = z.object({ stream: z.string(), group: z.string(), start: z.string().optional() });
// The package checks the fields itself (STREAMS_INPUT when empty); a blank maxEntries keeps its default trim.
export const StreamsAddRequestSchema = z.object({
  stream: z.string(),
  fields: z.record(z.string(), z.string()),
  maxEntries: z.number().optional(),
});
/** A plain read, or a group read with `group` (and `consumer`: without one the package answers STREAMS_INPUT). */
export const StreamsReadRequestSchema = z.object({
  stream: z.string(),
  group: z.string().optional(),
  consumer: z.string().optional(),
  count: z.number().optional(),
  id: z.string().optional(),
});
export const StreamsAckRequestSchema = z.object({ stream: z.string(), group: z.string(), ids: z.array(z.string()) });
export const StreamsDeleteRequestSchema = z.object({ stream: z.string(), ids: z.array(z.string()) });

/** One entry as the package returns it. `fields` is empty for a pending entry deleted from the stream since delivery. */
export const StreamEntrySchema = z.object({ id: z.string(), fields: z.record(z.string(), z.string()) });
export type StreamEntry = z.infer<typeof StreamEntrySchema>;

/** Delivered-but-unacked entries per group and consumer, read with native XINFO and XPENDING: not part of the package. */
export const StreamsPendingSchema = z.object({
  groups: z.array(
    z.object({
      name: z.string(),
      consumers: z.array(
        z.object({
          name: z.string(),
          pending: z.array(z.object({ id: z.string(), idleMs: z.number(), deliveries: z.number() })),
        }),
      ),
    }),
  ),
});
export type StreamsPending = z.infer<typeof StreamsPendingSchema>;

/**
 * One SSE `data:` payload on a stream's follow pane, all fed by one shared read loop per stream. `following` on
 * connect (which loop, and how many listen to it); `listeners` when another one joins or leaves; `entries` as they are
 * added; `error` when a read failed (the loop retries).
 */
export const StreamsFollowEventSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('following'), stream: z.string(), loop: z.number(), listeners: z.number() }),
  z.object({ type: z.literal('listeners'), listeners: z.number() }),
  z.object({ type: z.literal('entries'), entries: z.array(StreamEntrySchema) }),
  z.object({ type: z.literal('error'), message: z.string() }),
]);
export type StreamsFollowEvent = z.infer<typeof StreamsFollowEventSchema>;

/* ───────────── session: POST /api/:mode/session/<operation>, GET …/cookie, …/stored, …/metrics ───────────── */

// The package validates the values itself (SESSION_INVALID for a missing securityVersion, a ttl over absoluteTimeout…).
const SessionMetadataSchema = z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()]));

/** A fake login: any user id, no password. IP address and user agent come from the request, as a real login's would. */
export const SessionCreateRequestSchema = z.object({
  userId: z.string(),
  deviceId: z.string().optional(),
  securityVersion: z.number().optional(),
  metadata: SessionMetadataSchema.optional(),
  /** Per-session overrides of the configured lifetimes, in seconds. */
  ttl: z.number().optional(),
  idleTimeout: z.number().optional(),
  absoluteTimeout: z.number().optional(),
});

/** A credential to present. Without `token`, the one in this mode's session cookie, as a real request would carry it. */
export const SessionTokenRequestSchema = z.object({ token: z.string().optional() });
export const SessionUpdateRequestSchema = z.object({
  token: z.string().optional(),
  /** Replaces the stored metadata as a whole. */
  metadata: SessionMetadataSchema,
  expectedVersion: z.number().optional(),
});

/** The user-level operations. The package validates the numbers itself (SESSION_INVALID for a version of 1.5…). */
export const SessionSecurityVersionRequestSchema = z.object({ userId: z.string(), version: z.number() });
export const SessionRevokeAllRequestSchema = z.object({ userId: z.string(), limit: z.number().optional() });
export const SessionListRequestSchema = z.object({
  userId: z.string(),
  offset: z.number().optional(),
  limit: z.number().optional(),
});

/** The session cookie this mode's request arrived with: what the browser holds, since it is HttpOnly. */
export const SessionCookieSchema = z.object({ name: z.string(), value: z.string().nullable() });
export type SessionCookie = z.infer<typeof SessionCookieSchema>;

/** A session record as Redis stores it, read with a native GET (not a package call): encrypted, so ciphertext. */
export const SessionStoredQuerySchema = z.object({ userId: z.string(), id: z.string() });
export const SessionStoredSchema = z.object({
  key: z.string(),
  /** The stored value as is, or null when the key is gone. */
  value: z.string().nullable(),
  /** Seconds left, or null when the key has no expiry or is gone. */
  ttl: z.number().nullable(),
});
export type SessionStored = z.infer<typeof SessionStoredSchema>;

/** The package's answer to validate() for a credential that cannot authenticate. */
export const SessionInvalidReasonSchema = z.enum([
  'not_found', 'expired', 'idle_timeout', 'absolute_timeout', 'revoked', 'consumed', 'invalid',
]);
export type SessionInvalidReason = z.infer<typeof SessionInvalidReasonSchema>;

/** A session record as the package stores it, decrypted: the fields the live table shows (the rest are kept as is). */
export const SessionRecordSchema = z.looseObject({
  id: z.string(),
  jti: z.string(),
  userId: z.string(),
  createdAt: z.number(),
  lastAccessedAt: z.number(),
  expiresAt: z.number(),
  idleExpiresAt: z.number().nullable(),
  absoluteExpiresAt: z.number().nullable(),
  status: z.enum(['active', 'consumed', 'revoked']),
  version: z.number(),
  securityVersion: z.number().nullable(),
  deviceId: z.string().optional(),
  /** The predecessor's jti, on a session rotation created. */
  rotatedFrom: z.string().optional(),
  /** On a consumed session: the successor it was consumed for. */
  successorId: z.string().optional(),
  successorJti: z.string().optional(),
});
export type SessionRecord = z.infer<typeof SessionRecordSchema>;

export const SessionRecordsQuerySchema = z.object({ userId: z.string() });
/**
 * The live table: every session record Redis holds for a user on this mode, tombstones included, read natively (SCAN of
 * the user's slot, then one read of it all at one instant) and decrypted with the showcase's key manager. Not a package
 * call: list() leaves out tombstones and anything expired.
 */
export const SessionRecordsSchema = z.object({
  userId: z.string(),
  /** Redis server time (seconds) of the read, which every expiry is measured against. */
  serverTime: z.number(),
  /** The user's stored security version, or null when none is stored. */
  securityVersion: z.number().nullable(),
  /** Oldest first. */
  sessions: z.array(z.object({
    key: z.string(),
    /** Seconds the key has left (a tombstone's countdown), or null without an expiry. */
    ttl: z.number().nullable(),
    /** Whether the user's session set holds it: only a member can authenticate, and rotate and revoke remove it. */
    inSessionSet: z.boolean(),
    /** The record decrypted, or null when it can't be. */
    session: SessionRecordSchema.nullable(),
    /** What validate() would answer for its credential at serverTime: null when it would be valid. */
    reason: SessionInvalidReasonSchema.nullable(),
  })),
});
export type SessionRecords = z.infer<typeof SessionRecordsSchema>;

/** What the package reported to this mode's metrics sink since the backend started, one entry per name and labels. */
export const SessionMetricsSnapshotSchema = z.object({
  counters: z.array(z.object({ name: z.string(), labels: z.record(z.string(), z.string()), value: z.number() })),
});
export type SessionMetricsSnapshot = z.infer<typeof SessionMetricsSnapshotSchema>;

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
