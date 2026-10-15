// The Redis trace of one request, for the Redis-state panel: every command the package sent while the request ran, the
// node it went to, and afterwards each touched key's type and TTL (plus slot and node on cluster). Commands are recorded
// in ioredis's `Redis#sendCommand`, the one place every command passes on its way to a node (a cluster sends through
// its node connections), and scoped to the request with AsyncLocalStorage, so concurrent requests never mix.
import { AsyncLocalStorage } from 'node:async_hooks';
import type { RedisTrace, TracedKey } from '@showcase/contracts';
import { Command, Redis } from 'ioredis';
import type { RedisClient } from 'ioredis-toolkit';

/** Enough for any one operation to show in full; `clear` on a big namespace is cut, and says so. */
const MAX_COMMANDS = 100;
const MAX_KEYS = 50;
const MAX_ARG_CHARS = 200;

/** TYPE and TTL in one round trip, on whichever node owns the key. */
const INSPECT = "return { redis.call('TYPE', KEYS[1]).ok, redis.call('TTL', KEYS[1]) }";

interface Sent {
  command: Command;
  node: string | null;
}

export interface TraceRecording {
  /** Runs `fn` with every command it sends recorded into this recording. */
  run(fn: () => void): void;
  /** Stops recording, inspects the touched keys, and returns the trace. */
  finish(client: RedisClient, options: { cluster: boolean }): Promise<RedisTrace>;
}

const storage = new AsyncLocalStorage<{ sent: Map<Command, Sent>; open: boolean }>();

// Keyed by command, so a command ioredis sends again (from the offline queue, or after a MOVED) is listed once, with
// the node it finally went to.
const sendCommand = Redis.prototype.sendCommand;
Redis.prototype.sendCommand = function (this: Redis, command, stream) {
  const recording = storage.getStore();
  if (recording?.open) recording.sent.set(command, { command, node: address(this) });
  return sendCommand.call(this, command, stream);
};

function address(redis: Redis): string | null {
  const { remoteAddress, remotePort } = redis.stream ?? {};
  return remoteAddress ? `${remoteAddress}:${remotePort}` : null;
}

const text = (arg: unknown) => {
  const s = Buffer.isBuffer(arg) ? arg.toString() : String(arg);
  return s.length > MAX_ARG_CHARS ? `${s.slice(0, MAX_ARG_CHARS)}…` : s;
};

async function inspect(client: RedisClient, key: string): Promise<Pick<TracedKey, 'type' | 'ttl'>> {
  try {
    const [type, ttl] = (await client.eval(INSPECT, 1, key)) as [string, number];
    return { type, ttl: ttl >= 0 ? ttl : null };
  } catch {
    return { type: 'unknown', ttl: null };
  }
}

export function startTrace(): TraceRecording {
  const recording = { sent: new Map<Command, Sent>(), open: true };
  return {
    run: (fn) => storage.run(recording, fn),
    async finish(client, { cluster }) {
      recording.open = false;
      const sent = [...recording.sent.values()];

      // The node each key was last sent to: on cluster, the node that owns its slot.
      const nodes = new Map<string, string | null>();
      for (const { command, node } of sent) for (const key of command.getKeys()) nodes.set(text(key), node);
      const touched = [...nodes].slice(0, MAX_KEYS);

      const keys = await Promise.all(
        touched.map(async ([key, node]) => ({
          key,
          ...(await inspect(client, key)),
          ...(cluster && { slot: new Command('exists', [key]).getSlot(), node: node ?? undefined }),
        })),
      );
      const trace: RedisTrace = {
        commands: sent.slice(0, MAX_COMMANDS).map(({ command, node }) => ({ name: command.name, args: command.args.map(text), node })),
        keys,
      };
      if (sent.length > MAX_COMMANDS || nodes.size > MAX_KEYS) {
        trace.omitted = { commands: Math.max(0, sent.length - MAX_COMMANDS), keys: Math.max(0, nodes.size - MAX_KEYS) };
      }
      return trace;
    },
  };
}
