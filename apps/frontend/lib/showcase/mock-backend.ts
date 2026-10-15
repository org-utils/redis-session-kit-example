// Mock backend: in-memory stand-ins for the Fastify API's operation results until each section's real routes exist.
// Everything here is fake; replace with calls to /api/:mode/.... (Status and the event log are live: see live.ts; the
// cache section runs for real: see api.ts.)
import type { Mode } from '@showcase/contracts';
import type { KeyTouched, RunResult } from './api';
import type { Values } from './examples';
import type { ModeView } from './live';
import {
  ArrowLeftRight, Eye, Gauge, Grid3x3, KeyRound, Layers, Lock, Network, Plug, Radio, Server, Waves, type LucideIcon,
} from 'lucide-react';

export type ModuleKind = 'feature' | 'mode-specific';
export interface Op { id: string; label: string }
export interface ShowcaseModule {
  id: string; label: string; kind: ModuleKind; onlyMode?: Mode; blurb: string; ops: Op[];
  /** Runs against the real backend (api.ts) rather than the stand-ins below; Reset section deletes `<namespace>:*`. */
  live?: { namespace: string };
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
  { id: 'cache', label: 'Cache', kind: 'feature', live: { namespace: 'showcase:cache' }, blurb: 'JSON values with TTL and conditional writes.',
    ops: ['set', 'get', 'has', 'ttl', 'setIfAbsent', 'delete', 'clear'].map((id) => ({ id, label: id })) },
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

let runId = 0;
const err = (code: string, name: string, message: string, mode: Mode) => ({ error: { code, name, message, mode } });

export function runOp(mode: Mode, moduleId: string, opId: string, v: Values, status: ModeView): RunResult {
  const input = Object.values(v).map(String).join(' · ');
  const base = { id: ++runId, at: new Date().toLocaleTimeString(), mode, module: moduleId, op: opId, input,
    latencyMs: +((status.latencyMs ?? 1) * (1 + Math.random())).toFixed(2) };
  const k = (key: string, type: string, ttl: number | null): KeyTouched =>
    mode === 'cluster' ? { key, type, ttl, slot: slotOf(key), node: nodeOf(slotOf(key)) } : { key, type, ttl };
  const ok = (body: unknown, keys: KeyTouched[], commands: string[], httpStatus = 200): RunResult => ({ ...base, httpStatus, body, keys, commands });
  const fail = (httpStatus: number, code: string, name: string, message: string, commands: string[] = []): RunResult =>
    ({ ...base, httpStatus, body: err(code, name, message, mode), keys: [], commands });

  if (!status.available) return fail(503, 'MODE_UNAVAILABLE', 'ModeUnavailableError', `${mode} is unavailable`);

  switch (`${moduleId}.${opId}`) {
    case 'client.health': {
      const latency = status.latencyMs ?? 0;
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
    default:
      return ok({ ok: true, note: 'stubbed' }, [], [`(${moduleId}.${opId})`]);
  }
}

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
