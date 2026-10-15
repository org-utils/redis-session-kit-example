// PROTOTYPE: stub data for the UI shell prototype. No backend; everything is fake and in memory.
'use client';

import { useEffect, useRef, useState } from 'react';

export type Mode = 'standalone' | 'sentinel' | 'cluster';
export const MODES: Mode[] = ['standalone', 'sentinel', 'cluster'];
export type Health = 'healthy' | 'degraded' | 'unhealthy';

export interface ModeStatus {
  mode: Mode;
  health: Health;
  latencyMs: number;
  redisInsight: string;
  cli: string;
  detail: string[];
  failoverReady?: boolean;
}

export const INITIAL_STATUS: Record<Mode, ModeStatus> = {
  standalone: {
    mode: 'standalone', health: 'healthy', latencyMs: 0.4,
    redisInsight: 'http://localhost:5542',
    cli: 'docker compose -p rsk-standalone -f infra/standalone.compose.yml run --rm redis-cli',
    detail: ['127.0.0.1:6379'],
  },
  sentinel: {
    mode: 'sentinel', health: 'healthy', latencyMs: 0.7,
    redisInsight: 'http://localhost:5541',
    cli: 'docker compose -p rsk-sentinel -f infra/sentinel.compose.yml run --rm redis-cli',
    detail: ['master 127.0.0.1:6380', 'replica 127.0.0.1:6381 link ok', 'quorum OK 3/3'],
    failoverReady: true,
  },
  cluster: {
    mode: 'cluster', health: 'healthy', latencyMs: 1.1,
    redisInsight: 'http://localhost:5540',
    cli: 'docker compose -p rsk-cluster -f infra/cluster.compose.yml run --rm redis-cli',
    detail: ['cluster_state ok', '7001 slots 0-5460', '7002 slots 5461-10922', '7003 slots 10923-16383'],
  },
};

export type ModuleKind = 'feature' | 'mode-specific';
export interface Op { id: string; label: string; input: string; placeholder: string }
export interface ShowcaseModule {
  id: string; label: string; kind: ModuleKind; onlyMode?: Mode; blurb: string; ops: Op[];
}

export const MODULES: ShowcaseModule[] = [
  { id: 'client', label: 'Client', kind: 'feature', blurb: 'Config validation, namespaces, raw commands, health, shutdown.',
    ops: [
      { id: 'health', label: 'health()', input: '', placeholder: '' },
      { id: 'collide', label: 'namespace collision', input: 'app, app:cache', placeholder: 'two namespaces' },
      { id: 'mget', label: 'raw mget', input: 'a, b, c', placeholder: 'keys' },
    ] },
  { id: 'session', label: 'Session', kind: 'feature', blurb: 'Opaque credentials, rotation chains, replay, revoke.',
    ops: [
      { id: 'create', label: 'create', input: 'user-42', placeholder: 'userId' },
      { id: 'rotate', label: 'rotate', input: '', placeholder: 'token' },
      { id: 'revokeAll', label: 'revokeAll', input: 'user-42', placeholder: 'userId' },
    ] },
  { id: 'cache', label: 'Cache', kind: 'feature', blurb: 'JSON values with TTL and conditional writes.',
    ops: [
      { id: 'set', label: 'set', input: 'user:42', placeholder: 'key' },
      { id: 'get', label: 'get', input: 'user:42', placeholder: 'key' },
      { id: 'clear', label: 'clear', input: '*', placeholder: 'pattern' },
    ] },
  { id: 'lock', label: 'Lock', kind: 'feature', blurb: 'Ownership-token leases.',
    ops: [
      { id: 'acquire', label: 'acquire', input: 'job:42', placeholder: 'name' },
      { id: 'extend', label: 'extend', input: 'job:42', placeholder: 'name' },
      { id: 'release', label: 'release', input: 'job:42', placeholder: 'name' },
    ] },
  { id: 'rate-limit', label: 'Rate limit', kind: 'feature', blurb: 'Atomic fixed-window counters.',
    ops: [
      { id: 'consume', label: 'consume', input: 'user:42', placeholder: 'subject' },
      { id: 'check', label: 'check', input: 'user:42', placeholder: 'subject' },
      { id: 'reset', label: 'reset', input: 'user:42', placeholder: 'subject' },
    ] },
  { id: 'pubsub', label: 'Pub/Sub', kind: 'feature', blurb: 'JSON fan-out over a dedicated subscriber.',
    ops: [
      { id: 'publish', label: 'publish', input: 'orders.created', placeholder: 'channel' },
      { id: 'subscribe', label: 'subscribe', input: 'orders.created', placeholder: 'channel' },
    ] },
  { id: 'streams', label: 'Streams', kind: 'feature', blurb: 'Append, consumer groups, reads, acks.',
    ops: [
      { id: 'add', label: 'add', input: 'orders', placeholder: 'stream' },
      { id: 'read', label: 'group read', input: 'orders', placeholder: 'stream' },
      { id: 'ack', label: 'ack', input: 'orders', placeholder: 'stream' },
    ] },
  { id: 'failover', label: 'Failover', kind: 'mode-specific', onlyMode: 'sentinel', blurb: 'Move the master 6380 → 6381 and watch.',
    ops: [{ id: 'failover', label: 'SENTINEL FAILOVER', input: 'mymaster', placeholder: 'master name' }] },
  { id: 'slots', label: 'Slots', kind: 'mode-specific', onlyMode: 'cluster', blurb: 'Key → hash slot → node, hash tags, fan-out.',
    ops: [{ id: 'keyslot', label: 'key → slot', input: '{user:42}:profile', placeholder: 'key' }] },
];

