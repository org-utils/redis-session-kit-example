// Built-in, editable examples per operation, with the fields each form shows and the equivalent
// ioredis-toolkit call. Still a draft for the non-session sections (see the Examples ticket on the map).

export type Value = string | number | boolean;
export type Values = Record<string, Value>;

export interface Field {
  name: string;
  label: string;
  kind: 'text' | 'json' | 'number' | 'boolean' | 'select' | 'token';
  options?: string[];
  help?: string;
}
export interface Example { id: string; title: string; description: string; values: Values }
export interface OpSpec { fields: Field[]; examples: Example[]; call: (v: Values) => string }

const q = (s: Value) => `'${s}'`;
const json = (s: Value) => { try { return JSON.stringify(JSON.parse(String(s))); } catch { return String(s); } };
const tok = (s: Value) => (s === '$cookie' ? 'cookieToken' : s === '$previous' ? 'previousToken' : q(s));
const list = (s: Value) => String(s).split(',').map((x) => x.trim()).filter(Boolean);

export const OPS: Record<string, OpSpec> = {
  'client.health': {
    fields: [
      { name: 'timeoutMs', label: 'timeoutMs', kind: 'number', help: 'PING must answer within this, or the mode is unhealthy' },
      { name: 'degradedMs', label: 'degradedMs', kind: 'number', help: 'slower than this counts as degraded' },
    ],
    examples: [
      { id: 'default', title: 'Default probe', description: 'The package defaults: 1000 ms timeout, 100 ms degraded.', values: { timeoutMs: 1000, degradedMs: 100 } },
      { id: 'strict', title: 'Strict readiness probe', description: 'Tight limits a load balancer might use.', values: { timeoutMs: 200, degradedMs: 1 } },
      { id: 'tolerant', title: 'Tolerant liveness probe', description: 'Only fail when Redis is really gone.', values: { timeoutMs: 3000, degradedMs: 500 } },
    ],
    call: (v) => `await redis.health({ timeoutMs: ${v.timeoutMs}, degradedMs: ${v.degradedMs} })`,
  },
  'client.collide': {
    fields: [
      { name: 'cache', label: 'cache namespace', kind: 'text' },
      { name: 'sessions', label: 'sessions namespace', kind: 'text' },
    ],
    examples: [
      { id: 'prefix', title: 'Prefix overlap', description: '"app" is a colon-prefix of "app:cache": rejected before connecting.', values: { cache: 'app:cache', sessions: 'app' } },
      { id: 'equal', title: 'Same namespace', description: 'Two modules writing the same keys: rejected.', values: { cache: 'shared', sessions: 'shared' } },
      { id: 'safe', title: 'Similar but safe', description: '"app" and "application" do not collide.', values: { cache: 'application', sessions: 'app' } },
    ],
    call: (v) => `createRedisClient({ ...conn, cache: { enabled: true, namespace: ${q(v.cache)} }, sessions: { enabled: true, namespace: ${q(v.sessions)} } })`,
  },
  'client.mget': {
    fields: [{ name: 'keys', label: 'keys (comma separated)', kind: 'text' }],
    examples: [
      { id: 'cross', title: 'Keys in different slots', description: 'Fine on standalone and sentinel; CROSSSLOT on cluster.', values: { keys: 'a, b, c' } },
      { id: 'tag', title: 'Same slot via hash tag', description: '{user:42} puts every key in one slot, so cluster accepts it.', values: { keys: '{user:42}:a, {user:42}:b' } },
      { id: 'aware', title: 'Use mgetClusterAware instead', description: 'Groups keys by slot and fans out; works everywhere.', values: { keys: 'a, b, c' } },
    ],
    call: (v) => `await redis.mget(${list(v.keys).map(q).join(', ')})`,
  },

  'session.create': {
    fields: [
      { name: 'userId', label: 'userId (fake login: any id)', kind: 'text' },
      { name: 'deviceId', label: 'deviceId', kind: 'text' },
      { name: 'securityVersion', label: 'securityVersion', kind: 'number' },
      { name: 'metadata', label: 'metadata (JSON)', kind: 'json' },
      { name: 'idleTimeout', label: 'idleTimeout (s, blank = config)', kind: 'number' },
      { name: 'absoluteTimeout', label: 'absoluteTimeout (s, blank = config)', kind: 'number' },
    ],
    examples: [
      { id: 'browser', title: 'Log in on a laptop', description: 'Fake login: no password. Sets this mode\'s cookie.', values: { userId: 'user-42', deviceId: 'laptop', securityVersion: 1, metadata: '{ "plan": "pro" }', idleTimeout: '', absoluteTimeout: '' } },
      { id: 'phone', title: 'Same user on a phone', description: 'A second session in the user\'s session set.', values: { userId: 'user-42', deviceId: 'phone', securityVersion: 1, metadata: '{}', idleTimeout: '', absoluteTimeout: '' } },
      { id: 'idle', title: 'Watch an idle timeout', description: 'idleTimeout 20 s: stop touching it and it fails with idle_timeout.', values: { userId: 'user-42', deviceId: 'kiosk', securityVersion: 1, metadata: '{}', idleTimeout: 20, absoluteTimeout: '' } },
      { id: 'absolute', title: 'Watch an absolute timeout', description: 'absoluteTimeout 45 s: touching cannot save it.', values: { userId: 'user-42', deviceId: 'kiosk', securityVersion: 1, metadata: '{}', idleTimeout: '', absoluteTimeout: 45 } },
    ],
    call: (v) => `await redis.sessions.create({ userId: ${q(v.userId)}, deviceId: ${q(v.deviceId)}, securityVersion: ${v.securityVersion}, metadata: ${json(v.metadata)}${v.idleTimeout !== '' ? `, idleTimeout: ${v.idleTimeout}` : ''}${v.absoluteTimeout !== '' ? `, absoluteTimeout: ${v.absoluteTimeout}` : ''} })`,
  },
  'session.validate': {
    fields: [{ name: 'token', label: 'token', kind: 'token' }],
    examples: [
      { id: 'cookie', title: 'Validate my cookie', description: '{ valid: true, session } or { valid: false, reason }. Never throws for a bad credential.', values: { token: '$cookie' } },
      { id: 'old', title: 'Validate a replaced token', description: 'The token from before the last rotation answers consumed.', values: { token: '$previous' } },
      { id: 'junk', title: 'A made-up token', description: 'not_found.', values: { token: 'j_fake.0000' } },
    ],
    call: (v) => `await redis.sessions.validate(${tok(v.token)})`,
  },
  'session.get': {
    fields: [{ name: 'token', label: 'token', kind: 'token' }],
    examples: [{ id: 'cookie', title: 'Get or throw', description: 'Same check as validate, but throws a typed Session*Error.', values: { token: '$cookie' } }],
    call: (v) => `await redis.sessions.get(${tok(v.token)})`,
  },
  'session.touch': {
    fields: [{ name: 'token', label: 'token', kind: 'token' }],
    examples: [
      { id: 'touch', title: 'Touch on a request', description: 'Extends the idle expiry; at most once per touchInterval (10 s).', values: { token: '$cookie' } },
      { id: 'twice', title: 'Touch again straight away', description: 'Within touchInterval: no write, touched: false.', values: { token: '$cookie' } },
    ],
    call: (v) => `await redis.sessions.touch(${tok(v.token)})`,
  },
  'session.update': {
    fields: [{ name: 'token', label: 'token', kind: 'token' }, { name: 'metadata', label: 'metadata patch (JSON)', kind: 'json' }, { name: 'expectedVersion', label: 'expectedVersion (blank = none)', kind: 'number' }],
    examples: [
      { id: 'theme', title: 'Save a preference', description: 'Bumps version. No expectedVersion: last write wins.', values: { token: '$cookie', metadata: '{ "theme": "dark" }', expectedVersion: '' } },
      { id: 'cas', title: 'Optimistic update', description: 'With the current version (1 after login) it succeeds…', values: { token: '$cookie', metadata: '{ "theme": "light" }', expectedVersion: 1 } },
      { id: 'stale', title: 'Stale version', description: '…run it twice: the second sees a newer version and gets SESSION_CONFLICT.', values: { token: '$cookie', metadata: '{ "theme": "light" }', expectedVersion: 1 } },
    ],
    call: (v) => `await redis.sessions.update(${tok(v.token)}, { metadata: ${json(v.metadata)} }${v.expectedVersion !== '' ? `, ${v.expectedVersion}` : ''})`,
  },
  'session.rotate': {
    fields: [{ name: 'token', label: 'token', kind: 'token' }],
    examples: [
      { id: 'current', title: 'Rotate after privilege change', description: 'Consumes the session and creates its successor; the cookie moves on.', values: { token: '$cookie' } },
      { id: 'replay', title: 'Replay the old token', description: 'Rotating the consumed predecessor: SessionReplayError. Nothing else ends.', values: { token: '$previous' } },
    ],
    call: (v) => `await redis.sessions.rotate(${tok(v.token)})`,
  },
  'session.revoke': {
    fields: [{ name: 'token', label: 'token', kind: 'token' }],
    examples: [
      { id: 'logout', title: 'Log out', description: 'Revokes the session; it answers revoked until its tombstone expires (≤ 300 s).', values: { token: '$cookie' } },
      { id: 'stale', title: 'Log out with a stale cookie', description: 'Revoking a consumed token follows the rotation chain and revokes its end.', values: { token: '$previous' } },
    ],
    call: (v) => `await redis.sessions.revoke(${tok(v.token)})`,
  },
  'session.destroy': {
    fields: [{ name: 'token', label: 'token', kind: 'token' }],
    examples: [{ id: 'destroy', title: 'Delete outright', description: 'No tombstone: the credential answers not_found right away.', values: { token: '$cookie' } }],
    call: (v) => `await redis.sessions.destroy(${tok(v.token)})`,
  },
  'session.setSecurityVersion': {
    fields: [{ name: 'userId', label: 'userId', kind: 'text' }, { name: 'version', label: 'version', kind: 'number' }],
    examples: [
      { id: 'reset', title: 'Password reset', description: 'Bump to 2: every session created with 1 now validates as invalid.', values: { userId: 'user-42', version: 2 } },
      { id: 'bad', title: 'Not a whole number', description: '1.5 is rejected: SESSION_INVALID.', values: { userId: 'user-42', version: 1.5 } },
    ],
    call: (v) => `await redis.sessions.setSecurityVersion(${q(v.userId)}, ${v.version})`,
  },
  'session.revokeAll': {
    fields: [{ name: 'userId', label: 'userId', kind: 'text' }, { name: 'limit', label: 'limit', kind: 'number' }],
    examples: [
      { id: 'all', title: 'Log out everywhere', description: 'Deletes the user\'s sessions (no tombstones): they answer not_found.', values: { userId: 'user-42', limit: 200 } },
      { id: 'batch', title: 'One at a time', description: 'limit 1: watch { affected, remaining } count down.', values: { userId: 'user-42', limit: 1 } },
    ],
    call: (v) => `await redis.sessions.revokeAll(${q(v.userId)}, ${v.limit})`,
  },
  'session.list': {
    fields: [{ name: 'userId', label: 'userId', kind: 'text' }],
    examples: [{ id: 'list', title: 'My devices', description: 'Live sessions in the user\'s session set, expired ones left out.', values: { userId: 'user-42' } }],
    call: (v) => `await redis.sessions.list(${q(v.userId)}, 0, 50)`,
  },

  'cache.set': {
    fields: [
      { name: 'key', label: 'key', kind: 'text' },
      { name: 'value', label: 'value (JSON)', kind: 'json' },
      { name: 'ttl', label: 'ttl (seconds)', kind: 'number' },
      { name: 'condition', label: 'condition', kind: 'select', options: ['none', 'nx', 'xx'] },
    ],
    examples: [
      { id: 'profile', title: 'Cache a user profile', description: 'A JSON value with the default 5-minute TTL.', values: { key: 'user:42', value: '{ "id": "42", "name": "Ada" }', ttl: 300, condition: 'none' } },
      { id: 'nx', title: 'Write only if absent (NX)', description: 'Returns false when the key already exists.', values: { key: 'user:42', value: '{ "id": "42" }', ttl: 300, condition: 'nx' } },
      { id: 'xx', title: 'Update only if present (XX)', description: 'Returns false when there is nothing to update.', values: { key: 'user:404', value: '{ "id": "404" }', ttl: 300, condition: 'xx' } },
      { id: 'short', title: 'Short-lived value', description: 'Expires in 5 s; watch it vanish in RedisInsight.', values: { key: 'otp:42', value: '"731902"', ttl: 5, condition: 'none' } },
    ],
    call: (v) => `await redis.cache.set(${q(v.key)}, ${json(v.value)}, { ttl: ${v.ttl}${v.condition !== 'none' ? `, ${v.condition}: true` : ''} })`,
  },
  'cache.get': {
    fields: [{ name: 'key', label: 'key', kind: 'text' }],
    examples: [
      { id: 'hit', title: 'Hit', description: 'A key set by the profile example.', values: { key: 'user:42' } },
      { id: 'miss', title: 'Miss', description: '{ hit: false } rather than null, so a cached null is distinguishable.', values: { key: 'user:missing' } },
    ],
    call: (v) => `await redis.cache.get(${q(v.key)})`,
  },
  'cache.clear': {
    fields: [{ name: 'pattern', label: 'pattern', kind: 'text' }],
    examples: [
      { id: 'all', title: 'Clear the namespace', description: 'SCAN + DEL; on cluster it scans every master.', values: { pattern: '*' } },
      { id: 'users', title: 'Only user keys', description: 'A glob inside the namespace.', values: { pattern: 'user:*' } },
    ],
    call: (v) => `await redis.cache.clear(${q(v.pattern)})`,
  },

  'lock.acquire': {
    fields: [{ name: 'name', label: 'name', kind: 'text' }, { name: 'ttl', label: 'ttl (seconds)', kind: 'number' }],
    examples: [
      { id: 'job', title: 'Nightly report job', description: 'A 30 s lease; run it twice to see the second one refused.', values: { name: 'report:nightly', ttl: 30 } },
      { id: 'short', title: 'Sub-second lease', description: 'TTLs may be fractional, down to milliseconds.', values: { name: 'cart:42', ttl: 0.5 } },
      { id: 'limit', title: 'Over maxTtl', description: '600 s exceeds the 300 s maxTtl: LOCK_LIMIT.', values: { name: 'migration', ttl: 600 } },
    ],
    call: (v) => `await redis.lock.acquire(${q(v.name)}, ${v.ttl})`,
  },
  'lock.extend': {
    fields: [{ name: 'name', label: 'name', kind: 'text' }, { name: 'token', label: 'token', kind: 'text' }, { name: 'ttl', label: 'ttl (seconds)', kind: 'number' }],
    examples: [
      { id: 'mine', title: 'Extend my lease', description: 'Resets the lease to ttl (it does not add to it).', values: { name: 'report:nightly', token: '(last acquired)', ttl: 30 } },
      { id: 'theirs', title: 'Someone else\'s token', description: 'Compare-and-PEXPIRE fails: false.', values: { name: 'report:nightly', token: 'not-my-token', ttl: 30 } },
    ],
    call: (v) => `await redis.lock.extend(${q(v.name)}, token, ${v.ttl})`,
  },
  'lock.release': {
    fields: [{ name: 'name', label: 'name', kind: 'text' }, { name: 'token', label: 'token', kind: 'text' }],
    examples: [
      { id: 'mine', title: 'Release with my token', description: 'Lua compare-and-delete: true.', values: { name: 'report:nightly', token: '(last acquired)' } },
      { id: 'theirs', title: 'Release with a wrong token', description: 'The lock survives: false.', values: { name: 'report:nightly', token: 'not-my-token' } },
    ],
    call: (v) => `await redis.lock.release(${q(v.name)}, token)`,
  },

  'rate-limit.consume': {
    fields: [{ name: 'subject', label: 'subject', kind: 'text' }, { name: 'cost', label: 'cost', kind: 'number' }],
    examples: [
      { id: 'one', title: 'One request', description: '100 per 60 s window; remaining goes down by one.', values: { subject: 'user:42', cost: 1 } },
      { id: 'bulk', title: 'Expensive request', description: 'Costs 25 of the window at once.', values: { subject: 'user:42', cost: 25 } },
      { id: 'bad', title: 'Invalid cost', description: 'Cost must be a positive integer: RATE_LIMIT_INPUT.', values: { subject: 'user:42', cost: 0 } },
    ],
    call: (v) => `await redis.rateLimiter.consume(${q(v.subject)}, ${v.cost})`,
  },
  'rate-limit.check': {
    fields: [{ name: 'subject', label: 'subject', kind: 'text' }],
    examples: [{ id: 'peek', title: 'Peek without consuming', description: 'Same result shape, count unchanged.', values: { subject: 'user:42' } }],
    call: (v) => `await redis.rateLimiter.check(${q(v.subject)})`,
  },
  'rate-limit.reset': {
    fields: [{ name: 'subject', label: 'subject', kind: 'text' }],
    examples: [{ id: 'reset', title: 'Reset a subject', description: 'Deletes the window; the next consume starts fresh.', values: { subject: 'user:42' } }],
    call: (v) => `await redis.rateLimiter.reset(${q(v.subject)})`,
  },

  'pubsub.publish': {
    fields: [{ name: 'channel', label: 'channel', kind: 'text' }, { name: 'message', label: 'message (JSON)', kind: 'json' }],
    examples: [
      { id: 'order', title: 'Order created', description: 'Returns the subscriber count; on cluster it can be 0 even when delivered.', values: { channel: 'orders.created', message: '{ "orderId": "42", "total": 19.99 }' } },
      { id: 'nobody', title: 'Nobody listening', description: 'A channel with no subscribers: 0.', values: { channel: 'orders.cancelled', message: '{ "orderId": "7" }' } },
    ],
    call: (v) => `await redis.pubsub.publish(${q(v.channel)}, ${json(v.message)})`,
  },
  'pubsub.subscribe': {
    fields: [{ name: 'channel', label: 'channel', kind: 'text' }],
    examples: [{ id: 'listen', title: 'Listen to orders', description: 'Opens a live stream; publish from another tab to see it arrive.', values: { channel: 'orders.created' } }],
    call: (v) => `await redis.pubsub.subscribe(${q(v.channel)}, (msg) => …)`,
  },

  'streams.add': {
    fields: [{ name: 'stream', label: 'stream', kind: 'text' }, { name: 'fields', label: 'fields (JSON)', kind: 'json' }, { name: 'maxEntries', label: 'maxEntries', kind: 'number' }],
    examples: [
      { id: 'event', title: 'Append an order event', description: 'XADD with an approximate MAXLEN cap.', values: { stream: 'orders', fields: '{ "orderId": "42", "type": "created" }', maxEntries: 100000 } },
      { id: 'capped', title: 'Tiny capped stream', description: 'maxEntries 10: older entries get trimmed.', values: { stream: 'recent', fields: '{ "n": "1" }', maxEntries: 10 } },
      { id: 'empty', title: 'No fields', description: 'An empty field map: STREAMS_INPUT.', values: { stream: 'orders', fields: '{}', maxEntries: 100000 } },
    ],
    call: (v) => `await redis.streams.add(${q(v.stream)}, ${json(v.fields)}, ${v.maxEntries})`,
  },
  'streams.read': {
    fields: [
      { name: 'stream', label: 'stream', kind: 'text' }, { name: 'group', label: 'group', kind: 'text' },
      { name: 'consumer', label: 'consumer', kind: 'text' }, { name: 'count', label: 'count', kind: 'number' },
      { name: 'pending', label: 're-read my pending entries (id 0)', kind: 'boolean' },
    ],
    examples: [
      { id: 'new', title: 'New entries for worker-1', description: 'Group read with ">" : entries become pending until acked.', values: { stream: 'orders', group: 'billing', consumer: 'worker-1', count: 10, pending: false } },
      { id: 'pending', title: 'Recover pending entries', description: 'id 0 re-delivers what worker-1 never acked.', values: { stream: 'orders', group: 'billing', consumer: 'worker-1', count: 10, pending: true } },
      { id: 'nogroup', title: 'Missing group', description: 'Reading a group that was never created: NOGROUP from Redis.', values: { stream: 'orders', group: 'ghost', consumer: 'worker-1', count: 10, pending: false } },
    ],
    call: (v) => `await redis.streams.read(${q(v.stream)}, { group: ${q(v.group)}, consumer: ${q(v.consumer)}, count: ${v.count}${v.pending ? ", id: '0'" : ''} })`,
  },
  'streams.ack': {
    fields: [{ name: 'stream', label: 'stream', kind: 'text' }, { name: 'group', label: 'group', kind: 'text' }, { name: 'ids', label: 'ids (comma separated)', kind: 'text' }],
    examples: [{ id: 'ack', title: 'Ack what I read', description: 'Clears entries from the pending list.', values: { stream: 'orders', group: 'billing', ids: '(last read ids)' } }],
    call: (v) => `await redis.streams.ack(${q(v.stream)}, ${q(v.group)}, ...ids)`,
  },

  'failover.drill': {
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
  },
  'slots.inspect': {
    fields: [{ name: 'keys', label: 'keys (one per line or comma separated)', kind: 'json' }],
    examples: [
      { id: 'plain', title: 'Related keys, no hash tag', description: 'The whole key is hashed, so one user\'s keys scatter across slots and nodes.', values: { keys: 'user:42:profile, user:42:cart, user:42:orders' } },
      { id: 'tag', title: 'Same keys with a hash tag', description: 'Only {user:42} is hashed: one slot, so multi-key commands are atomic.', values: { keys: '{user:42}:profile, {user:42}:cart, {user:42}:orders' } },
      { id: 'session', title: 'How sessions place a user\'s keys', description: 'Record and session set share {sha256(userId)}; each token locator lands in its own slot.', values: { keys: 'showcase:session:session:{a3f9c21e}:9be1, showcase:session:user-sessions:{a3f9c21e}, showcase:session:token-index:9be1, showcase:session:token-index:41c7' } },
      { id: 'empty', title: 'An empty hash tag', description: '{} hashes nothing, so Redis hashes the whole key: foo{}bar and foo{}baz differ.', values: { keys: 'foo{}bar, foo{}baz' } },
    ],
    call: (v) => `CLUSTER KEYSLOT <key>  ×${String(v.keys).split(/[\n,]/).filter((k) => k.trim()).length}   // the showcase asks Redis; the package's slot helpers aren't public`,
  },
};

export const spec = (moduleId: string, opId: string): OpSpec => OPS[`${moduleId}.${opId}`];
export const primary = (s: OpSpec, v: Values) => String(v[s.fields[0]?.name] ?? '');
