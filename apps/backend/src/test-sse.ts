// Server-sent events for tests, over a real listener (SSE can't be inject()ed: it never ends).
import type { EventLogEntry, Mode } from '@showcase/contracts';
import { ServerEventSchema } from '@showcase/contracts';

export interface SseReader {
  status: number;
  /** The next `data:` payload, parsed as JSON. Rejects after `timeoutMs` without one. */
  next(timeoutMs?: number): Promise<unknown>;
  close(): Promise<void>;
}

export async function openSse(url: string): Promise<SseReader> {
  const res = await fetch(url);
  const reader = res.body!.pipeThrough(new TextDecoderStream()).getReader();
  const queue: unknown[] = [];
  let buffered = '';
  let reading: Promise<ReadableStreamReadResult<string>> | null = null;
  return {
    status: res.status,
    async next(timeoutMs = 3000) {
      const deadline = Date.now() + timeoutMs;
      while (!queue.length) {
        reading ??= reader.read();
        let timer: ReturnType<typeof setTimeout> | undefined;
        const timeout = new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Error(`no event within ${timeoutMs} ms`)), Math.max(0, deadline - Date.now()));
        });
        const { value, done } = await Promise.race([reading, timeout]).finally(() => clearTimeout(timer));
        reading = null;
        if (done) throw new Error('stream ended');
        buffered += value;
        const frames = buffered.split('\n\n');
        buffered = frames.pop()!;
        for (const frame of frames) {
          const data = frame.split('\n').find((line) => line.startsWith('data: '));
          if (data) queue.push(JSON.parse(data.slice(6)));
        }
      }
      return queue.shift();
    },
    close: () => reader.cancel(),
  };
}

/**
 * Every buffered event log entry on `mode` matching `match`, from GET /api/events: on connect it sends a status, the
 * buffer, then the next status (every 2 s), so everything before that second status is the buffer.
 */
export async function eventLogEntries(base: string, mode: Mode, match: (entry: EventLogEntry) => boolean): Promise<EventLogEntry[]> {
  const events = await openSse(`${base}/api/events`);
  const found: EventLogEntry[] = [];
  try {
    let statuses = 0;
    while (statuses < 2) {
      const event = ServerEventSchema.parse(await events.next(5000));
      if (event.type === 'status') statuses++;
      else if (event.entry.mode === mode && match(event.entry)) found.push(event.entry);
    }
  } finally {
    await events.close();
  }
  return found;
}
