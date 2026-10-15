// Built-in, editable examples per operation, with the fields each form shows and the equivalent ioredis-toolkit call,
// following the catalogue settled on the Examples ticket. A spec with a request `body` runs for real.

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
export interface OpSpec {
  fields: Field[]; examples: Example[]; call: (v: Values) => string;
  /** The request body sent to the backend, for sections that run for real. Throws when the values can't make one. */
  body?: (v: Values) => unknown;
}

const q = (s: Value) => `'${s}'`;
const json = (s: Value) => { try { return JSON.stringify(JSON.parse(String(s))); } catch { return String(s); } };
const tok = (s: Value) => (s === '$cookie' ? 'cookieToken' : s === '$previous' ? 'previousToken' : q(s));
const list = (s: Value) => String(s).split(',').map((x) => x.trim()).filter(Boolean);
/** A JSON field's text as a value; a parse error names the field. */
const parse = (s: Value, field: string) => {
  try { return JSON.parse(String(s)); } catch { throw new Error(`${field} is not valid JSON: ${String(s)}`); }
};
/** A number field left blank means "not given", so the package's default applies. */
const optional = (s: Value) => (s === '' ? undefined : Number(s));
/** A text field left blank means "not given". */
const blank = (s: Value) => (s === '' ? undefined : String(s));
const cacheTtl = { name: 'ttl', label: 'ttl (seconds)', kind: 'number', help: 'blank: the default TTL, 300 s' } as const;
/** The lock section's holder: which lane runs the operation and keeps its tokens. Not sent to the backend. */
const lane: Field = { name: 'lane', label: 'holder', kind: 'select', options: ['A', 'B'] };
const lockName: Field = { name: 'name', label: 'name', kind: 'text' };
const stream: Field = { name: 'stream', label: 'stream', kind: 'text' };
const subject: Field = { name: 'subject', label: 'subject', kind: 'text' };
const lockTtl: Field = { name: 'ttl', label: 'ttl (seconds)', kind: 'number', help: 'blank: the default lease, 30 s (maxTtl 300)' };

