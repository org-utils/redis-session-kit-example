# What each ioredis-toolkit module does differently per connection mode

Research for issue #4 (map #2). Question: what is the full public surface of `ioredis-toolkit@1.0.11`, and how does each part behave on standalone, Sentinel and Cluster?

Researched 2026-10-15. Everything below is about `ioredis-toolkit@1.0.11` as published on npm, running on whatever ioredis `^5.6.1` resolves to today, which is **ioredis 5.11.1**.

## How to read this

Every claim cites one or more sources by key. The keys are listed in [Sources](#sources).

- **[T:...]** is the published tarball: the `.d.ts` files, the compiled `.js` that actually runs, and the README and docs shipped inside it. It is the authority for the public surface and for behaviour.
- **[S:...]** is the package repo at tag `v1.0.11`: ADRs, tests, `CONTEXT.md`. `src/` and the shipped docs at `main` are identical to `v1.0.11`. Only `docs/TESTING.md` and `docker/` changed since (commit `b029357`).
- **[I:...]** is ioredis 5.11.1: its README and `built/` source.
- **[R:...]** is the redis.io documentation.
- **[E:...]** is a live experiment I ran against the upstream Docker topologies (commit `b029357`, Redis 8). They are described under [Experiments](#experiments).

Two kinds of claim get a marker:

- **(inferred)** means I read it from the code, but no test or experiment exercised it.
- **(unverified)** means I could not confirm it.

Vocabulary follows map #2 (connection mode, feature module) and the package's own `CONTEXT.md` (namespace, user's session set, token locator, rotation, successor, consumed, tombstone) [S:CONTEXT].

---

## Headline findings

1. **`safeUserTag` and `isCluster` are not public in 1.0.11.** No import path exports them, and nor does `redisHashSlot` or `assertSameSlot`. They were removed from the root in 1.0.1 (ADR-0003). Importing them from `ioredis-toolkit` gives `undefined` at runtime. [T:dist/index.d.ts, T:README "Import paths", T:CHANGELOG 1.0.1, S:adr/0003, E:probe]
2. **There is no sharded Pub/Sub.** The Pub/Sub module only uses `PUBLISH`/`SUBSCRIBE` and only listens for `'message'`. Passing ioredis's `shardedSubscribers: true` through the Cluster config changes nothing for the module. [T:dist/pubsub/pubsub.js, E:cluster2]
3. **The modules' own operations are designed to be Cluster-safe.** Every Lua script and multi-key step a module sends stays within one hash slot, and the cross-slot work goes through the kernel's slot-grouping fan-out. **The raw commands on `RedisClient` are not Cluster-safe**: `mget`, `exists`, `eval` with keys in different slots, and `pipeline()` across slots all fail on Cluster. `del`, `mgetClusterAware`, `scanCluster` and `deletePatternClusterAware` are the exceptions. [T:dist/redis/wrapper.js, E:probe]
4. **A Sentinel failover is handled entirely by ioredis.** The package has no Sentinel tests at all [S:docs/TESTING.md].
   - A graceful `SENTINEL FAILOVER` was invisible to every module: 0 failed calls, 0 `onError` events, a blocked stream read carried over, and the lock kept.
   - A crash failover stalled calls for up to 2.3 s, failed none of them, and produced `onError` noise from all three connection kinds.
   - A crash while the replica was still resyncing **lost the lock, the session and the consumer group**. A second caller then acquired the "held" lock. [E:failover]
5. **The upstream Cluster compose has no replicas** (3 masters, `--cluster-replicas 0`). Cluster failover (`CLUSTER FAILOVER`) cannot be demonstrated against it, and the package has no tests for Cluster failover, MOVED/ASK, resharding or node loss. [S:docker/cluster.compose.yml, S:docs/TESTING.md]

---

## 1. Public surface, module by module

### 1.1 Import paths

Only these paths are importable, plus `ioredis-toolkit/package.json`. A file inside `dist/` cannot be imported. [T:package.json exports, T:README "Import paths"]

| Path | Exports |
| --- | --- |
| `ioredis-toolkit` | `createRedisClient`, `RedisClient`, `createRedisConnection`, `parseRedisConnectionConfig`, `RedisToolkitError`, `RedisConfigurationError`, and everything the subpaths below export. Types: `RedisClientConfig`, `RedisClientDependencies`, `RedisErrorContext`, `RedisErrorSource`, `ModuleConfigMode`, `RedisConfig`, `RedisMode`, `StandaloneRedisConfig`, `SentinelRedisConfig`, `ClusterRedisConfig`, `RedisConnection`, `RedisCommandClient`, `RedisPipeline`, `ClusterFanoutOptions`, `ModuleConfigBase` [T:dist/index.d.ts] |
| `ioredis-toolkit/session` | `SessionManager`, `createSessionManager`, `createSessionManagerFromRedis`, `parseSessionConfig`, `serializeCookie`, `serializeDeletionCookie`, the 13 `Session*Error` classes, the session types, and `RedisConfig` [T:dist/session/index.d.ts] |
| `ioredis-toolkit/cache` | `RedisCache`, `parseCacheConfig`, `CacheError`, and types `CacheConfig`, `CacheSetOptions`, `CacheResult`, `CacheErrorCode` |
| `ioredis-toolkit/lock` | `RedisLock`, `parseLockConfig`, `LockError`, and types `LockConfig`, `LockAcquireResult`, `LockErrorCode` |
| `ioredis-toolkit/rate-limit` | `RedisRateLimiter`, `parseRateLimitConfig`, `RateLimitError`, and types `RateLimitConfig`, `RateLimitResult`, `RateLimitErrorCode` |
| `ioredis-toolkit/pubsub` | `RedisPubSub`, `parsePubSubConfig`, `PubSubError`, and types `PubSubConfig`, `PubSubMessage`, `Subscription`, `PubSubErrorCode` |
| `ioredis-toolkit/streams` | `RedisStreams`, `parseStreamsConfig`, `StreamsError`, and types `StreamsConfig`, `StreamEntry`, `StreamReadOptions`, `StreamsErrorCode` |

**Internal, not importable:** the kernel helpers `safeUserTag`, `isCluster`, `redisHashSlot`, `assertSameSlot`, `KeyStrategy`, `ScriptRegistry`, `RedisClock` and `RedisClientWrapper` (the wrapper is not exported by name). Also internal are the session internals (repository, service, serializer, key strategy, token manager, script registry), `SessionHealthProvider`, `RedisRevocationStore`, `NoopMetrics`, and every `*ConfigSchema`. [T:dist/redis/index.d.ts header comment, T:README, T:CHANGELOG 1.0.1, S:adr/0003, S:CONTEXT "Entry point"]

The module classes are exported, but constructing one directly is unsupported. Modules come from `createRedisClient` or a session factory. [T:README, S:adr/0003]

### 1.2 Client facade: `createRedisClient(config, dependencies?)` → `RedisClient`

[T:dist/client-facade.d.ts, T:dist/client-facade.js, T:README]

| Member | Notes |
| --- | --- |
| `createRedisClient(config, deps?)` | Validates the connection config (`parseRedisConnectionConfig`), every module section, and namespace overlap **before** connecting. A bad config throws and leaves no connection behind. |
| `RedisClientConfig` | `RedisConfig & { cache?, lock?, rateLimit?, pubsub?, streams?, sessions? }`. Each section is a `Partial<...Config>`. |
| `RedisClientDependencies` | `encryptionKeyManager?: KeyManager`, `metrics?: SessionMetrics`, `onError?(error, { source, channel? })`. |
| `RedisErrorSource` | `'connection' \| 'subscriber' \| 'stream-reader' \| 'pubsub-handler' \| 'lock-release'`. |
| Getters `cache`, `lock`, `rateLimiter`, `pubsub`, `streams`, `sessions` | Each creates its module lazily. A disabled module throws `RedisConfigurationError`; disabled sessions throw `SessionConfigurationError`. |
| `withCache`, `withLock` (alias `withlock`), `withRateLimit`, `withPubSub`, `withStreams`, `withSessions` (alias `withSession`) | Signature `(options?, mode: 'merge' \| 'replace' = 'merge') => this`. `'replace'` resets every option not given, `enabled: false` included. Re-checks namespace overlap and throws `RedisConfigurationError`, keeping the old config. Builds a fresh module instance. `withPubSub` throws `PubSubError` `PUBSUB_STATE` while a subscription is live or in flight, and otherwise closes the old subscriber. `withSessions` drops the manager, which is rebuilt on the next access. |
| `close()` | Closes the shared connection, every Pub/Sub subscriber (including ones retired by `withPubSub`), and every stream reader. Idempotent. A connection that is up is quit; any other is disconnected. Stream readers are always disconnected. |
| `config` | The normalized module configs in effect. |
| Raw `RedisCommandClient` methods | `get, set, setnx, del, exists, expire, pexpire, ttl, zadd, zrem, zcard, zscore, zrange, zrangebyscore, zpopmin, incrby, decrby, evalsha, eval, script('LOAD'), time, ping, scan, publish, xadd, xgroup('CREATE'), xread, xreadgroup, xack, xdel, xlen, pipeline, mget, duplicateConnection, mgetClusterAware, scanCluster, deletePatternClusterAware`. They run on the shared connection, outside every namespace and validation. [T:dist/redis/types.d.ts, T:README] |

**Namespace rules.** Each namespace matches `[A-Za-z0-9:_-]{1,128}`, so no hash tag and no glob. Two enabled modules collide when the namespaces are equal or one is a `:`-prefix of the other. The defaults are `cache`, `lock`, `rate-limit`, `events` (Pub/Sub), `stream`, and `app` (sessions). [T:dist/redis/config-base.js, T:dist/client-facade.js, T:README]

### 1.3 Connection layer and errors

| Name | Notes |
| --- | --- |
| `createRedisConnection(config)` | Returns an ioredis connection for the mode: `new Redis(opts)` for standalone, `new Redis({...opts, sentinels, name})` for Sentinel, `new Cluster(nodes, opts)` for Cluster. It attaches a no-op `'error'` listener, and **does not** validate the config. [T:dist/redis/client.js] |
| `parseRedisConnectionConfig(input)` | A discriminated union on `mode`; an omitted `mode` means standalone. Unknown ioredis options pass through. Standalone defaults: `host` 127.0.0.1, `port` 6379, `db` 0. Sentinel requires at least one entry in `sentinels[{host,port}]` and a `name`, and defaults `db` to 0. Cluster requires at least one entry in `nodes`, each a `"host:port"` string, a bare port, or `{host?,port?}`, plus optional `redisOptions`. Failures throw `RedisConfigurationError`. [T:dist/redis/config.js] |
| `RedisToolkitError` | The base of every package error, carrying a stable `code`. [T:dist/redis/errors.d.ts] |
| `RedisConfigurationError` | Code `REDIS_CONFIGURATION`. Thrown for a bad connection config, colliding namespaces, or a non-session module used while disabled. |
| `ModuleConfigBase` | `{ enabled: boolean (default false), namespace: string }`. |
| `ClusterFanoutOptions` | `{ concurrency? }`. The default is 4 for `mgetClusterAware`/`del` and 2 for the per-master scans. [T:dist/redis/wrapper.js] |

### 1.4 Cache: `RedisCache`

[T:dist/cache/*.d.ts, T:dist/cache/cache.js, T:docs/modules/cache/usage.md]

| Kind | Surface |
| --- | --- |
| Config | `enabled` (false), `namespace` (`cache`), `defaultTtl` (300 s, positive integer), `maxValueBytes` (1 MiB, at most 16 MiB). |
| Methods | `key(k)` → `ns:k`<br>`get<T>(k)` → `{hit, value}`<br>`getValue<T>(k)`<br>`set<T>(k, v, {ttl?, nx?, xx?})` → `boolean`. Always `SET ... EX`, so every key expires.<br>`setIfAbsent(k, v, ttl?)`<br>`has(k)`<br>`ttl(k)`<br>`delete(...keys)` → `number`<br>`del(k)`<br>`clear(pattern = '*')` → number deleted. |
| Errors (`CacheError`) | `CACHE_CONFIGURATION`, `CACHE_INPUT` (nx and xx together, or a bad ttl), `CACHE_SERIALIZATION` (unencodable on write, non-JSON on read), `CACHE_LIMIT`. Redis and connection errors pass through raw. |
| Metrics | None. |

### 1.5 Lock: `RedisLock`

[T:dist/lock/*, T:docs/modules/lock/usage.md]

| Kind | Surface |
| --- | --- |
| Config | `enabled`, `namespace` (`lock`), `defaultTtl` (30 s), `maxTtl` (300 s). A `defaultTtl` above `maxTtl` is rejected at parse time. |
| Methods | `key(name)`<br>`acquire(name, ttl?)` → `{acquired, token}`. Sends `SET key token PX ms NX`. The token is 32 random bytes in base64url and is returned even when `acquired` is false.<br>`release(name, token)` → `boolean`. Lua compare-and-delete.<br>`extend(name, token, ttl?)` → `boolean`. Lua compare-and-`PEXPIRE`; it **resets** the lease rather than adding to it.<br>`using(name, fn, ttl?)`. A failed release goes to `onError` with source `lock-release`. |
| TTL | Seconds. May be fractional, down to whole milliseconds. |
| Errors (`LockError`) | `LOCK_CONFIGURATION`, `LOCK_INPUT`, `LOCK_LIMIT` (over `maxTtl`), `LOCK_HELD` (`using()` only). |
| Semantics | A single-node lease. Not Redlock, and no fencing token. The docs say a failover can briefly allow two holders. [T:docs/modules/lock/usage.md "Important semantics"] |

### 1.6 Rate limit: `RedisRateLimiter`

[T:dist/rate-limit/*, T:docs/modules/rate-limit/usage.md]

| Kind | Surface |
| --- | --- |
| Config | `enabled`, `namespace` (`rate-limit`), `windowSeconds` (60, at most 86400), `maxRequests` (100, at most 1e7). |
| Methods | `key(subject)` → `ns:{subject}`. The subject is the hash tag. The two-argument `key(subject, serverSeconds)` is deprecated and ignores its second argument.<br>`consume(subject, cost = 1)`<br>`check(subject)`<br>`reset(subject)` → `boolean`. |
| Result | `{allowed, limit, remaining, resetAt, retryAfterSeconds, count}`. `consume` allows when `count <= max`; `check` allows when `count < max`. |
| Storage | One hash per subject, `{window, count}`. Both scripts call `TIME` themselves, so each call is one round trip. |
| Errors (`RateLimitError`) | `RATE_LIMIT_CONFIGURATION`, `RATE_LIMIT_INPUT` (a cost that is not a positive integer, or a subject that is empty or starts with `}`). A denied request is not an error. |

### 1.7 Pub/Sub: `RedisPubSub`

[T:dist/pubsub/*, T:docs/modules/pubsub/usage.md]

| Kind | Surface |
| --- | --- |
| Config | `enabled`, `namespace` (`events`), `maxMessageBytes` (1 MiB, at most 16 MiB). |
| Methods | `publish<T>(channel, value)` → the subscriber count Redis reports.<br>`subscribe<T>(channel, handler)` → `Subscription {channel, unsubscribe()}`. Resolves once Redis confirms. Concurrent subscribes to one channel share one `SUBSCRIBE`, and the physical `UNSUBSCRIBE` goes out with the last handler.<br>`fullChannel(channel)` → `ns:channel`<br>`close()`. |
| Message | `PubSubMessage<T> {channel (logical), value}`. A handler that throws or rejects is reported as `pubsub-handler` with its channel. A non-JSON message is reported once as `PUBSUB_SERIALIZATION` and dropped. |
| Errors (`PubSubError`) | `PUBSUB_CONFIGURATION`, `PUBSUB_SERIALIZATION`, `PUBSUB_LIMIT`, `PUBSUB_STATE` (`withPubSub` while live). |
| Connection | A dedicated subscriber (`duplicate()` of the shared connection), opened by the first `subscribe`. Publishing alone never opens it. |

### 1.8 Streams: `RedisStreams`

[T:dist/streams/*, T:docs/modules/streams/usage.md]

| Kind | Surface |
| --- | --- |
| Config | `enabled`, `namespace` (`stream`), `maxEntries` (100000, at most 1e7), `blockMs` (5000, 0 to 300000; 0 blocks forever). |
| Methods | `key(name)`<br>`add(name, fields, maxEntries?)`. Sends `XADD key MAXLEN ~ n * ...`; an empty field map throws `STREAMS_INPUT`.<br>`createGroup(name, group, startId = '$', mkStream = true)`. `BUSYGROUP` counts as success.<br>`read(name, {group?, consumer?, count = 100, blockMs?, id?})` → `StreamEntry[]`. `id` defaults to `>` for a group read and `$` for a plain one.<br>`ack(name, group, ...ids)`<br>`delete(name, ...ids)`<br>`length(name)`<br>`close()`. |
| Reads | Always `BLOCK`. Each read leases its own connection from a pool of duplicates of the shared connection; the pool grows to the peak number of concurrent reads. Every Streams module on one client shares the pool. A pending entry deleted after delivery comes back with empty `fields`. |
| Errors (`StreamsError`) | `STREAMS_CONFIGURATION`, `STREAMS_INPUT` (`group` without `consumer`, or no fields). Redis errors such as `NOGROUP` pass through raw. |
| Not provided | `XPENDING`, `XCLAIM`/`XAUTOCLAIM`, `XINFO`, multi-stream reads. The docs leave pending-entry recovery to native commands. |

### 1.9 Sessions: `SessionManager`

[T:dist/session/*, T:docs/modules/sessions/usage.md, T:docs/STATE-MACHINE.md]

| Kind | Surface |
| --- | --- |
| Factories | `redis.sessions` (facade).<br>`createSessionManager({redis, config, encryptionKeyManager?, metrics?})`.<br>`createSessionManagerFromRedis(redisConfig, sessionConfig)` → `{manager, redis, config}`. This one takes no key manager, so it refuses encryption, and it gives **no `onError` forwarding**: the connection only has the no-op listener. [T:dist/session/factory.js] |
| Config | `enabled`, `namespace` (`app`), `tokenBytes` (32, 32 to 128), `ttl` (30 d), `idleTimeout?`, `absoluteTimeout?`, `touchInterval` (60), `rolling` (true), `securityVersionEnabled` (false), `maxSessionsPerUser` (20, 0 means unlimited, at most 1000), `maxMetadataBytes` (8 KiB, at most 64 KiB), `maxBatchSize` (200), `maxConcurrency` (8, at most 64), `storeIpAddress`/`storeUserAgent`/`storeDeviceId` (false), `encryption.enabled` (false), `cookie {name 'session', httpOnly true, secure true, sameSite 'lax', domain?, path '/', maxAge?}`, and `circuitBreaker` (deprecated, no effect). [T:dist/session/config.js] |
| Methods | `create(input)` → `{token, session}`<br>`validate(token)` → `{valid:true, session} \| {valid:false, reason}`<br>`get`, `touch`, `update(token, patch, expectedVersion?)`, `rotate(token)` → `{token, session, previousJti}`<br>`destroy`, `revoke`, `setSecurityVersion(userId, v)`<br>`revokeAll(userId, limit?)` → `{affected, remaining}`<br>`list(userId, offset?, limit?)`<br>`cookie(token, session)` (async)<br>`deletionCookie()`. |
| `InvalidReason` | `not_found`, `expired`, `idle_timeout`, `absolute_timeout`, `revoked`, `consumed`, `invalid`. |
| Errors | `SessionError` and its subclasses `SessionNotFoundError`, `SessionExpiredError`, `SessionRevokedError`, `SessionInvalidError`, `SessionReplayError`, `SessionRotationError`, `SessionConflictError`, `SessionStorageError`, `SessionSerializationError`, `SessionConfigurationError`, `SessionInputError`, `SessionLimitError`. Codes `SESSION_NOT_FOUND`, `SESSION_EXPIRED`, `SESSION_REVOKED`, `SESSION_INVALID`, `SESSION_REPLAY`, `SESSION_ROTATION`, `SESSION_CONFLICT`, `SESSION_STORAGE`, `SESSION_SERIALIZATION`, `SESSION_CONFIGURATION`, `SESSION_INPUT`, `SESSION_LIMIT`. Redis and connection failures are wrapped as `SESSION_STORAGE`, except in `list()` and in parts of `revokeAll()`, which pass them through raw. [T:README "Errors", T:dist/session/errors.d.ts] |
| Metrics (`SessionMetrics.increment/observe/gauge`) | Only `increment` is called: `session.created`, `session.validate` (`{result:'valid'}` or `{result:'invalid', reason}`, recorded by `get`/`touch`/`update`/`rotate` too), `session.rotated`, `session.revoked`, `session.destroyed`. No other module emits metrics. [T:dist/session/service.js, T:docs/modules/sessions/usage.md "Metrics"] |
| Cookie helpers | `serializeCookie(value, CookieOptions)` and `serializeDeletionCookie(CookieOptions)`. They throw `SessionInputError` for a bad name, `;`/whitespace/control characters in Domain or Path, or SameSite=None without Secure. [T:dist/session/cookie.js] |
| Keys | Record `ns:session:{U}:H`, user's session set `ns:user-sessions:{U}`, security version `ns:security-version:{U}`, token locator `ns:token-index:H`. `U` is the 64-hex SHA-256 of the userId and `H` is the SHA-256 of the token. [T:dist/session/keys.js, E:probe] |

---

## 2. Per-mode behaviour matrix

"Same" means the code path is identical and only the server differs.

### 2.1 Connections and kernel

| Aspect | Standalone | Sentinel | Cluster |
| --- | --- | --- | --- |
| Shared connection | One `Redis`. [T:dist/redis/client.js] | One `Redis` that resolves the master through the sentinels and checks its `ROLE`. [I:README "Sentinel", R:sentinel-clients] | One `Cluster`. It loads the slot map and opens node connections lazily. [I:built/cluster/index.js] |
| Mode-specific options | `host`, `port`, `db`, any `RedisOptions`. | `sentinels`, `name`, `db`, and passthrough `RedisOptions` (`sentinelPassword`, `role`, `preferredSlaves`, `failoverDetector`, `natMap`, …). [T:dist/redis/config.js, I:README] | `nodes`, `redisOptions`, and passthrough `ClusterOptions` (`scaleReads`, `natMap`, `shardedSubscribers`, `maxRedirections`, …). **No `db`.** [T:dist/redis/config.js, I:built/cluster/ClusterOptions.js] |
| `duplicateConnection()`, used for the subscriber and each stream reader | A new `Redis` to the same server. | A new `Redis` that resolves the master **on its own**, so each duplicate fails over independently. [E:failover, where each source logged its own errors] | A **whole new `Cluster`** with its own slot map and node pool. [I:built/cluster/index.js `duplicate`] Measured: +2 client connections for the subscriber, +4 for three concurrent stream reads. [E:cluster2] |
| `onError` forwarding | `'error'` on each connection. | Same, plus ioredis's Sentinel errors such as `All sentinels are unreachable. Retrying from scratch after 10ms.` during a failover. [E:failover] | `'error'` and `'node error'` (per node), both under the same source. [T:dist/redis/lifecycle.js] |
| `time()` / `RedisClock` | The server. | The current master. After a failover that is the new master's clock (inferred). | A keyless command, so it goes to a **random master**. [I:built/cluster/index.js `getSampleInstance`] |
| Raw `mget`, `exists`, `eval` (multi-key) | Work. | Work. | Throw `CROSSSLOT` across slots. Work within one slot. [E:probe] |
| Raw `pipeline()` | Works. | Works. | Throws `All keys in the pipeline should belong to the same slots allocation group` across nodes. [E:probe, I:README "Transaction and Pipeline in Cluster Mode"] |
| Raw `del(...keys)` | `DEL` in batches of 500. | Same. | Grouped by slot, 4 groups at a time, 500 per batch. [T:dist/redis/wrapper.js, E:probe] |
| `mgetClusterAware` | A plain `MGET`. | Same. | Grouped by slot, concurrency 4 or as given, input order kept. [T:dist/redis/wrapper.js, E:probe] |
| `scanCluster` / `deletePatternClusterAware` | `SCAN` on the one server. | Same, on the master. | `SCAN` on every master in `nodes('master')` (snapshotted at the start), 2 at a time. Deletes go through a per-node pipeline of per-slot `DEL`s; a failed `DEL` (for example MOVED) is retried through the cluster. Pings first if the slot map is empty. [T:dist/redis/wrapper.js] |
| `ScriptRegistry` (Lua by SHA) | `EVALSHA`, falling back to `EVAL` on `NOSCRIPT`. | Same. The script cache does not survive a failover, so the first call on the new master is answered `NOSCRIPT` and recovers. [T:dist/redis/scripts.js, R:eval-intro "Cache volatility"] I did not observe the `NOSCRIPT` itself; scripts kept working after failover. [E:failover] | Same, per node. |
| After `close()`, `pubsub.subscribe()` | Rejects `Connection is closed.` | Same (inferred). | Rejects **`None of startup nodes is available`**, not the `Connection is closed.` the README promises. [E:probe, T:README "Shutdown"] |

### 2.2 Feature modules

| Module / operation | Standalone | Sentinel | Cluster |
| --- | --- | --- | --- |
| **cache** get/set/has/ttl/setIfAbsent | One key. | Same, on the master. | Routed by key slot. The cache adds no hash tag, but a `{…}` inside the logical key picks the slot (inferred from [T:dist/redis/keys.js] and the Redis Cluster spec). |
| **cache.delete(...keys)** | Batched `DEL`. | Same. | Slot-grouped `DEL`. Three cross-slot keys deleted. [E:probe] |
| **cache.clear(pattern)** | `SCAN MATCH ns:pattern COUNT 500`, deleting each page as it comes. | Same. A failover mid-scan resends the `SCAN` with the old cursor to the new master, so keys may be missed or counted twice (unverified). | Scans **every master** and deletes per node. Same counts in all three modes (110, then 87). [E:probe, T:CHANGELOG 1.0.4] A master that is lost or a slot that migrates mid-clear is untested upstream (unverified). |
| **lock** acquire/release/extend/using | One key: `SET NX PX` plus a one-key Lua. | Same. A lease written but not yet replicated when the master crashes is lost, and a second caller acquires it. [T:docs/modules/lock/usage.md, E:failover crash during resync] Survived a graceful failover and a steady-state crash. [E:failover] | Same, on the lock key's slot. No cross-node coordination (not Redlock). |
| **rateLimiter** consume/check/reset | One key `ns:{subject}`; `TIME` inside the script. | Same. After a failover, windows are bucketed by the new master's clock (inferred). Counts written but not yet replicated can be lost (inferred). | Same. The clock is the **node that owns the subject's slot**, so node clocks must agree. [T:docs/modules/rate-limit/usage.md "Clock"] |
| **pubsub.publish** | Returns the server's subscriber count. | Same. | A keyless `PUBLISH` goes to a random master. The count covers **only that node's subscribers**: counts came back `[1,0,1,0,1,1]` while all 6 messages were delivered. [E:probe, T:docs/modules/pubsub/usage.md] |
| **pubsub.subscribe** | `SUBSCRIBE` on the duplicate. | Same. After a reconnect, ioredis resubscribes (`autoResubscribe`). [I:README "Auto-reconnect"] | A classic `SUBSCRIBE` on one random node (any role), picked by ioredis's `ClusterSubscriber`. The cluster bus delivers from every node. If that node goes away, ioredis picks another and resubscribes. [I:built/cluster/ClusterSubscriber.js, I:README "Pub/Sub"] Node loss was not tested (unverified). **No `SSUBSCRIBE`/`SPUBLISH`.** |
| **streams** add/createGroup/ack/delete/length | One key. | Same. | One stream (with its groups and pending entries) lives on **one slot and one node**. The group flow worked unchanged. [E:probe] |
| **streams.read** | Leased duplicate `Redis`; `BLOCK`. | Leased duplicate that resolves the master itself. A blocked read in flight during a failover is **resent to the new master** and resolved with an entry added afterwards. [E:failover, I:README `autoResendUnfulfilledCommands`] | Leased duplicate `Cluster` per concurrent read. [E:cluster2] |
| **sessions** key placement | All one server. | All on the master. | The record, session set and security version share the user's slot `{sha256(userId)}`. Each token locator lands in its own slot. [T:docs/ARCHITECTURE.md, S:tests/integration/session.integration.test.ts, E:probe] |
| **sessions.create** | A same-slot Lua `create_session`, then a separate `SET NX` for the locator. | Same. | The same two steps, but the second goes to another node. The Lua also touches **undeclared** keys in the same slot (`PTTL`/`DEL` of evicted records). Redis allows that for scripts without a `#!` line, but it is outside the documented KEYS contract. Eviction worked on Redis 8 Cluster. [T:dist/session/script-sources.js, R:eval-intro, E:probe] |
| **sessions.validate/get/touch** | 2 round trips: `GET` the locator, then a read-only Lua that also reads `TIME`. | Same. | Locator on one node, record on the user's node. `TIME` comes from the user's node. [T:dist/session/repository.js] |
| **sessions.rotate** | Consume (same-slot compare-and-set), `ZREM`, `EXPIRE` the locator, then create the successor. | Same. | The successor's record is in the same user slot; its locator is elsewhere. Two-phase, so a failure after consume gives `SESSION_ROTATION`. [T:docs/STATE-MACHINE.md] |
| **sessions.revokeAll** | Locator `DEL`, then one pipeline. | Same. | Locators deleted slot-grouped first, then one **same-slot** pipeline. Fixed for Cluster in 1.0.4, with locators-first ordering since 1.0.5. [T:CHANGELOG 1.0.4, E:probe] |
| **sessions.list** | `ZRANGE` + `MGET`. | Same. | `mgetClusterAware`; all keys share one slot, so one `MGET`. |
| **sessions** clock | One server. | The master. | `create`/`rotate`/`revoke`/`list`/`cookie` read `TIME` from a **random master** (`RedisClock`), while validation reads the user's node. Expiry decisions mix node clocks (inferred from [T:dist/session/service.js]). |

### 2.3 What a Sentinel failover looks like to each module

The experiment kept a loop running while it triggered a failover: `cache.set` → `rateLimiter.consume` → `sessions.validate` → `pubsub.publish`, every 50 ms. It also held a 120 s lock, had a live subscription, and had a `streams.read` group read blocked with `blockMs: 0`. [E:failover]

| | Graceful `SENTINEL FAILOVER mymaster` | Crash (`kill` master), replica in sync | Crash 3 s into the replica's full resync |
| --- | --- | --- | --- |
| Loop calls failed | 0 of 413 | 0 of 370 | 0 thrown, but every `validate` after the failover returned `not_found` |
| Worst call latency | 23 ms | 2338 ms (commands queued, then flushed to the new master) | ~1.5 s |
| `onError` | Nothing at all | 33 events: `connection`, `subscriber` and `stream-reader` each logged `write EPIPE`, `read ECONNRESET` and `All sentinels are unreachable. Retrying from scratch after 10ms.` | Same kinds |
| Lock held across the failover | Kept; second acquire refused; release with the token succeeded | Kept | **Lost**: second acquire succeeded (two holders), release with the original token returned `false` |
| Session | Valid | Valid | **Gone** (`not_found`, so the user is logged out) |
| Subscriber | Resubscribed; no gaps | Resubscribed; no gaps | Same |
| Blocked `streams.read` | Resent; resolved with the post-failover entry | Same | **Rejected `NOGROUP`**: the group was never replicated |

Takeaways for the showcase:

- A graceful Sentinel failover produces **no event the app can see** through the toolkit. To show it, watch Sentinel itself, for example poll `SENTINEL get-master-addr-by-name` or subscribe to `+switch-master` [R:sentinel-clients].
- Sentinel kills normal clients on reconfigured instances with `CLIENT KILL type normal`, which forces the reconnect. [R:sentinel-clients]
- ioredis queues commands sent during a failover and resends in-flight ones (`autoResendUnfulfilledCommands`, `enableOfflineQueue`). After 20 reconnect attempts (`maxRetriesPerRequest`), queued commands are flushed with an error. [I:README "Auto-reconnect", I:built/redis/event_handler.js]
- The resend means a non-idempotent call whose reply was lost could run twice (inferred, unverified):
  - `rateLimiter.consume` would double-count.
  - `streams.add` would append twice.
  - `lock.acquire`'s `SET NX` would see its own key and report `acquired: false` while the lock is in fact held.
  - `create_session` would return -1 and surface as `SESSION_STORAGE`.
- No gaps appeared in the pub/sub sequence only because the publisher stalled on the same outage. Messages from a publisher on a healthy connection, sent while the subscriber is reconnecting, are lost: Pub/Sub is at-most-once. [R:pubsub "Delivery semantics"]
- The data loss in column 3 is Redis's asynchronous replication [T:docs/modules/lock/usage.md]. My fail-back failover had started a full resync, and the diskless-sync delay was still running when the kill landed (replica log in [E:failover]). In steady state, nothing was lost.

### 2.4 Cluster topology changes

**(unverified)** None of these could be tested: the upstream cluster has no replicas, and the package has no tests for them [S:docs/TESTING.md "Not yet written"]. From ioredis 5.11.1 [I:built/cluster/index.js, I:built/cluster/ClusterOptions.js]:

- `MOVED` and `ASK` are followed, up to 16 redirections.
- `CLUSTERDOWN`, `TRYAGAIN` and a closed connection are retried after 100 ms, with a slot refresh.
- The offline queue is on by default.
- Node connections do not reconnect on their own; the client relies on MOVED to refresh the topology.

A whole-cluster outage of the single container gives `ClusterAllFailedError` (`None of startup nodes is available`) (inferred).

---

## 3. Mode-only and surprising

### Exists in only one mode

- **Sentinel only:**
  - The config fields `sentinels`/`name` and Sentinel's ioredis options.
  - Failover as an event at all.
  - Per-duplicate master resolution: the subscriber and each stream reader fail over separately.
  - The `All sentinels are unreachable…` errors on `onError`.
- **Cluster only:**
  - The config fields `nodes`/`redisOptions`/`ClusterOptions`, and no `db`.
  - Slot grouping in `del`, `mgetClusterAware` and the per-master scans (they degrade to single-server forms elsewhere).
  - `'node error'` forwarding.
  - `CROSSSLOT` and pipeline errors on raw commands.
  - The partial `publish()` count.
  - A subscriber pinned to a random node.
  - One `Cluster` per subscriber or reader.
  - Per-node clocks.
- **Standalone and Sentinel only:** `db` (logical database). Pub/Sub ignores it; channels are global. [R:pubsub "Database & Scoping"]
- **Nothing in the toolkit's own API is mode-specific.** There is no method that exists only for one mode, and no mode switch inside any feature module beyond the kernel's `isCluster` branches in `wrapper.js` and `lifecycle.js`. [T:dist/**/*.js]

### Surprising or unsupported

1. **`safeUserTag`, `isCluster`, `redisHashSlot` and `assertSameSlot` are internal.** The map's "client feature module" scenario list mentions demoing `safeUserTag`. With 1.0.11 the showcase would have to recompute it: it is `sha256(userId)` in hex, which is the session hash tag [T:dist/redis/cluster.js]. The showcase can also show it via the session key layout. [E:probe]
2. **No sharded Pub/Sub**, even with `shardedSubscribers: true`. [E:cluster2]
3. **`publish()` returns 0 on Cluster even when delivery succeeds.** [E:probe]
4. **Raw facade commands are not Cluster-safe**, apart from the four cluster-aware ones (headline 3).
5. **A graceful failover is silent; an unreplicated crash loses data:** a double lock holder, a logged-out session, `NOGROUP`. [E:failover]
6. **The upstream Cluster has no replicas**, so `CLUSTER FAILOVER` cannot be demonstrated, and stopping a node takes its slots down. All three nodes are one container, so they cannot be stopped individually either. [S:docker/cluster.compose.yml]
7. **The package is not tested on Sentinel at all.** It is also not tested on Cluster with replicas, MOVED/ASK, resharding or node loss. [S:docs/TESTING.md]
8. **The post-`close()` subscribe error differs on Cluster** (`None of startup nodes is available`). [E:probe]
9. **Clocks are mixed on Cluster.** Session `create` reads a random master; validation reads the user's node; rate limiting reads the subject's node. [T:dist/session/service.js, T:dist/redis/wrapper.js, I:built/cluster/index.js]
10. **Every stream read on Cluster leases a full `Cluster` client.** The reader pool only shrinks when a connection ends. [T:dist/streams/readers.js, E:cluster2]
11. **Passthrough options can break the modules (inferred):**
    - Sentinel `role: 'slave'` connects to a replica, so writes get `READONLY`.
    - Cluster `scaleReads: 'slave'` sends `GET`s to replicas, so lock reads and token-locator lookups can go stale.
    - `maxRetriesPerRequest` and `enableOfflineQueue` change what callers see during a failover.
    - `blockingTimeout` (ioredis's opt-in) bounds a `blockMs: 0` read on a zombie connection. [I:README]
12. **`createSessionManagerFromRedis` has no `onError` hook.** [T:dist/session/factory.js]
13. **Eviction among sessions with the same `createdAt` second is decided by token-hash order.** In the probe, which session `maxSessionsPerUser` evicted differed between runs. This holds in every mode. [T:dist/session/script-sources.js, E:probe]
14. **The Redis 8 sentinels in the compose file reject `QUIT`** (`ERR unknown command 'quit'`). A showcase that opens its own connection to a sentinel (for example to send `SENTINEL FAILOVER`) should close it with `disconnect()`. [E:failover]
15. **Every `lock.acquire` returns a token**, even when `acquired: false`. [T:dist/lock/lock.js]

### Could not verify

- A Cluster master going down, failover with replicas, MOVED/ASK during operations, and resharding while `cache.clear` or blocked reads run. There were no replicas, and the upstream suite has no such tests.
- Duplicate execution of non-idempotent commands on resend (§2.3).
- That a `NOSCRIPT` round actually happens after failover. Scripts kept working, but I did not capture the reply.
- A `SCAN` cursor carried across a Sentinel failover.
- Whether Sentinel also kills pub/sub-type clients on a reconfigured instance. The doc only names `type normal`. My experiments cannot tell, because the subscriber reconnected in all cases.

---

## Experiments

These ran on 2026-10-15. The stacks came from `docker/{standalone,sentinel,cluster}.compose.yml` at commit `b029357` (Redis 8, upstream ports), under separate project names, and were torn down afterwards. `ioredis-toolkit@1.0.11` was installed from npm (resolving `ioredis@5.11.1`) into a scratch directory. The scripts are not committed; this is what they did.

- **[E:probe]** was run once per mode. It:
  - checked the runtime exports of `safeUserTag`, `isCluster` and `redisHashSlot` (all `undefined`);
  - wrote 200 cache keys, then ran `delete` on 3 keys, `clear('k1*')` (110) and `clear()` (87), with the same counts in all modes;
  - called raw `mget`, `exists`, two-slot `eval`, cross-slot `pipeline`, `del` and `mgetClusterAware`;
  - exercised lock acquire, contend, release and `using`;
  - called `consume` four times against a limit of 3;
  - published 6 messages to a subscribed channel;
  - ran the stream group flow (`createGroup` twice, `add`, `read`, `ack`);
  - ran sessions through create, validate, rotate, replay, `maxSessionsPerUser: 2` eviction, list and `revokeAll`;
  - listed the session key layout;
  - subscribed and read after `close()`.
- **[E:cluster2]** counted client connections across the three nodes:
  - baseline 0;
  - 1 after the first command;
  - 3 after a subscribe;
  - 7 with three concurrent `streams.read` calls;
  - 0 after `close()`.

  It also checked that `shardedSubscribers: true` still delivers through classic Pub/Sub, and read `TIME` on each node.
- **[E:failover]** ran on Sentinel. It held a lock (120 s), created a session, created a group, subscribed, and blocked a group read (`blockMs: 0`) while the four-call loop ran. After 2 s it triggered the failover, watched for 20 s, then checked the lock, session, group and pub/sub sequence. It ran three times:
  1. `SENTINEL FAILOVER mymaster`.
  2. `docker compose kill` of the master, run seconds after a fail-back. The replica log shows `Delay next BGSAVE for diskless SYNC`, so the replica was still waiting on its full sync when the kill landed.
  3. A kill of the master after confirming the replica was `master_link_status:up`, `master_sync_in_progress:0`, at an equal offset.

---

## Sources

**[T] Published tarball** `ioredis-toolkit@1.0.11` (`npm pack`, shasum `f9cc4de735b118626fcf62a4737b4f982cdc7d7e`), extracted locally to `/private/tmp/claude-501/ioredis-toolkit-1.0.11-pack/x/package/`. Online: https://www.npmjs.com/package/ioredis-toolkit/v/1.0.11.

- `package.json` (exports map); `README.md`; `CHANGELOG.md` (1.0.1 surface narrowing; 1.0.4 Cluster fixes to `revokeAll`, eviction and `cache.clear`; 1.0.5 locator-first `revokeAll`; 1.0.11).
- `docs/ARCHITECTURE.md`, `docs/STATE-MACHINE.md`, `docs/DEPLOYMENT.md`, `docs/CAPACITY.md`, `docs/THREAT-MODEL.md`, `docs/TYPE-SAFETY.md`, `docs/TESTING.md`.
- `docs/modules/{cache,lock,rate-limit,pubsub,streams,sessions}/usage.md`.
- `dist/index.d.ts`, `dist/client-facade.{d.ts,js}`, `dist/redis/{client,cluster,config,config-base,errors,keys,lifecycle,scripts,clock,types,wrapper}.{d.ts,js}`.
- `dist/{cache,lock,rate-limit,pubsub,streams}/*.{d.ts,js}`.
- `dist/session/{config,cookie,errors,factory,keys,manager,repository,service,script-sources,scripts,health,revocation,types}.{d.ts,js}`.

**[S] Package repo** `org-utils/ioredis-toolkit` at tag `v1.0.11`. Local checkout: `/Users/macbookpro/work/web/packages/redis-session-kit`. Online: https://github.com/org-utils/ioredis-toolkit/tree/v1.0.11.

- `CONTEXT.md`
- `docs/adr/0001-session-kit-with-substrate-exposed.md`, `0002-redis-server-time-is-authoritative.md`, `0003-facade-only-public-surface.md`, `0004-…`, `0005-…`
- `docs/TESTING.md` at `v1.0.11` and at `main`
- `tests/integration/{pubsub,session,wrappers}.integration.test.ts`
- `docker/{standalone,sentinel,cluster}.compose.yml` at commit `b029357`: https://github.com/org-utils/ioredis-toolkit/commit/b029357

**[I] ioredis 5.11.1**, the version `^5.6.1` resolves to today (`latest` is 6.0.0, outside the range). Read from `node_modules/ioredis` of the checkout above. Online: https://github.com/redis/ioredis/tree/v5.11.1.

- `README.md`: "Auto-reconnect", "Offline Queue", "Sentinel", "Cluster" → "Transaction and Pipeline in Cluster Mode", "Pub/Sub", "Sharded Pub/Sub".
- `built/cluster/{index,ClusterOptions,ClusterSubscriber}.js`
- `built/redis/{RedisOptions,event_handler}.js`
- `built/connectors/SentinelConnector/index.js`

**[R] redis.io**

- Sentinel client spec: https://redis.io/docs/latest/develop/reference/sentinel-clients/ ("Sentinel failover disconnection", `CLIENT KILL type normal`)
- Scripting with Lua: https://redis.io/docs/latest/develop/programmability/eval-intro/ (declared keys, cross-slot access without `#!`, script cache volatility across failover, effects replication and `TIME`)
- Pub/Sub: https://redis.io/docs/latest/develop/pubsub/ (at-most-once delivery, db scoping, sharded Pub/Sub from 7.0)

**Not used:** the older 0.0.10 checkout at `../ioredis-toolkit`. It has a different API.