// Real CRC16/XMODEM so the cluster stub shows believable slots.
function crc16(s: string): number {
  let crc = 0;
  for (const b of new TextEncoder().encode(s)) {
    crc ^= b << 8;
    for (let i = 0; i < 8; i++) crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
  }
  return crc;
}
export function slotOf(key: string): number {
  const open = key.indexOf('{');
  if (open >= 0) {
    const close = key.indexOf('}', open + 1);
    if (close > open + 1) key = key.slice(open + 1, close);
  }
  return crc16(key) % 16384;
}
export function nodeOf(slot: number): string {
  return slot <= 5460 ? '127.0.0.1:7001' : slot <= 10922 ? '127.0.0.1:7002' : '127.0.0.1:7003';
}

export interface KeyTouched { key: string; type: string; ttl: number | null; slot?: number; node?: string }
export interface RunResult {
  id: number; at: string; mode: Mode; module: string; op: string; input: string;
  httpStatus: number; latencyMs: number; body: unknown; keys: KeyTouched[]; commands: string[];
}

let runId = 0;
export function runOp(mode: Mode, moduleId: string, opId: string, input: string, status: ModeStatus): RunResult {
  const ns = `showcase:${moduleId === 'pubsub' ? 'events' : moduleId === 'streams' ? 'stream' : moduleId}`;
  const base = { id: ++runId, at: new Date().toLocaleTimeString(), mode, module: moduleId, op: opId, input,
    latencyMs: +(status.latencyMs * (1 + Math.random())).toFixed(2) };
  const k = (key: string, type: string, ttl: number | null): KeyTouched =>
    mode === 'cluster' ? { key, type, ttl, slot: slotOf(key), node: nodeOf(slotOf(key)) } : { key, type, ttl };

  if (status.health === 'unhealthy')
    return { ...base, httpStatus: 503, body: { error: { code: 'MODE_UNAVAILABLE', name: 'ModeUnavailable', message: `${mode} has been unhealthy for 3 checks`, mode } }, keys: [], commands: [] };

  switch (`${moduleId}.${opId}`) {
    case 'client.mget':
      if (mode === 'cluster')
        return { ...base, httpStatus: 502, body: { error: { code: 'CROSSSLOT', name: 'ReplyError', message: "CROSSSLOT Keys in request don't hash to the same slot", mode } }, keys: [], commands: ['MGET a b c'] };
      return { ...base, httpStatus: 200, body: [null, null, null], keys: [], commands: ['MGET a b c'] };
    case 'client.health':
      return { ...base, httpStatus: 200, body: mode === 'cluster'
        ? { status: status.health, latencyMs: 1.4, nodes: status.detail.slice(1).map((d) => ({ address: `127.0.0.1:${d.slice(0, 4)}`, status: 'healthy', latencyMs: 1.1 })) }
        : { status: status.health, latencyMs: status.latencyMs }, keys: [], commands: ['PING'] };
    case 'client.collide':
      return { ...base, httpStatus: 500, body: { error: { code: 'REDIS_CONFIGURATION', name: 'RedisConfigurationError', message: 'Namespaces "app" (sessions) and "app:cache" (cache) overlap', mode } }, keys: [], commands: [] };
    case 'session.create': {
      const u = 'a3f9…c21e';
      return { ...base, httpStatus: 200, body: { token: 'kq3J…x9Q', session: { userId: input, jti: 'j_7f2a', version: 1, status: 'active' }, setCookie: `showcase_session_${mode}=kq3J…x9Q; Path=/; HttpOnly; SameSite=Lax` },
        keys: [k(`showcase:session:session:{${u}}:9be1…`, 'string', 2592000), k(`showcase:session:user-sessions:{${u}}`, 'zset', 2592000), k(`showcase:session:token-index:9be1…`, 'string', 2592000)],
        commands: ['EVALSHA create.lua 3 …'] };
    }
    case 'cache.set':
      return { ...base, httpStatus: 200, body: true, keys: [k(`${ns}:${input}`, 'string', 300)], commands: [`SET ${ns}:${input} {"id":"42"} EX 300`] };
    case 'cache.get':
      return { ...base, httpStatus: 200, body: { hit: true, value: { id: '42' } }, keys: [k(`${ns}:${input}`, 'string', 287)], commands: [`GET ${ns}:${input}`] };
    case 'cache.clear':
      return { ...base, httpStatus: 200, body: 3, keys: [], commands: mode === 'cluster' ? ['SCAN on 7001', 'SCAN on 7002', 'SCAN on 7003', 'DEL (grouped by slot)'] : [`SCAN 0 MATCH ${ns}:* COUNT 100`, 'DEL …'] };
    case 'lock.acquire': {
      const acquired = Math.random() > 0.3;
      return { ...base, httpStatus: 200, body: { acquired, token: 'Zk1…pQ' }, keys: [k(`showcase:lock:${input}`, 'string', acquired ? 30 : 12)], commands: [`SET showcase:lock:${input} <token> PX 30000 NX`] };
    }
    case 'rate-limit.consume': {
      const count = Math.floor(Math.random() * 110);
      return { ...base, httpStatus: 200, body: { allowed: count <= 100, limit: 100, remaining: Math.max(0, 100 - count), count, retryAfterSeconds: count > 100 ? 41 : 0 },
        keys: [k(`showcase:rate-limit:{${input}}`, 'hash', 60)], commands: ['EVALSHA consume.lua 1 …'] };
    }
    case 'pubsub.publish':
      return { ...base, httpStatus: 200, body: mode === 'cluster' ? 0 : 1, keys: [], commands: [`PUBLISH showcase:events:${input} {…}`] };
    case 'streams.add':
      return { ...base, httpStatus: 200, body: '1760541600000-0', keys: [k(`showcase:stream:${input}`, 'stream', null)], commands: [`XADD showcase:stream:${input} MAXLEN ~ 100000 * …`] };
    case 'failover.failover':
      return { ...base, httpStatus: 202, body: { accepted: true, from: '127.0.0.1:6380', to: '127.0.0.1:6381' }, keys: [], commands: ['SENTINEL FAILOVER mymaster'] };
    case 'slots.keyslot': {
      const slot = slotOf(input);
      return { ...base, httpStatus: 200, body: { key: input, hashTag: input.match(/\{(.+?)\}/)?.[1] ?? null, slot, node: nodeOf(slot) }, keys: [], commands: [`CLUSTER KEYSLOT ${input}`] };
    }
    default:
      return { ...base, httpStatus: 200, body: { ok: true, note: 'stubbed' }, keys: [], commands: [`(${moduleId}.${opId})`] };
  }
}

