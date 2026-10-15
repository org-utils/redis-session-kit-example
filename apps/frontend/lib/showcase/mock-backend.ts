// Mock backend: in-memory stand-ins for the Fastify API (mode status, the event log, operation results) until the
// real backend exists. Everything here is fake; replace with calls to /api/:mode/... and /api/events.
'use client';

import { useEffect, useRef, useState } from 'react';
import type { Values } from './examples';
import {
  ArrowLeftRight, Eye, Gauge, Grid3x3, KeyRound, Layers, Lock, Network, Plug, Radio, Server, Waves, type LucideIcon,
} from 'lucide-react';

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
export interface Op { id: string; label: string }
export interface ShowcaseModule {
  id: string; label: string; kind: ModuleKind; onlyMode?: Mode; blurb: string; ops: Op[];
}

export const MODULES: ShowcaseModule[] = [
  { id: 'client', label: 'Client', kind: 'feature', blurb: 'Config validation, namespaces, raw commands, health, shutdown.',
    ops: [
      { id: 'health', label: 'health()' },
      { id: 'collide', label: 'namespace collision' },
      { id: 'mget', label: 'raw mget' },
    ] },
  { id: 'session', label: 'Session', kind: 'feature', blurb: 'Opaque credentials, rotation chains, replay, revoke, expiry.',
    ops: ['create', 'validate', 'get', 'touch', 'update', 'rotate', 'revoke', 'destroy', 'setSecurityVersion', 'revokeAll', 'list'].map((id) => ({ id, label: id })) },
  { id: 'cache', label: 'Cache', kind: 'feature', blurb: 'JSON values with TTL and conditional writes.',
    ops: [
      { id: 'set', label: 'set' },
      { id: 'get', label: 'get' },
      { id: 'clear', label: 'clear' },
    ] },
  { id: 'lock', label: 'Lock', kind: 'feature', blurb: 'Ownership-token leases.',
    ops: [
      { id: 'acquire', label: 'acquire' },
      { id: 'extend', label: 'extend' },
      { id: 'release', label: 'release' },
      { id: 'using', label: 'using' },
    ] },
  { id: 'rate-limit', label: 'Rate limit', kind: 'feature', blurb: 'Atomic fixed-window counters.',
    ops: [
      { id: 'consume', label: 'consume' },
      { id: 'check', label: 'check' },
      { id: 'reset', label: 'reset' },
      { id: 'burst', label: 'burst' },
    ] },
  { id: 'pubsub', label: 'Pub/Sub', kind: 'feature', blurb: 'JSON fan-out over a dedicated subscriber.',
    ops: [
      { id: 'subscribe', label: 'subscribe' },
      { id: 'publish', label: 'publish' },
    ] },
  { id: 'streams', label: 'Streams', kind: 'feature', blurb: 'Append, consumer groups, reads, acks.',
    ops: [
      { id: 'createGroup', label: 'createGroup' },
      { id: 'add', label: 'add' },
      { id: 'read', label: 'read' },
      { id: 'ack', label: 'ack' },
    ] },
  { id: 'failover', label: 'Failover', kind: 'mode-specific', onlyMode: 'sentinel', blurb: 'Move the master 6380 → 6381 and watch.',
    ops: [{ id: 'drill', label: 'failover drill' }] },
  { id: 'slots', label: 'Slots', kind: 'mode-specific', onlyMode: 'cluster', blurb: 'Key → hash slot → node, hash tags, fan-out.',
    ops: [{ id: 'inspect', label: 'key inspector' }] },
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
const err = (code: string, name: string, message: string, mode: Mode) => ({ error: { code, name, message, mode } });

export function runOp(mode: Mode, moduleId: string, opId: string, v: Values, status: ModeStatus): RunResult {
  const ns = `showcase:${moduleId === 'pubsub' ? 'events' : moduleId === 'streams' ? 'stream' : moduleId}`;
  const input = Object.values(v).map(String).join(' · ');
  const base = { id: ++runId, at: new Date().toLocaleTimeString(), mode, module: moduleId, op: opId, input,
    latencyMs: +(status.latencyMs * (1 + Math.random())).toFixed(2) };
  const k = (key: string, type: string, ttl: number | null): KeyTouched =>
    mode === 'cluster' ? { key, type, ttl, slot: slotOf(key), node: nodeOf(slotOf(key)) } : { key, type, ttl };
  const ok = (body: unknown, keys: KeyTouched[], commands: string[], httpStatus = 200): RunResult => ({ ...base, httpStatus, body, keys, commands });
  const fail = (httpStatus: number, code: string, name: string, message: string, commands: string[] = []): RunResult =>
    ({ ...base, httpStatus, body: err(code, name, message, mode), keys: [], commands });

  if (status.health === 'unhealthy') return fail(503, 'MODE_UNAVAILABLE', 'ModeUnavailable', `${mode} has been unhealthy for 3 checks`);

  switch (`${moduleId}.${opId}`) {
    case 'client.health': {
      const latency = status.latencyMs;
      const st = latency > Number(v.degradedMs) ? 'degraded' : status.health;
      return ok(mode === 'cluster'
        ? { status: st, latencyMs: 1.4, nodes: ['7001', '7002', '7003'].map((p) => ({ address: `127.0.0.1:${p}`, status: 'healthy', latencyMs: 1.1 })) }
        : { status: st, latencyMs: latency }, [], mode === 'cluster' ? ['PING → 7001', 'PING → 7002', 'PING → 7003'] : ['PING']);
    }
    case 'client.collide': {
      const a = String(v.cache), c = String(v.sessions);
      const collide = a === c || a.startsWith(`${c}:`) || c.startsWith(`${a}:`);
      return collide
        ? fail(500, 'REDIS_CONFIGURATION', 'RedisConfigurationError', `Namespaces "${c}" (sessions) and "${a}" (cache) overlap`)
        : ok({ created: true, config: { cache: { namespace: a }, sessions: { namespace: c } } }, [], []);
    }
    case 'client.mget': {
      const keys = String(v.keys).split(',').map((x) => x.trim()).filter(Boolean);
      const sameSlot = new Set(keys.map(slotOf)).size <= 1;
      if (mode === 'cluster' && !sameSlot) return fail(502, 'CROSSSLOT', 'ReplyError', "CROSSSLOT Keys in request don't hash to the same slot", [`MGET ${keys.join(' ')}`]);
      return ok(keys.map(() => null), keys.map((x) => k(x, 'none', null)), [`MGET ${keys.join(' ')}`]);
    }
    case 'session.create': {
      if (String(v.metadata).length > 200) return fail(413, 'SESSION_LIMIT', 'SessionLimitError', 'metadata exceeds maxMetadataBytes (8192)');
      const u = 'a3f9…c21e';
      return ok({ token: 'kq3J…x9Q', session: { userId: v.userId, deviceId: v.deviceId, jti: 'j_7f2a', version: 1, status: 'active' },
        setCookie: `showcase_session_${mode}=kq3J…x9Q; Path=/; HttpOnly; SameSite=Lax` },
        [k(`showcase:session:session:{${u}}:9be1…`, 'string', 2592000), k(`showcase:session:user-sessions:{${u}}`, 'zset', 2592000), k('showcase:session:token-index:9be1…', 'string', 2592000)],
        ['EVALSHA create.lua 3 …']);
    }
    case 'session.rotate':
      if (String(v.token).includes('previous')) return fail(409, 'SESSION_REPLAY', 'SessionReplayError', 'credential belongs to a consumed session', ['EVALSHA rotate.lua …']);
      return ok({ token: 'Pz8w…3Lk', previousJti: 'j_7f2a', session: { jti: 'j_91bc', status: 'active' } }, [], ['EVALSHA rotate.lua …']);
    case 'session.revokeAll': {
      const lim = Number(v.limit);
      return ok({ affected: Math.min(lim, 2), remaining: Math.max(0, 2 - lim) }, [], ['ZRANGE …', 'EVALSHA revoke.lua …']);
    }
    case 'cache.set': {
      const exists = String(v.key) === 'user:42';
      const written = v.condition === 'nx' ? !exists : v.condition === 'xx' ? exists : true;
      return ok(written, written ? [k(`${ns}:${v.key}`, 'string', Number(v.ttl))] : [],
        [`SET ${ns}:${v.key} ${json(v.value)} EX ${v.ttl}${v.condition !== 'none' ? ` ${String(v.condition).toUpperCase()}` : ''}`]);
    }
    case 'cache.get':
      return String(v.key) === 'user:42'
        ? ok({ hit: true, value: { id: '42', name: 'Ada' } }, [k(`${ns}:${v.key}`, 'string', 287)], [`GET ${ns}:${v.key}`])
        : ok({ hit: false }, [], [`GET ${ns}:${v.key}`]);
    case 'cache.clear':
      return ok(3, [], mode === 'cluster' ? ['SCAN on 7001', 'SCAN on 7002', 'SCAN on 7003', 'DEL (grouped by slot)'] : [`SCAN 0 MATCH ${ns}:${v.pattern} COUNT 100`, 'DEL …']);
    default:
      return ok({ ok: true, note: 'stubbed' }, [], [`(${moduleId}.${opId})`]);
  }
}

function json(s: unknown) { try { return JSON.stringify(JSON.parse(String(s))); } catch { return String(s); } }

export interface ShowcaseEvent { id: number; ts: number; at: string; mode: Mode; kind: 'health' | 'error'; text: string }

const AMBIENT: Array<Omit<ShowcaseEvent, 'id' | 'at' | 'ts'>> = [
  { mode: 'cluster', kind: 'health', text: 'health degraded (latency 132 ms on 127.0.0.1:7002)' },
  { mode: 'cluster', kind: 'health', text: 'health healthy' },
  { mode: 'standalone', kind: 'error', text: "pubsub-handler: handler for 'orders.created' threw TypeError" },
  { mode: 'sentinel', kind: 'error', text: 'lock-release: release of job:42 failed (token mismatch)' },
];

/** Stub for the /api/events SSE stream plus status. */
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


  return { status, events };
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

export const MODE_ICON: Record<Mode, LucideIcon> = { standalone: Server, sentinel: Eye, cluster: Network };
export const MODULE_ICON: Record<string, LucideIcon> = {
  client: Plug, session: KeyRound, cache: Layers, lock: Lock, 'rate-limit': Gauge, pubsub: Radio, streams: Waves,
  failover: ArrowLeftRight, slots: Grid3x3,
};
