// Mock cluster data for the slots section until the real backend exists. Slots are real (CRC16 of the hashed part);
// the node overview and the run results are made up. The real backend asks Redis (CLUSTER KEYSLOT, CLUSTER SHARDS).
import { nodeOf, slotOf } from './mock-backend';

export const NODES = [
  { address: '127.0.0.1:7001', port: '7001', from: 0, to: 5460 },
  { address: '127.0.0.1:7002', port: '7002', from: 5461, to: 10922 },
  { address: '127.0.0.1:7003', port: '7003', from: 10923, to: 16383 },
];

export function parseKeys(s: string): string[] {
  return s.split(/[\n,]/).map((k) => k.trim()).filter(Boolean);
}

/** The hashed part: the first non-empty {...}, else the whole key. */
export function hashed(key: string): { before: string; tag: string | null; after: string } {
  const open = key.indexOf('{');
  if (open >= 0) {
    const close = key.indexOf('}', open + 1);
    if (close > open + 1) return { before: key.slice(0, open + 1), tag: key.slice(open + 1, close), after: key.slice(close) };
  }
  return { before: '', tag: null, after: key };
}

export interface KeyInfo { key: string; slot: number; node: string }
export interface Group { slot: number; node: string; keys: string[] }

export function inspect(keys: string[]) {
  const infos: KeyInfo[] = keys.map((key) => { const slot = slotOf(key); return { key, slot, node: nodeOf(slot) }; });
  const bySlot = new Map<number, Group>();
  for (const k of infos) {
    const g = bySlot.get(k.slot) ?? { slot: k.slot, node: k.node, keys: [] };
    g.keys.push(k.key); bySlot.set(k.slot, g);
  }
  const groups = [...bySlot.values()];
  const nodes = new Set(groups.map((g) => g.node));
  return { infos, groups, sameSlot: groups.length <= 1, nodeCount: nodes.size };
}

export type RunKind = 'mget' | 'mgetClusterAware' | 'eval';
export function runOn(kind: RunKind, keys: string[]) {
  const r = inspect(keys);
  if (kind === 'mgetClusterAware') {
    return { ok: true, command: `redis.mgetClusterAware(${keys.map((k) => `'${k}'`).join(', ')})`,
      sent: r.groups.map((g) => `MGET ${g.keys.join(' ')}  → ${g.node.split(':')[1]} (slot ${g.slot})`), result: keys.map(() => null) };
  }
  const command = kind === 'mget' ? `redis.mget(${keys.map((k) => `'${k}'`).join(', ')})`
    : `redis.eval("return {redis.call('GET', KEYS[1]), redis.call('GET', KEYS[2])}", 2, '${keys[0]}', '${keys[1] ?? keys[0]}')`;
  const sent = [kind === 'mget' ? `MGET ${keys.join(' ')}` : `EVAL … 2 ${keys[0]} ${keys[1] ?? keys[0]}`];
  const evalSame = kind === 'eval' && slotOf(keys[0]) === slotOf(keys[1] ?? keys[0]);
  if (r.sameSlot || evalSame) return { ok: true, command, sent, result: keys.map(() => null) };
  return { ok: false, command, sent, error: "CROSSSLOT Keys in request don't hash to the same slot" };
}

export interface NodeOverview {
  address: string; port: string; from: number; to: number; keys: number;
  namespaces: Record<string, number>;
  clients: { name: string; count: number; note?: string }[];
}

export const OVERVIEW: NodeOverview[] = [
  { ...NODES[0], keys: 14, namespaces: { 'showcase:cache': 6, 'showcase:session': 5, 'showcase:rate-limit': 1, 'showcase:stream': 1, 'showcase:lock': 1 },
    clients: [{ name: 'mode client', count: 1 }, { name: 'pub/sub subscriber', count: 1, note: 'pinned here by ioredis (random node)' }, { name: 'stream readers', count: 2, note: 'each read leases a whole Cluster client' }] },
  { ...NODES[1], keys: 9, namespaces: { 'showcase:cache': 4, 'showcase:session': 3, 'showcase:rate-limit': 2 },
    clients: [{ name: 'mode client', count: 1 }, { name: 'stream readers', count: 2 }] },
  { ...NODES[2], keys: 11, namespaces: { 'showcase:cache': 5, 'showcase:session': 4, 'showcase:stream': 1, 'showcase:lock': 1 },
    clients: [{ name: 'mode client', count: 1 }, { name: 'stream readers', count: 2 }] },
];