export interface ShowcaseEvent { id: number; ts: number; at: string; mode: Mode; kind: 'health' | 'error'; text: string }

const AMBIENT: Array<Omit<ShowcaseEvent, 'id' | 'at' | 'ts'>> = [
  { mode: 'cluster', kind: 'health', text: 'health degraded (latency 132 ms on 127.0.0.1:7002)' },
  { mode: 'cluster', kind: 'health', text: 'health healthy' },
  { mode: 'standalone', kind: 'error', text: "pubsub-handler: handler for 'orders.created' threw TypeError" },
  { mode: 'sentinel', kind: 'error', text: 'lock-release: release of job:42 failed (token mismatch)' },
];

/** Stub for the /api/events SSE stream plus status, with a fake failover. */
export function useStubLive() {
  const [status, setStatus] = useState(INITIAL_STATUS);
  const [events, setEvents] = useState<ShowcaseEvent[]>([]);
  const nextId = useRef(0);
  const push = (e: Omit<ShowcaseEvent, 'id' | 'at' | 'ts'>) =>
    setEvents((prev) => [{ ...e, id: ++nextId.current, ts: Date.now(), at: new Date().toLocaleTimeString() }, ...prev].slice(0, 200));

  useEffect(() => {
    const t = setInterval(() => push(AMBIENT[Math.floor(Math.random() * AMBIENT.length)]), 6000);
    return () => clearInterval(t);
  }, []);

  const simulateFailover = () => {
    const set = (patch: Partial<ModeStatus>) => setStatus((s) => ({ ...s, sentinel: { ...s.sentinel, ...patch } }));
    push({ mode: 'sentinel', kind: 'health', text: 'SENTINEL FAILOVER mymaster requested' });
    set({ health: 'degraded', latencyMs: 380, failoverReady: false });
    setTimeout(() => {
      push({ mode: 'sentinel', kind: 'error', text: 'connection: All sentinels are unreachable. Retrying from scratch after 10ms.' });
      set({ health: 'unhealthy', latencyMs: 1000 });
    }, 900);
    setTimeout(() => {
      push({ mode: 'sentinel', kind: 'health', text: 'health healthy; master is now 127.0.0.1:6381' });
      set({ health: 'healthy', latencyMs: 0.7, detail: ['master 127.0.0.1:6381', 'replica 127.0.0.1:6380 syncing', 'quorum OK 3/3'] });
    }, 3200);
    setTimeout(() => {
      push({ mode: 'sentinel', kind: 'health', text: 'replica link ok; failoverReady' });
      set({ failoverReady: true, detail: ['master 127.0.0.1:6381', 'replica 127.0.0.1:6380 link ok', 'quorum OK 3/3'] });
    }, 7000);
  };

  return { status, events, simulateFailover };
}

// Token classes only (see the showcase tokens in app/globals.css).
export const healthDot: Record<Health, string> = {
  healthy: 'bg-success', degraded: 'bg-warning', unhealthy: 'bg-destructive',
};
export const healthText: Record<Health, string> = {
  healthy: 'text-success', degraded: 'text-warning', unhealthy: 'text-destructive',
};
export const modeText: Record<Mode, string> = {
  standalone: 'text-mode-standalone', sentinel: 'text-mode-sentinel', cluster: 'text-mode-cluster',
};
export const modeBorder: Record<Mode, string> = {
  standalone: 'border-t-mode-standalone', sentinel: 'border-t-mode-sentinel', cluster: 'border-t-mode-cluster',
};
