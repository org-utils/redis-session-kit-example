// Following a stream: one shared read loop per stream on a mode client, started by its first listener and stopped by
// its last, fanning each batch of new entries out to every listener. Each loop holds one stream reader connection
// (a whole Cluster on cluster) for as long as it runs, however many browsers follow the stream.
import { setTimeout as sleep } from 'node:timers/promises';
import type { StreamsFollowEvent } from '@showcase/contracts';
import type { RedisClient } from 'ioredis-toolkit';

/** How long each read waits for new entries: also how long a stopped loop can take to notice. */
const BLOCK_MS = 1000;
const RETRY_MS = 1000;

type Listener = (event: StreamsFollowEvent) => void;

export interface Following {
  /** The loop this listener joined, numbered from 1 per mode client: a new number means a new loop. */
  loop: number;
  /** Listeners on that loop, this one included. */
  listeners: number;
  leave(): void;
}

export interface FollowLoops {
  follow(stream: string, listener: Listener): Following;
  /** Stops every loop (the app is closing). */
  stopAll(): void;
}

interface Loop {
  id: number;
  listeners: Set<Listener>;
  stopped: boolean;
}

export function createFollowLoops(client: RedisClient): FollowLoops {
  const loops = new Map<string, Loop>();
  let lastId = 0;

  const broadcast = (loop: Loop, event: StreamsFollowEvent) => {
    for (const listener of loop.listeners) listener(event);
  };

  async function run(stream: string, loop: Loop) {
    // Entries added from now on: an explicit id rather than `$`, so nothing added between two reads is missed. Starting
    // a millisecond back may show one entry added just before, never lose one added just after.
    const [seconds, micros] = await client.time();
    let id = `${Number(seconds) * 1000 + Math.floor(Number(micros) / 1000) - 1}-0`;
    while (!loop.stopped) {
      try {
        const entries = await client.streams.read(stream, { id, count: 100, blockMs: BLOCK_MS });
        if (loop.stopped) break;
        if (entries.length) {
          id = entries.at(-1)!.id;
          broadcast(loop, { type: 'entries', entries });
        }
      } catch (error) {
        if (loop.stopped) break;
        broadcast(loop, { type: 'error', message: error instanceof Error ? error.message : String(error) });
        await sleep(RETRY_MS);
      }
    }
  }

  return {
    follow(stream, listener) {
      let loop = loops.get(stream);
      if (!loop) {
        loop = { id: ++lastId, listeners: new Set(), stopped: false };
        loops.set(stream, loop);
        const started = loop;
        void run(stream, started).catch((error) => {
          // TIME failed before the loop began: tell the listeners and let the next follower start over.
          broadcast(started, { type: 'error', message: error instanceof Error ? error.message : String(error) });
          started.stopped = true;
          if (loops.get(stream) === started) loops.delete(stream);
        });
      }
      const joined = loop;
      broadcast(joined, { type: 'listeners', listeners: joined.listeners.size + 1 });
      joined.listeners.add(listener);
      return {
        loop: joined.id,
        listeners: joined.listeners.size,
        leave() {
          if (!joined.listeners.delete(listener)) return;
          if (joined.listeners.size) return broadcast(joined, { type: 'listeners', listeners: joined.listeners.size });
          joined.stopped = true;
          if (loops.get(stream) === joined) loops.delete(stream);
        },
      };
    },
    stopAll() {
      for (const loop of loops.values()) loop.stopped = true;
      loops.clear();
    },
  };
}
