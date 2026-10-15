// A subscriber of the showcase's own that hears what Sentinel announces (the package has no SENTINEL commands). It
// connects to the first reachable sentinel, always tried in the configured order, so it is the same sentinel while it is
// up. Redis 8 sentinels reject QUIT, so it ends with disconnect().
import { setTimeout as sleep } from 'node:timers/promises';
import type { Redis } from 'ioredis';
import { firstReachable, type Address } from './own-connections.ts';

const RECONNECT_MS = 1000;

/** Sentinel's own chatter between sentinels, not an announcement. */
const isHello = (channel: string) => channel.startsWith('__sentinel__');

/**
 * Calls `onAnnouncement` with every event Sentinel publishes (`+sdown`, `+switch-master`, …: the channel, and the
 * message as Sentinel wrote it) until closed. Reconnects to the first reachable sentinel when its connection ends.
 */
export function watchAnnouncements(
  addresses: Address[],
  onAnnouncement: (channel: string, message: string) => void,
): { close(): void } {
  let closed = false;
  let current: Redis | null = null;

  async function connect() {
    while (!closed) {
      let redis: Redis;
      try {
        ({ redis } = await firstReachable(addresses));
      } catch {
        await sleep(RECONNECT_MS);
        continue;
      }
      if (closed) return redis.disconnect();
      current = redis;
      redis.on('pmessage', (_pattern: string, channel: string, message: string) => {
        if (!isHello(channel)) onAnnouncement(channel, message);
      });
      // From here on the connection ending, for any reason, is the one way back in.
      redis.on('end', () => {
        current = null;
        if (!closed) void sleep(RECONNECT_MS).then(connect);
      });
      redis.psubscribe('*').catch(() => redis.disconnect());
      return;
    }
  }
  void connect();

  return {
    close() {
      closed = true;
      current?.disconnect();
    },
  };
}
