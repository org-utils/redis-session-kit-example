// GET /api/events: one server-sent event stream for every mode's event log and status. On connect it sends the current
// status and the buffered entries, then live entries and a fresh status after every check.
import type { ServerEvent } from '@showcase/contracts';
import type { FastifyPluginAsync } from 'fastify';
import type { EventLog } from '../redis/event-log.ts';
import type { StatusMonitor } from '../redis/status-monitor.ts';
import { sseStreams } from './sse.ts';

export const eventRoutes: FastifyPluginAsync<{ eventLog: EventLog; monitor: StatusMonitor }> = async (
  app,
  { eventLog, monitor },
) => {
  const openStream = sseStreams(app);

  app.get('/api/events', (request, reply) => {
    const stream = openStream<ServerEvent>(request, reply);

    stream.send({ type: 'status', modes: monitor.snapshot() });
    for (const entry of eventLog.entries()) stream.send({ type: 'entry', entry });
    const offEntries = eventLog.subscribe((entry) => stream.send({ type: 'entry', entry }));
    const offStatus = monitor.subscribe((modes) => stream.send({ type: 'status', modes }));
    stream.onEnd(() => {
      offEntries();
      offStatus();
    });
  });
};
