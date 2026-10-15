// What the status monitor checks per mode: the mode client's own `health()`, plus on sentinel what every sentinel says
// and on cluster `cluster_state` and the slot map. The package's facade has no SENTINEL or CLUSTER commands, so those
// extras come from small probe connections of our own, one per sentinel or seed node.
import type { ClusterStatus, Mode, SentinelStatus } from '@showcase/contracts';
import { Redis } from 'ioredis';
import type { RedisClient } from 'ioredis-toolkit';
import type { Config } from '../config/index.ts';
import type { ModeClients } from './mode-clients.ts';
import { PROBE_NAME, pairs, type Address } from './own-connections.ts';
import type { ModeCheck } from './status-monitor.ts';

const HEALTH_TIMEOUT_MS = 500;

export interface ModeChecks {
  checks: Map<Mode, ModeCheck>;
  /** Disconnects the probe connections (Redis 8 sentinels reject QUIT). */
  close(): void;
}

const message = (error: unknown) => (error instanceof Error ? error.message : String(error));

/** A connection that never holds a command longer than the health check would: an unreachable node fails fast. */
function probe({ host, port }: Address): Redis {
  const redis = new Redis({
    host, port, connectionName: PROBE_NAME, commandTimeout: HEALTH_TIMEOUT_MS, maxRetriesPerRequest: 0, retryStrategy: () => 1000,
  });
  redis.on('error', () => {}); // an unreachable node shows in the status itself
  return redis;
}

async function sentinelStatus(sentinels: Redis[], addresses: Address[], name: string): Promise<SentinelStatus> {
  const answers = await Promise.all(
    sentinels.map((sentinel) =>
      Promise.allSettled([
        sentinel.call('SENTINEL', 'GET-MASTER-ADDR-BY-NAME', name) as Promise<[string, string] | null>,
        sentinel.call('SENTINEL', 'CKQUORUM', name) as Promise<string>,
        sentinel.call('SENTINEL', 'REPLICAS', name) as Promise<string[][]>,
      ]),
    ),
  );
  const reports = answers.map(([master, quorum, replicas], i) => {
    const usable = quorum.status === 'fulfilled' ? /^OK (\d+) /.exec(quorum.value)?.[1] : undefined;
    const failed = [master, quorum, replicas].find((r) => r.status === 'rejected');
    return {
      master: master.status === 'fulfilled' && master.value ? `${master.value[0]}:${master.value[1]}` : null,
      address: `${addresses[i].host}:${addresses[i].port}`,
      quorum: quorum.status === 'fulfilled' ? quorum.value : message(quorum.reason),
      quorumOk: Number(usable) === sentinels.length,
      replicas:
        replicas.status === 'fulfilled'
          ? replicas.value.map(pairs).map((r) => ({ address: `${r.ip}:${r.port}`, flags: r.flags, masterLinkStatus: r['master-link-status'] }))
          : [],
      ...(failed && { error: message(failed.reason) }),
    };
  });
  return {
    master: reports.find((r) => r.master)?.master ?? null,
    sentinels: reports.map(({ master: _, ...report }) => report),
    failoverReady: reports.every(
      (r) => r.quorumOk && r.replicas.some((replica) => replica.flags === 'slave' && replica.masterLinkStatus === 'ok'),
    ),
  };
}

/** CLUSTER INFO and CLUSTER SLOTS from the first seed node that answers. */
async function clusterStatus(nodes: Redis[]): Promise<ClusterStatus> {
  for (const node of nodes) {
    try {
      const [info, slots] = await Promise.all([
        node.call('CLUSTER', 'INFO') as Promise<string>,
        node.call('CLUSTER', 'SLOTS') as Promise<[number, number, [string, number, ...unknown[]], ...unknown[]][]>,
      ]);
      return {
        state: /^cluster_state:(\S+)/m.exec(info)?.[1] ?? null,
        slots: slots
          .map(([start, end, [host, port]]) => ({ start, end, master: `${host}:${port}` }))
          .sort((a, b) => a.start - b.start),
      };
    } catch {
      // try the next seed node
    }
  }
  return { state: null, slots: [] };
}

export function createModeChecks(clients: ModeClients, config: Config): ModeChecks {
  const probes: Redis[] = [];
  const open = (addresses: Address[]) => {
    const opened = addresses.map(probe);
    probes.push(...opened);
    return opened;
  };
  const health = (client: RedisClient) => client.health({ timeoutMs: HEALTH_TIMEOUT_MS });

  const checks = new Map<Mode, ModeCheck>();
  for (const [mode, client] of clients) {
    if (mode === 'sentinel') {
      const sentinels = open(config.REDIS_SENTINELS);
      checks.set(mode, async () => {
        const [modeHealth, sentinel] = await Promise.all([
          health(client),
          sentinelStatus(sentinels, config.REDIS_SENTINELS, config.REDIS_SENTINEL_NAME),
        ]);
        return { health: modeHealth, sentinel };
      });
    } else if (mode === 'cluster') {
      const nodes = open(config.REDIS_CLUSTER_NODES);
      checks.set(mode, async () => {
        const [modeHealth, cluster] = await Promise.all([health(client), clusterStatus(nodes)]);
        return { health: modeHealth, cluster };
      });
    } else {
      checks.set(mode, async () => ({ health: await health(client) }));
    }
  }
  return { checks, close: () => probes.forEach((p) => p.disconnect()) };
}
