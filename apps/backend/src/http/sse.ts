// Server-sent event streams: unbuffered and untransformed (the Next.js rewrite and any proxy must neither compress nor
// buffer them), kept alive with a comment every 15 s, and ended when the browser goes or the app closes.
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';

const KEEPALIVE_MS = 15_000;

/** One open stream, sending events of type `E`. */
export interface SseStream<E> {
  /** Sends one event as a `data:` payload, as JSON. Does nothing once the stream has ended. */
  send(event: E): void;
  /** Runs `fn` when the stream ends, or at once if it already has. */
  onEnd(fn: () => void): void;
  end(): void;
}

/**
 * Returns a function that turns a request into an SSE stream. Every stream it opened is ended before `app` closes:
 * open streams never end on their own, so close() would otherwise wait on them forever.
 */
export function sseStreams(app: FastifyInstance): <E>(request: FastifyRequest, reply: FastifyReply) => SseStream<E> {
  const open = new Set<() => void>();
  app.addHook('preClose', async () => {
    for (const end of open) end();
  });

  return <E>(request: FastifyRequest, reply: FastifyReply): SseStream<E> => {
    reply.hijack();
    const res = reply.raw;
    res.writeHead(200, {
      'content-type': 'text/event-stream',
      'cache-control': 'no-cache, no-transform',
      connection: 'keep-alive',
      'x-accel-buffering': 'no',
    });
    const keepalive = setInterval(() => res.write(': keepalive\n\n'), KEEPALIVE_MS);
    const cleanups: (() => void)[] = [];
    let ended = false;

    const end = () => {
      if (ended) return;
      ended = true;
      clearInterval(keepalive);
      open.delete(end);
      for (const cleanup of cleanups) cleanup();
      res.end();
    };
    open.add(end);
    request.raw.on('close', end);

    return {
      send(event) {
        if (!ended) res.write(`data: ${JSON.stringify(event)}\n\n`);
      },
      onEnd(fn) {
        if (ended) fn();
        else cleanups.push(fn);
      },
      end,
    };
  };
}
