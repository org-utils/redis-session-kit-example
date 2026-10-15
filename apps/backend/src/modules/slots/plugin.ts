// The slots mode-specific module, registered on cluster only under /api/cluster/slots: where keys land (asked of Redis,
// not computed here) and what each master holds. The package's slot helpers aren't public, so these are native CLUSTER,
// DBSIZE, SCAN and CLIENT LIST commands on connections of the showcase's own.
import { SlotsInspectRequestSchema, type ClientKind, type SlotsInspectResult, type SlotsOverview } from '@showcase/contracts';
import type { Redis } from 'ioredis';
import type { ModeSpecificModule } from '../../app.ts';
import { firstReachable, oneOff, pairs, PROBE_NAME } from '../../redis/own-connections.ts';
import { untraced } from '../../redis/redis-trace.ts';

type Shard = SlotsInspectResult['shards'][number];
type Node = SlotsOverview['nodes'][number];

/** Enough to show what each namespace holds; a node with more is reported as truncated. */
const SCAN_LIMIT = 10_000;
const CLIENT_KINDS: ClientKind[] = ['subscriber', 'blocked read', 'ioredis', 'showcase probe', 'other'];

/** CLIENT LIST line → `{ id: '7', flags: 'N', … }`. A value can itself hold `=`, so each pair splits at the first. */
function clientFields(line: string): Record<string, string> {
  return Object.fromEntries(line.split(' ').map((pair) => {
    const at = pair.indexOf('=');
    return [pair.slice(0, at), pair.slice(at + 1)];
  }));
}

function clientKind(client: Record<string, string>): ClientKind {
  if (Number(client.sub) + Number(client.psub) + Number(client.ssub ?? 0) > 0) return 'subscriber';
  if (client.flags?.includes('b')) return 'blocked read';
  if (client.name === PROBE_NAME) return 'showcase probe';
  return client['lib-name'] === 'ioredis' ? 'ioredis' : 'other';
}

/** Each master and its slot ranges, from CLUSTER SHARDS, by address. */
async function shardsOf(redis: Redis): Promise<Shard[]> {
  const reply = (await redis.call('CLUSTER', 'SHARDS')) as unknown[][];
  const shards = reply.map((entry) => {
    const shard = pairs<unknown>(entry);
    const flat = (shard.slots as number[]).map(Number);
    const slots = [];
    for (let i = 0; i < flat.length; i += 2) slots.push({ start: flat[i], end: flat[i + 1] });
    const master = (shard.nodes as unknown[][]).map((n) => pairs<string>(n)).find((n) => n.role === 'master');
    // `endpoint` can be empty or `?` (no preferred endpoint announced): the ip is then where it listens.
    const host = master && (master.endpoint && master.endpoint !== '?' ? master.endpoint : master.ip);
    return { node: master ? `${host}:${master.port}` : 'unknown', slots };
  });
  return shards.sort((a, b) => a.node.localeCompare(b.node));
}

const nodeOf = (shards: Shard[], slot: number) =>
  shards.find((s) => s.slots.some((r) => slot >= r.start && slot <= r.end))?.node ?? 'unknown';

/** What one master holds and who is connected to it. */
async function nodeOverview({ node, slots }: Shard): Promise<Node> {
  const [host, port] = node.split(':');
  const redis = oneOff({ host, port: Number(port) });
  try {
    await redis.connect();
    const keys = Number(await redis.call('DBSIZE'));
    const namespaces: Record<string, number> = {};
    let cursor = '0';
    let scanned = 0;
    do {
      const [next, batch] = (await redis.call('SCAN', cursor, 'MATCH', 'showcase:*', 'COUNT', '500')) as [string, string[]];
      for (const key of batch) {
        const namespace = key.split(':').slice(0, 2).join(':');
        namespaces[namespace] = (namespaces[namespace] ?? 0) + 1;
      }
      scanned += batch.length;
      cursor = next;
    } while (cursor !== '0' && scanned < SCAN_LIMIT);

    // Every connection on this node but this one, by kind.
    const self = String(await redis.call('CLIENT', 'ID'));
    const list = String(await redis.call('CLIENT', 'LIST'));
    const counts = new Map<ClientKind, number>();
    for (const line of list.split('\n').filter(Boolean)) {
      const client = clientFields(line);
      if (client.id === self) continue;
      const kind = clientKind(client);
      counts.set(kind, (counts.get(kind) ?? 0) + 1);
    }
    const clients = CLIENT_KINDS.filter((kind) => counts.has(kind)).map((kind) => ({ kind, count: counts.get(kind)! }));
    return { address: node, slots, keys, namespaces, truncated: cursor !== '0', clients };
  } catch (error) {
    return { address: node, slots, keys: 0, namespaces: {}, truncated: false, clients: [], error: error instanceof Error ? error.message : String(error) };
  } finally {
    redis.disconnect();
  }
}

export const slotsModule: ModeSpecificModule = async (app, { config }) => {
  /**
   * Runs `fn` on a connection to the first seed node that answers. The connection is opened outside the trace, so its
   * handshake (CLIENT SETINFO, INFO) doesn't show among the commands that answer the request.
   */
  async function onSeed<T>(fn: (redis: Redis) => Promise<T>): Promise<T> {
    const { redis } = await untraced(() => firstReachable(config.REDIS_CLUSTER_NODES));
    try {
      return await fn(redis);
    } finally {
      redis.disconnect();
    }
  }

  // Traced: the visitor sees each CLUSTER KEYSLOT and the CLUSTER SHARDS that placed the keys.
  app.post('/inspect', { schema: { body: SlotsInspectRequestSchema } }, ({ body }) =>
    onSeed(async (redis): Promise<SlotsInspectResult> => {
      const slots: number[] = [];
      for (const key of body.keys) slots.push(Number(await redis.call('CLUSTER', 'KEYSLOT', key)));
      const shards = await shardsOf(redis);
      const keys = body.keys.map((key, i) => ({ key, slot: slots[i], node: nodeOf(shards, slots[i]) }));
      const groups: SlotsInspectResult['groups'] = [];
      for (const { key, slot, node } of keys) {
        const group = groups.find((g) => g.slot === slot);
        if (group) group.keys.push(key);
        else groups.push({ slot, node, keys: [key] });
      }
      return { keys, groups, sameSlot: groups.length === 1, shards };
    }),
  );

  // On demand, and a live view: not traced.
  app.get('/overview', async (): Promise<SlotsOverview> => {
    const shards = await onSeed(shardsOf);
    return { nodes: await Promise.all(shards.map(nodeOverview)) };
  });
};
