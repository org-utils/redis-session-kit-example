// The slots section's data: where keys land and what each node holds, asked of the real cluster through
// /api/cluster/slots (CLUSTER KEYSLOT, CLUSTER SHARDS, DBSIZE, SCAN, CLIENT LIST). Nothing is computed here but which
// part of a key Redis hashes, to highlight it.
import { SlotsOverviewSchema, type ClientRawRequestSchema, type SlotsOverview } from '@showcase/contracts';
import type { z } from 'zod';

export function parseKeys(s: string): string[] {
  return s.split(/[\n,]/).map((k) => k.trim()).filter(Boolean);
}

/** The hashed part, for highlighting: the first non-empty {...}, else the whole key. */
export function hashed(key: string): { before: string; tag: string | null; after: string } {
  const open = key.indexOf('{');
  if (open >= 0) {
    const close = key.indexOf('}', open + 1);
    if (close > open + 1) return { before: key.slice(0, open + 1), tag: key.slice(open + 1, close), after: key.slice(close) };
  }
  return { before: '', tag: null, after: key };
}

/** Each master's ranges, key counts, namespaces and connections: on demand, since it scans every node. */
export async function fetchOverview(): Promise<SlotsOverview> {
  const res = await fetch('/api/cluster/slots/overview');
  if (!res.ok) throw new Error(`overview: ${res.status} ${await res.text()}`);
  return SlotsOverviewSchema.parse(await res.json());
}

/** The run buttons: raw multi-key commands on the keys, through the client section's raw route. */
export type RunKind = 'mget' | 'mgetClusterAware' | 'eval';
const TWO_KEY_SCRIPT = "return {redis.call('GET', KEYS[1]), redis.call('GET', KEYS[2])}";
export function runBody(kind: RunKind, keys: string[]): z.input<typeof ClientRawRequestSchema> {
  return kind === 'eval' ? { command: 'eval', script: TWO_KEY_SCRIPT, keys: keys.slice(0, 2), args: [] } : { command: kind, keys };
}
