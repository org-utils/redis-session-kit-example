// The module catalogue (MODULES, with each feature module's namespace for Reset section) and its icons, plus the slot
// helpers the slots section's stand-in still uses. Every feature module operation runs for real: see api.ts; status and
// the event log are live: see live.ts.
import type { Mode } from '@showcase/contracts';
import {
  ArrowLeftRight, Eye, Gauge, Grid3x3, KeyRound, Layers, Lock, Network, Plug, Radio, Server, Waves, type LucideIcon,
} from 'lucide-react';

export type ModuleKind = 'feature' | 'mode-specific';
export interface Op { id: string; label: string }
export interface ShowcaseModule {
  id: string; label: string; kind: ModuleKind; onlyMode?: Mode; blurb: string; ops: Op[];
  /** The module's keys, which Reset section deletes (`<namespace>:*`); modules without one have no Reset. */
  namespace?: string;
}

/** The session operations, in the order the section's tabs show them. */
export const SESSION_OPS = [
  'create', 'validate', 'get', 'touch', 'update', 'rotate', 'revoke', 'destroy', 'setSecurityVersion', 'revokeAll', 'list',
];

export const MODULES: ShowcaseModule[] = [
  { id: 'client', label: 'Client', kind: 'feature', blurb: 'Config validation, namespaces, raw commands, health, shutdown.',
    ops: [
      { id: 'health', label: 'health()' },
      { id: 'validate', label: 'config validation' },
      { id: 'collide', label: 'namespace collision' },
      { id: 'with', label: 'with*() overrides' },
      { id: 'raw', label: 'raw commands' },
      { id: 'shutdown', label: 'shutdown' },
    ] },
  { id: 'session', label: 'Session', kind: 'feature', namespace: 'showcase:session', blurb: 'Opaque credentials in a cookie, encrypted records, expiry, rotation and revocation.',
    ops: SESSION_OPS.map((id) => ({ id, label: id })) },
  { id: 'cache', label: 'Cache', kind: 'feature', namespace: 'showcase:cache', blurb: 'JSON values with TTL and conditional writes.',
    ops: ['set', 'get', 'has', 'ttl', 'setIfAbsent', 'delete', 'clear'].map((id) => ({ id, label: id })) },
  { id: 'lock', label: 'Lock', kind: 'feature', namespace: 'showcase:lock', blurb: 'Ownership-token leases.',
    ops: [
      { id: 'acquire', label: 'acquire' },
      { id: 'extend', label: 'extend' },
      { id: 'release', label: 'release' },
      { id: 'using', label: 'using' },
    ] },
  { id: 'rate-limit', label: 'Rate limit', kind: 'feature', namespace: 'showcase:rate-limit', blurb: 'Atomic fixed-window counters.',
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
  { id: 'streams', label: 'Streams', kind: 'feature', namespace: 'showcase:stream', blurb: 'Append, consumer groups, reads, acks.',
    ops: ['createGroup', 'add', 'read', 'ack', 'delete', 'length'].map((id) => ({ id, label: id })) },
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