export const OPS: Record<string, OpSpec> = {
  'client.health': {
    fields: [
      { name: 'timeoutMs', label: 'timeoutMs', kind: 'number', help: 'PING must answer within this, or the mode is unhealthy' },
      { name: 'degradedMs', label: 'degradedMs', kind: 'number', help: 'slower than this counts as degraded' },
    ],
    examples: [
      { id: 'default', title: 'Default probe', description: 'The package defaults: 1000 ms timeout, 100 ms degraded. On cluster, one entry per master.', values: { timeoutMs: 1000, degradedMs: 100 } },
      { id: 'strict', title: 'Strict readiness probe', description: 'Tight limits a load balancer might use.', values: { timeoutMs: 200, degradedMs: 1 } },
      { id: 'tolerant', title: 'Tolerant liveness probe', description: 'Only fail when Redis is really gone.', values: { timeoutMs: 3000, degradedMs: 500 } },
    ],
    call: (v) => `await redis.health({ timeoutMs: ${v.timeoutMs}, degradedMs: ${v.degradedMs} })`,
    body: (v) => ({ timeoutMs: optional(v.timeoutMs), degradedMs: optional(v.degradedMs) }),
  },
  'client.validate': {
    fields: [{ name: 'config', label: 'config (JSON)', kind: 'json', help: 'the whole createRedisClient config, on a temporary client' }],
    examples: [
      { id: 'sentinel-name', title: 'Sentinel without a master name', description: 'No name: REDIS_CONFIGURATION (500) before anything connects, so no commands. The same on every mode: the config names its own.', values: { config: '{ "mode": "sentinel", "sentinels": [{ "host": "127.0.0.1", "port": 26379 }] }' } },
      { id: 'cluster-nodes', title: 'Cluster with no nodes', description: 'An empty node list: REDIS_CONFIGURATION before connecting.', values: { config: '{ "mode": "cluster", "nodes": [] }' } },
      { id: 'port', title: 'Port 70000', description: 'Out of range: REDIS_CONFIGURATION before connecting.', values: { config: '{ "mode": "standalone", "host": "127.0.0.1", "port": 70000 }' } },
      { id: 'lock-ttl', title: 'Lock defaultTtl above maxTtl', description: 'Each module section is checked too: LOCK_CONFIGURATION before connecting.', values: { config: '{ "mode": "standalone", "lock": { "enabled": true, "namespace": "app:lock", "defaultTtl": 600, "maxTtl": 300 } }' } },
    ],
    call: (v) => `createRedisClient(${json(v.config)})\n// the showcase adds lazyConnect: true, so a config the package accepts is closed before it connects`,
    body: (v) => ({ config: parse(v.config, 'config') }),
  },
  'client.collide': {
    fields: [
      { name: 'cache', label: 'cache namespace', kind: 'text' },
      { name: 'sessions', label: 'sessions namespace', kind: 'text' },
    ],
    examples: [
      { id: 'prefix', title: 'Prefix overlap', description: '"app" is a colon-prefix of "app:cache": rejected before connecting.', values: { cache: 'app:cache', sessions: 'app' } },
      { id: 'equal', title: 'Same namespace', description: 'Two modules writing the same keys: rejected.', values: { cache: 'shared', sessions: 'shared' } },
      { id: 'safe', title: 'Similar but safe', description: '"app" and "application" do not collide: a temporary client is created on this mode, then closed.', values: { cache: 'application', sessions: 'app' } },
    ],
    call: (v) => `createRedisClient({ ...conn, cache: { enabled: true, namespace: ${q(v.cache)} }, sessions: { enabled: true, namespace: ${q(v.sessions)} } })`,
    body: (v) => ({ cache: v.cache, sessions: v.sessions }),
  },
  'client.with': {
    fields: [
      { name: 'method', label: 'method', kind: 'select', options: ['withCache', 'withLock', 'withRateLimit', 'withPubSub', 'withStreams', 'withSessions'] },
      { name: 'options', label: 'options (JSON)', kind: 'json' },
      { name: 'replace', label: "replace: pass 'replace' instead of merging", kind: 'boolean' },
      { name: 'whileSubscribed', label: 'whileSubscribed: subscribe first', kind: 'boolean' },
    ],
    examples: [
      { id: 'merge', title: 'Merge', description: 'Only defaultTtl changes; then a set without a ttl gets 5 s (with-demo in the cache namespace).', values: { method: 'withCache', options: '{ "defaultTtl": 5 }', replace: false, whileSubscribed: false } },
      { id: 'replace', title: 'Replace', description: 'Every field not given resets to its default, so enabled is false again and cache throws REDIS_CONFIGURATION.', values: { method: 'withCache', options: '{ "defaultTtl": 5 }', replace: true, whileSubscribed: false } },
      { id: 'collide', title: 'Colliding override', description: 'The lock would share the cache namespace: REDIS_CONFIGURATION, and the lock config in effect is kept.', values: { method: 'withLock', options: '{ "namespace": "showcase:cache" }', replace: false, whileSubscribed: false } },
      { id: 'subscribed', title: 'While subscribed', description: 'Reconfiguring would drop a live subscription, so withPubSub() throws PUBSUB_STATE.', values: { method: 'withPubSub', options: '{}', replace: false, whileSubscribed: true } },
    ],
    call: (v) => [
      '// a temporary client configured like the mode client',
      v.whileSubscribed && "await redis.pubsub.subscribe('orders.created', handler)",
      `redis.${v.method}(${json(v.options)}${v.replace ? ", 'replace'" : ''})`,
      v.method === 'withCache' && "await redis.cache.set('with-demo', 'merged')\nawait redis.cache.ttl('with-demo')  // only if the set succeeds",
    ].filter(Boolean).join('\n'),
    body: (v) => ({ method: v.method, options: parse(v.options, 'options'), replace: v.replace === true, whileSubscribed: v.whileSubscribed === true }),
  },
  'client.raw': {
    fields: [
      { name: 'command', label: 'command', kind: 'select', options: ['mget', 'exists', 'eval', 'pipeline', 'mgetClusterAware', 'del', 'scanCluster', 'deletePatternClusterAware'] },
      { name: 'keys', label: 'keys (comma separated)', kind: 'text', help: 'full Redis keys: raw commands skip every namespace' },
      { name: 'pattern', label: 'pattern', kind: 'text', help: 'scanCluster and deletePatternClusterAware only' },
      { name: 'script', label: 'script (eval only)', kind: 'json' },
    ],
    examples: [
      { id: 'mget-cross', title: 'mget across slots', description: 'Two slots: the values on standalone and sentinel, CROSSSLOT (502) from Redis on cluster. Run the cache section’s “Cache a user profile” and “Short-lived value” first to see values (the second expires in 5 s).', values: { command: 'mget', keys: 'showcase:cache:user:42, showcase:cache:otp:42', pattern: '', script: '' } },
      { id: 'mget-tag', title: 'mget with a hash tag', description: 'Only {user:42} is hashed, so both keys share a slot: works on every mode.', values: { command: 'mget', keys: 'showcase:client:{user:42}:profile, showcase:client:{user:42}:cart', pattern: '', script: '' } },
      { id: 'exists-cross', title: 'exists across slots', description: 'Counts the keys that exist (run the cache examples above it first); CROSSSLOT on cluster, like mget.', values: { command: 'exists', keys: 'showcase:cache:user:42, showcase:cache:otp:42', pattern: '', script: '' } },
      { id: 'aware', title: 'mgetClusterAware', description: 'Works everywhere: on cluster the package sends one MGET per slot and keeps your key order. user:1 is never written (null); it is here because it lives on another node.', values: { command: 'mgetClusterAware', keys: 'showcase:cache:user:42, showcase:cache:user:1, showcase:cache:otp:42', pattern: '', script: '' } },
      { id: 'pipeline-cross', title: 'pipeline across nodes', description: 'One GET per key in one pipeline (user:1 sits on another node and reads null). On cluster ioredis refuses keys on different nodes before sending anything (502); keys in different slots on one node are fine.', values: { command: 'pipeline', keys: 'showcase:cache:user:42, showcase:cache:user:1', pattern: '', script: '' } },
      { id: 'eval', title: 'Two-key eval', description: 'A script declaring two keys in different slots: CROSSSLOT on cluster, the values elsewhere (after the cache examples named in “mget across slots”).', values: { command: 'eval', keys: 'showcase:cache:user:42, showcase:cache:otp:42', pattern: '', script: "return redis.call('MGET', KEYS[1], KEYS[2])" } },
      { id: 'del-cross', title: 'del across slots', description: 'Works on every mode: on cluster the package groups the keys and sends one DEL per slot.', values: { command: 'del', keys: 'showcase:cache:user:42, showcase:cache:otp:42, showcase:cache:user:missing', pattern: '', script: '' } },
      { id: 'scan', title: 'scanCluster', description: 'Every showcase key; on cluster it scans every master.', values: { command: 'scanCluster', keys: '', pattern: 'showcase:*', script: '' } },
      { id: 'delete-pattern', title: 'deletePatternClusterAware', description: 'SCAN + DEL of the whole cache namespace, per master on cluster, never a cross-slot DEL.', values: { command: 'deletePatternClusterAware', keys: '', pattern: 'showcase:cache:*', script: '' } },
    ],
    call: (v) => {
      const keys = list(v.keys).map(q).join(', ');
      switch (v.command) {
        case 'eval': return `await redis.eval(${JSON.stringify(String(v.script))}, ${list(v.keys).length}, ${keys})`;
        case 'pipeline': return `await redis.pipeline()${list(v.keys).map((k) => `.get(${q(k)})`).join('')}.exec()`;
        case 'mgetClusterAware': return `await redis.mgetClusterAware([${keys}])`;
        case 'scanCluster':
        case 'deletePatternClusterAware': return `await redis.${v.command}(${q(v.pattern)})`;
        default: return `await redis.${v.command}(${keys})`;
      }
    },
    body: (v) => {
      switch (v.command) {
        case 'eval': return { command: v.command, script: v.script, keys: list(v.keys), args: [] };
        case 'scanCluster':
        case 'deletePatternClusterAware': return { command: v.command, pattern: v.pattern };
        default: return { command: v.command, keys: list(v.keys) };
      }
    },
  },

  'client.shutdown': {
    fields: [
      { name: 'liveWork', label: 'liveWork: a subscription and a blocked stream read', kind: 'boolean' },
      { name: 'closeTwice', label: 'closeTwice: call close() again', kind: 'boolean' },
    ],
    examples: [
      { id: 'live', title: 'Close with live work', description: 'close() ends the blocked read at once (Connection is closed.), the subscription hears nothing more, and a subscribe afterwards rejects. On cluster PUBLISH counts only the subscribers on the node that took it, so its count can read 0.', values: { liveWork: true, closeTwice: false } },
      { id: 'twice', title: 'Close twice', description: 'close() is idempotent: the second one resolves too.', values: { liveWork: false, closeTwice: true } },
    ],
    call: (v) => [
      v.liveWork && "await redis.pubsub.subscribe('orders.created', handler)\nawait redis.pubsub.publish('orders.created', { orderId: '42' })\nconst read = redis.streams.read('orders', { id: '$', blockMs: 0 })",
      'await redis.close()',
      v.liveWork && "await read\nawait modeClient.publish('showcase:client:events:orders.created', JSON.stringify({ orderId: '43' }))  // does the handler still hear it?\nawait redis.pubsub.subscribe('orders.created', handler)",
      v.closeTwice && 'await redis.close()',
    ].filter(Boolean).join('\n'),
    body: (v) => ({ liveWork: v.liveWork === true, closeTwice: v.closeTwice === true }),
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
      cacheTtl,
      { name: 'nx', label: 'nx: only if absent', kind: 'boolean' },
      { name: 'xx', label: 'xx: only if present', kind: 'boolean' },
    ],
    examples: [
      { id: 'profile', title: 'Cache a user profile', description: 'A JSON value for 5 minutes → true. Run this first: get, has and ttl read it.', values: { key: 'user:42', value: '{ "id": "42", "name": "Ada" }', ttl: 300, nx: false, xx: false } },
      { id: 'short', title: 'Short-lived value', description: 'Expires in 5 s: watch its TTL in the Redis-state panel, then try has on otp:42.', values: { key: 'otp:42', value: '"731902"', ttl: 5, nx: false, xx: false } },
      { id: 'xx', title: 'Update only if present (XX)', description: 'Nothing at user:404, so nothing is written → false.', values: { key: 'user:404', value: '{ "id": "404" }', ttl: 300, nx: false, xx: true } },
      { id: 'both', title: 'NX and XX together', description: 'The package refuses before sending anything → 400 CACHE_INPUT, no commands.', values: { key: 'user:42', value: '{ "id": "42" }', ttl: 300, nx: true, xx: true } },
    ],
    call: (v) => {
      const options = [v.ttl !== '' && `ttl: ${v.ttl}`, v.nx && 'nx: true', v.xx && 'xx: true'].filter(Boolean);
      return `await redis.cache.set(${q(v.key)}, ${json(v.value)}${options.length ? `, { ${options.join(', ')} }` : ''})`;
    },
    body: (v) => ({ key: v.key, value: parse(v.value, 'value'), ttl: optional(v.ttl), nx: v.nx === true, xx: v.xx === true }),
  },
  'cache.get': {
    fields: [{ name: 'key', label: 'key', kind: 'text' }, { name: 'getValue', label: 'getValue: just the value', kind: 'boolean' }],
    examples: [
      { id: 'hit', title: 'Hit', description: 'Run “Cache a user profile” (set) first → { hit: true, value }.', values: { key: 'user:42', getValue: false } },
      { id: 'miss', title: 'Miss', description: '{ hit: false, value: null }: a cached null would still be a hit.', values: { key: 'user:missing', getValue: false } },
      { id: 'value', title: 'Just the value', description: 'getValue(): the value itself, or null on a miss.', values: { key: 'user:42', getValue: true } },
    ],
    call: (v) => `await redis.cache.${v.getValue ? 'getValue' : 'get'}(${q(v.key)})`,
    body: (v) => ({ key: v.key, getValue: v.getValue === true }),
  },
  'cache.has': {
    fields: [{ name: 'key', label: 'key', kind: 'text' }],
    examples: [
      { id: 'present', title: 'Present', description: 'After “Cache a user profile” → true.', values: { key: 'user:42' } },
      { id: 'expired', title: 'Expired', description: 'Run “Short-lived value” (set), wait 5 s, then this → false.', values: { key: 'otp:42' } },
    ],
    call: (v) => `await redis.cache.has(${q(v.key)})`,
    body: (v) => ({ key: v.key }),
  },
  'cache.ttl': {
    fields: [{ name: 'key', label: 'key', kind: 'text' }],
    examples: [
      { id: 'left', title: 'Seconds left', description: 'After “Cache a user profile”: counts down from 300.', values: { key: 'user:42' } },
      { id: 'missing', title: 'Missing key', description: '-2: Redis’s TTL reply as is (-1 would mean no expiry).', values: { key: 'user:missing' } },
    ],
    call: (v) => `await redis.cache.ttl(${q(v.key)})`,
    body: (v) => ({ key: v.key }),
  },
  'cache.setIfAbsent': {
    fields: [{ name: 'key', label: 'key', kind: 'text' }, { name: 'value', label: 'value (JSON)', kind: 'json' }, cacheTtl],
    examples: [
      { id: 'first', title: 'First writer wins', description: 'true the first time, false on every run after until the key expires or is deleted.', values: { key: 'job:42:result', value: '{ "status": "done" }', ttl: 60 } },
    ],
    call: (v) => `await redis.cache.setIfAbsent(${q(v.key)}, ${json(v.value)}${v.ttl !== '' ? `, ${v.ttl}` : ''})`,
    body: (v) => ({ key: v.key, value: parse(v.value, 'value'), ttl: optional(v.ttl) }),
  },
  'cache.delete': {
    fields: [{ name: 'keys', label: 'keys (comma separated)', kind: 'text' }],
    examples: [
      { id: 'several', title: 'Several keys at once', description: 'Counts only the keys that existed. On cluster these sit in different slots, so the package sends one DEL per slot.', values: { keys: 'user:42, otp:42, user:missing' } },
    ],
    call: (v) => `await redis.cache.delete(${list(v.keys).map(q).join(', ')})`,
    body: (v) => ({ keys: list(v.keys) }),
  },
  'cache.clear': {
    fields: [{ name: 'pattern', label: 'pattern', kind: 'text', help: 'a glob inside the namespace' }],
    examples: [
      { id: 'users', title: 'Only user keys', description: 'SCAN + DEL of user:* only; other cache keys stay.', values: { pattern: 'user:*' } },
      { id: 'all', title: 'The whole namespace', description: 'Everything under showcase:cache. On cluster it scans every master.', values: { pattern: '*' } },
    ],
    call: (v) => `await redis.cache.clear(${q(v.pattern)})`,
    body: (v) => ({ pattern: v.pattern }),
  },

  'lock.acquire': {
    fields: [lane, lockName, lockTtl],
    examples: [
      { id: 'a', title: 'Nightly report job (A)', description: 'A 30 s lease from holder A → acquired, with its token.', values: { lane: 'A', name: 'report:nightly', ttl: 30 } },
      { id: 'b', title: '…then from B', description: 'Refused while A holds it (acquired: false), but B still gets a token of its own.', values: { lane: 'B', name: 'report:nightly', ttl: 30 } },
      { id: 'default', title: 'Default lease', description: 'ttl left blank: the package’s defaultTtl, 30 s. Release A’s lease first, or it is refused.', values: { lane: 'A', name: 'report:nightly', ttl: '' } },
      { id: 'short', title: 'Sub-second lease', description: 'TTLs may be fractional (whole milliseconds): cart:42 for 0.5 s.', values: { lane: 'A', name: 'cart:42', ttl: 0.5 } },
      { id: 'limit', title: 'Over maxTtl', description: '600 s is over maxTtl (300 s) → LOCK_LIMIT, nothing sent.', values: { lane: 'A', name: 'migration', ttl: 600 } },
    ],
    call: (v) => `await redis.lock.acquire(${q(v.name)}${v.ttl !== '' ? `, ${v.ttl}` : ''})   // holder ${v.lane}`,
    body: (v) => ({ name: v.name, ttl: optional(v.ttl) }),
  },
  'lock.extend': {
    fields: [lane, lockName, { name: 'token', label: 'token', kind: 'token' }, lockTtl],
    examples: [
      { id: 'mine', title: 'Extend my lease', description: 'With A’s token → true. Resets the lease to ttl; it does not add to it.', values: { lane: 'A', name: 'report:nightly', token: '$A', ttl: 30 } },
      { id: 'refused', title: 'With the refused token', description: 'B’s token from “…then from B” never owned the lock → false.', values: { lane: 'B', name: 'report:nightly', token: '$B', ttl: 30 } },
      { id: 'expired', title: 'After it expired', description: 'Run “Sub-second lease” (acquire) first: half a second later its token owns nothing → false.', values: { lane: 'A', name: 'cart:42', token: '$A', ttl: 30 } },
    ],
    call: (v) => `await redis.lock.extend(${q(v.name)}, token${v.ttl !== '' ? `, ${v.ttl}` : ''})   // holder ${v.lane}`,
    body: (v) => ({ name: v.name, token: v.token, ttl: optional(v.ttl) }),
  },
  'lock.release': {
    fields: [lane, lockName, { name: 'token', label: 'token', kind: 'token' }],
    examples: [
      { id: 'mine', title: 'With my token', description: 'Compare-and-delete with A’s token → true; the lease is free.', values: { lane: 'A', name: 'report:nightly', token: '$A' } },
      { id: 'theirs', title: 'With the other lane’s token', description: 'B’s token → false; A’s lock survives.', values: { lane: 'B', name: 'report:nightly', token: '$B' } },
    ],
    call: (v) => `await redis.lock.release(${q(v.name)}, token)   // holder ${v.lane}`,
    body: (v) => ({ name: v.name, token: v.token }),
  },
  'lock.using': {
    fields: [lane, lockName, { name: 'work', label: 'work (seconds)', kind: 'number', help: 'the callback holds the lock this long, server-side' }, lockTtl],
    examples: [
      { id: 'hold', title: 'Hold for 10 s', description: 'The other lane is refused meanwhile; a second using → LOCK_HELD (409). Released when the work ends.', values: { lane: 'A', name: 'report:nightly', work: 10, ttl: 30 } },
      { id: 'outlast', title: 'Work outlasts the lease', description: 'work 8 s, ttl 3: B can acquire mid-work, and the release that finds the lease gone shows in the event log as lock-release.', values: { lane: 'A', name: 'report:nightly', work: 8, ttl: 3 } },
    ],
    call: (v) => `await redis.lock.using(${q(v.name)}, async (token) => { await work(${v.work}); return { token, workedSeconds: ${v.work} } }${v.ttl !== '' ? `, ${v.ttl}` : ''})`,
    body: (v) => ({ name: v.name, work: Number(v.work), ttl: optional(v.ttl) }),
  },
  'rate-limit.consume': {
    fields: [subject, { name: 'cost', label: 'cost', kind: 'number', help: 'blank: 1' }],
    examples: [
      { id: 'one', title: 'One request', description: 'allowed; remaining goes down by one.', values: { subject: 'user:42', cost: 1 } },
      { id: 'four', title: 'Expensive request', description: 'Costs 4 of the window at once.', values: { subject: 'user:42', cost: 4 } },
      { id: 'big', title: 'Bigger than the window', description: 'cost 11 > limit 10 → denied with retryAfterSeconds. Denied calls still count against the window.', values: { subject: 'user:42', cost: 11 } },
      { id: 'bad', title: 'Invalid cost', description: '0 → RATE_LIMIT_INPUT (400), nothing sent.', values: { subject: 'user:42', cost: 0 } },
      { id: 'subject', title: 'Invalid subject', description: 'A subject starting with } → RATE_LIMIT_INPUT (400).', values: { subject: '}oops', cost: 1 } },
    ],
    call: (v) => `await redis.rateLimiter.consume(${q(v.subject)}${v.cost !== '' ? `, ${v.cost}` : ''})`,
    body: (v) => ({ subject: v.subject, cost: optional(v.cost) }),
  },
  'rate-limit.check': {
    fields: [subject],
    examples: [
      { id: 'peek', title: 'Peek without consuming', description: 'The count is unchanged.', values: { subject: 'user:42' } },
      { id: 'limit', title: 'At exactly the limit', description: 'Reset user:42, then consume ten times (or Burst 10): consume allowed the 10th (count ≤ max), but check says denied (count < max).', values: { subject: 'user:42' } },
    ],
    call: (v) => `await redis.rateLimiter.check(${q(v.subject)})`,
    body: (v) => ({ subject: v.subject }),
  },
  'rate-limit.reset': {
    fields: [subject],
    examples: [
      { id: 'reset', title: 'Reset a subject', description: '→ true; the next consume starts from 0.', values: { subject: 'user:42' } },
      { id: 'unknown', title: 'Unknown subject', description: 'No window to delete → false.', values: { subject: 'user:nobody' } },
    ],
    call: (v) => `await redis.rateLimiter.reset(${q(v.subject)})`,
    body: (v) => ({ subject: v.subject }),
  },
  'rate-limit.burst': {
    fields: [subject, { name: 'n', label: 'calls', kind: 'number' }],
    examples: [
      { id: 'fill', title: 'Fill the window', description: '15 × consume, ~100 ms apart: 10 allowed, 5 denied with retryAfterSeconds (from an empty window).', values: { subject: 'user:42', n: 15 } },
      { id: 'ten', title: 'Exactly ten', description: 'Fills the window to the limit: then try check’s “At exactly the limit”.', values: { subject: 'user:42', n: 10 } },
    ],
    call: (v) => `for (let i = 0; i < ${v.n}; i++) await redis.rateLimiter.consume(${q(v.subject)})   // sent by the showcase, ~100 ms apart`,
  },
  'pubsub.subscribe': {
    fields: [{ name: 'channel', label: 'channel', kind: 'text' }],
    examples: [
      { id: 'listen', title: 'Listen to orders', description: 'Opens a card for orders.created: an SSE stream, subscribed through the package while it is open.', values: { channel: 'orders.created' } },
      { id: 'second', title: 'A second listener', description: 'Same channel: both cards share one Redis SUBSCRIBE. Closing the last card sends the UNSUBSCRIBE.', values: { channel: 'orders.created' } },
    ],
    call: (v) => `const subscription = await redis.pubsub.subscribe(${q(v.channel)}, (message) => card.show(message))`,
  },
  'pubsub.publish': {
    fields: [
      { name: 'channel', label: 'channel', kind: 'text' },
      { name: 'message', label: 'message (JSON, or any text when raw)', kind: 'json' },
      { name: 'raw', label: 'raw: a plain PUBLISH from outside the package', kind: 'boolean' },
    ],
    examples: [
      { id: 'order', title: 'Order created', description: 'The count publish returned beside how many cards received it. On cluster the count is only the subscribers on the node that took the PUBLISH, so it can be 0 while cards still receive it.', values: { channel: 'orders.created', message: '{ "orderId": "42", "total": 19.99 }', raw: false } },
      { id: 'nobody', title: 'Nobody listening', description: 'No card on orders.cancelled → 0.', values: { channel: 'orders.cancelled', message: '{ "orderId": "7" }', raw: false } },
      { id: 'raw', title: 'A non-JSON message from elsewhere', description: 'A raw PUBLISH of "not json": the subscriber drops it and reports PUBSUB_SERIALIZATION once in the event log, however many cards listen.', values: { channel: 'orders.created', message: 'not json', raw: true } },
    ],
    call: (v) => (v.raw
      ? `await redis.publish('showcase:events:${v.channel}', ${JSON.stringify(String(v.message))})   // raw ioredis, not the package`
      : `await redis.pubsub.publish(${q(v.channel)}, ${json(v.message)})`),
    body: (v) => (v.raw ? { channel: v.channel, message: String(v.message) } : { channel: v.channel, message: parse(v.message, 'message') }),
  },
  'streams.createGroup': {
    fields: [stream, { name: 'group', label: 'group', kind: 'text' }, { name: 'start', label: 'start id', kind: 'select', options: ['$', '0'] }],
    examples: [
      { id: 'billing', title: 'Billing from now on', description: 'Start at $: only entries added after this. Creates the stream too (MKSTREAM).', values: { stream: 'orders', group: 'billing', start: '$' } },
      { id: 'again', title: 'Again', description: 'The group exists: Redis answers BUSYGROUP, which the package counts as success.', values: { stream: 'orders', group: 'billing', start: '$' } },
      { id: 'audit', title: 'Audit replaying history', description: 'Start at 0: every entry already in the stream is new to this group.', values: { stream: 'orders', group: 'audit', start: '0' } },
    ],
    call: (v) => `await redis.streams.createGroup(${q(v.stream)}, ${q(v.group)}, ${q(v.start)})`,
    body: (v) => ({ stream: v.stream, group: v.group, start: v.start }),
  },
  'streams.add': {
    fields: [stream, { name: 'fields', label: 'fields (JSON object of strings)', kind: 'json' }, { name: 'maxEntries', label: 'maxEntries', kind: 'number', help: 'blank: the default trim, ~100000' }],
    examples: [
      { id: 'event', title: 'Append an order event', description: 'Shows up in the follow pane right away; a group created at $ before it will deliver it.', values: { stream: 'orders', fields: '{ "orderId": "42", "type": "created" }', maxEntries: '' } },
      { id: 'capped', title: 'Tiny capped stream', description: 'MAXLEN ~ 10 on recent: approximate, so Redis trims only whole nodes of 100 entries. It keeps up to 101 entries, drops to 10 on the next add, then grows again.', values: { stream: 'recent', fields: '{ "event": "page_view" }', maxEntries: 10 } },
      { id: 'empty', title: 'No fields', description: '→ STREAMS_INPUT (400), nothing sent.', values: { stream: 'orders', fields: '{}', maxEntries: '' } },
    ],
    call: (v) => `await redis.streams.add(${q(v.stream)}, ${json(v.fields)}${v.maxEntries !== '' ? `, ${v.maxEntries}` : ''})`,
    body: (v) => ({ stream: v.stream, fields: parse(v.fields, 'fields'), maxEntries: optional(v.maxEntries) }),
  },
  'streams.read': {
    fields: [
      stream,
      { name: 'group', label: 'group', kind: 'text', help: 'blank: a plain read' },
      { name: 'consumer', label: 'consumer', kind: 'text' },
      { name: 'count', label: 'count', kind: 'number' },
      { name: 'id', label: 'id', kind: 'text', help: 'blank: > with a group (new entries), $ without. 0: my pending entries, or from the start' },
    ],
    examples: [
      { id: 'w1', title: 'New entries for worker-1', description: '">": entries never delivered to the group. They stay pending (amber) until acked. Run “Billing from now on”, then add entries first.', values: { stream: 'orders', group: 'billing', consumer: 'worker-1', count: 2, id: '>' } },
      { id: 'w2', title: 'worker-2 gets different ones', description: 'Each entry goes to one consumer in the group.', values: { stream: 'orders', group: 'billing', consumer: 'worker-2', count: 2, id: '>' } },
      { id: 'recover', title: 'Recover pending', description: 'id 0 re-delivers what worker-1 read but never acked, e.g. after a crash.', values: { stream: 'orders', group: 'billing', consumer: 'worker-1', count: 10, id: '0' } },
      { id: 'ghost', title: 'Missing group', description: 'No group ghost on orders → NOGROUP from Redis (502).', values: { stream: 'orders', group: 'ghost', consumer: 'worker-1', count: 2, id: '>' } },
      { id: 'noconsumer', title: 'Group without consumer', description: 'A group read needs a consumer → STREAMS_INPUT (400), nothing sent.', values: { stream: 'orders', group: 'billing', consumer: '', count: 2, id: '>' } },
      { id: 'start', title: 'From the start', description: 'A plain read (no group) from id 0: the first 10 entries, nothing becomes pending.', values: { stream: 'orders', group: '', consumer: '', count: 10, id: '0' } },
    ],
    call: (v) => {
      const options = [v.group !== '' && `group: ${q(v.group)}`, v.consumer !== '' && `consumer: ${q(v.consumer)}`, v.count !== '' && `count: ${v.count}`, v.id !== '' && `id: ${q(v.id)}`, 'blockMs: 100'].filter(Boolean);
      return `await redis.streams.read(${q(v.stream)}, { ${options.join(', ')} })`;
    },
    body: (v) => ({ stream: v.stream, group: blank(v.group), consumer: blank(v.consumer), count: optional(v.count), id: blank(v.id) }),
  },
  'streams.ack': {
    fields: [stream, { name: 'group', label: 'group', kind: 'text' }, { name: 'ids', label: 'ids', kind: 'token' }],
    examples: [{ id: 'ack', title: 'Ack what I read', description: 'The ids of my last read: they leave the pending table. Returns how many were pending.', values: { stream: 'orders', group: 'billing', ids: '$last' } }],
    call: (v) => `await redis.streams.ack(${q(v.stream)}, ${q(v.group)}, ...ids)`,
    body: (v) => ({ stream: v.stream, group: v.group, ids: list(v.ids) }),
  },
  'streams.delete': {
    fields: [stream, { name: 'ids', label: 'ids', kind: 'token' }],
    examples: [
      { id: 'delete', title: 'Delete an entry', description: 'XDEL: the entry leaves the stream and the follow pane’s next reads. Returns how many existed.', values: { stream: 'orders', ids: '$last' } },
      { id: 'pending', title: 'Delete a pending entry, then recover', description: 'Delete an id worker-1 has not acked, then run “Recover pending”: it comes back with empty fields, and can still be acked.', values: { stream: 'orders', ids: '$last' } },
    ],
    call: (v) => `await redis.streams.delete(${q(v.stream)}, ...ids)`,
    body: (v) => ({ stream: v.stream, ids: list(v.ids) }),
  },
  'streams.length': {
    fields: [stream],
    examples: [{ id: 'orders', title: 'How long is orders', description: 'XLEN: deleted entries no longer count.', values: { stream: 'orders' } }],
    call: (v) => `await redis.streams.length(${q(v.stream)})`,
    body: (v) => ({ stream: v.stream }),
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
