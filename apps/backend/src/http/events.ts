// GET /api/events: one server-sent event stream for every mode's event log and status. On connect it sends the current
// status and the buffered entries, then live entries and a fresh status after every check.
import type { ServerEvent } from '@showcase/contracts';
import type { FastifyPluginAsync } from 'fastify';
import type { EventLog } from '../redis/event-log.ts';
import type { StatusMonitor } from '../redis/status-monitor.ts';

const KEEPALIVE_MS = 15_000;

export const eventRoutes: FastifyPluginAsync<{ eventLog: EventLog; monitor: StatusMonitor }> = async (
  app,
  { eventLog, monitor },
) => {
  const open = new Set<() => void>();
  // Open streams never end on their own, so closing the app ends them; otherwise close() would wait on them forever.
  app.addHook('preClose', async () => {
    for (const end of open) end();
  });

  app.get('/api/events', (request, reply) => {
    reply.hijack();
    const res = reply.raw;
    res.writeHead(200, {
      'content-type': 'text/event-stream',
      // no-transform: the Next.js rewrite and any proxy must neither compress nor buffer the stream.
      'cache-control': 'no-cache, no-transform',
      connection: 'keep-alive',
      'x-accel-buffering': 'no',
    });
    const send = (event: ServerEvent) => res.write(`data: ${JSON.stringify(event)}\n\n`);

    send({ type: 'status', modes: monitor.snapshot() });
    for (const entry of eventLog.entries()) send({ type: 'entry', entry });
    const offEntries = eventLog.subscribe((entry) => send({ type: 'entry', entry }));
    const offStatus = monitor.subscribe((modes) => send({ type: 'status', modes }));
    const keepalive = setInterval(() => res.write(': keepalive\n\n'), KEEPALIVE_MS);

    const end = () => {
      offEntries();
      offStatus();
      clearInterval(keepalive);
      open.delete(end);
      res.end();
    };
    open.add(end);
    request.raw.on('close', end);
  });
};
