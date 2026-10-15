// The streams feature module: one POST per public streams method, each returning exactly what the package returned
// (group reads and acks one step at a time, with a short block), the pending table read with native XPENDING, and a
// follow stream per stream fed by one shared read loop. Registered once per mode under /api/<mode>/streams; it only
// ever sees that mode's client.
import {
  StreamsAckRequestSchema, StreamsAddRequestSchema, StreamsCreateGroupRequestSchema, StreamsDeleteRequestSchema,
  StreamsReadRequestSchema, StreamsStreamRequestSchema, type StreamsFollowEvent, type StreamsPending,
} from '@showcase/contracts';
import type { FeatureModule } from '../../app.ts';
import { sseStreams } from '../../http/sse.ts';
import { createFollowLoops } from './follow-loops.ts';

/** A one-step read waits this long for an entry: long enough to catch one, short enough to answer at once. */
const READ_BLOCK_MS = 100;

/**
 * Per group (XINFO GROUPS), each consumer (XINFO CONSUMERS) and its delivered-but-unacked entries (XPENDING), in one
 * round trip on the node that owns the stream. RESP2 replies: XINFO entries are flat `[field, value, …]` lists.
 */
const PENDING = `
local function field(flat, name)
  for i = 1, #flat, 2 do if flat[i] == name then return flat[i + 1] end end
end
local ok, groups = pcall(redis.call, 'XINFO', 'GROUPS', KEYS[1])
if not ok then return {} end
local out = {}
for _, g in ipairs(groups) do
  local group = field(g, 'name')
  local consumers = {}
  for _, c in ipairs(redis.call('XINFO', 'CONSUMERS', KEYS[1], group)) do table.insert(consumers, field(c, 'name')) end
  table.insert(out, { group, consumers, redis.call('XPENDING', KEYS[1], group, '-', '+', 100) })
end
return out`;

type PendingReply = [group: string, consumers: string[], pending: [id: string, consumer: string, idleMs: number, deliveries: number][]][];

export const streamsModule: FeatureModule = async (app, { client }) => {
  const { streams } = client;
  const openStream = sseStreams(app);
  const loops = createFollowLoops(client);
  app.addHook('preClose', async () => loops.stopAll());

  // createGroup resolves to nothing; null is that nothing as JSON.
  app.post('/createGroup', { schema: { body: StreamsCreateGroupRequestSchema } }, async ({ body: { stream, group, start } }) => {
    await streams.createGroup(stream, group, start);
    return null;
  });
  app.post('/add', { schema: { body: StreamsAddRequestSchema } }, ({ body: { stream, fields, maxEntries } }) =>
    streams.add(stream, fields, maxEntries),
  );
  app.post('/read', { schema: { body: StreamsReadRequestSchema } }, ({ body: { stream, ...options } }) =>
    streams.read(stream, { ...options, blockMs: READ_BLOCK_MS }),
  );
  app.post('/ack', { schema: { body: StreamsAckRequestSchema } }, ({ body }) => streams.ack(body.stream, body.group, ...body.ids));
  app.post('/delete', { schema: { body: StreamsDeleteRequestSchema } }, ({ body }) => streams.delete(body.stream, ...body.ids));
  app.post('/length', { schema: { body: StreamsStreamRequestSchema } }, ({ body }) => streams.length(body.stream));

  // The pending table: native XINFO + XPENDING, not a package call, so it is not traced.
  app.get('/pending', { schema: { querystring: StreamsStreamRequestSchema } }, async ({ query }): Promise<StreamsPending> => {
    const reply = (await client.eval(PENDING, 1, streams.key(query.stream))) as PendingReply;
    return {
      groups: reply.map(([name, consumers, pending]) => ({
        name,
        consumers: consumers.map((consumer) => ({
          name: consumer,
          pending: pending.filter((p) => p[1] === consumer).map(([id, , idleMs, deliveries]) => ({ id, idleMs, deliveries })),
        })),
      })),
    };
  });

  app.get('/:stream/follow', { schema: { params: StreamsStreamRequestSchema } }, (request, reply) => {
    const { stream: name } = request.params;
    const stream = openStream(request, reply);
    const send = (event: StreamsFollowEvent) => stream.send(event);
    const following = loops.follow(name, send);
    send({ type: 'following', stream: name, loop: following.loop, listeners: following.listeners });
    stream.onEnd(following.leave);
  });

  // Reset section: a showcase convenience, not a streams call. Deletes everything under the namespace on this mode.
  app.post('/reset-section', () => client.deletePatternClusterAware(`${client.config.streams.namespace}:*`));
};
