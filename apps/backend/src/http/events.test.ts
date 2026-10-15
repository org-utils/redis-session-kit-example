// GET /api/events over a real listener (SSE can't be inject()ed: it never ends), against the standalone Docker stack.
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { ServerEventSchema, type ServerEvent } from '@showcase/contracts';
import { buildApp, type FeatureModule } from '../app.ts';
import { testConfig } from '../test-config.ts';

// A Pub/Sub handler that throws: the package reports it to the mode client's onError as `pubsub-handler`.
const faulty: FeatureModule = async (app, { client }) => {
  const subscription = await client.pubsub.subscribe('faulty', () => {
    throw new Error('handler blew up');
  });
  app.addHook('onClose', () => subscription.unsubscribe());
  app.post('/faulty', async () => ({ receivers: await client.pubsub.publish('faulty', { n: 1 }) }));
};

const app = await buildApp({ config: testConfig({ SHOWCASE_MODES: 'standalone' }), modules: [faulty] });
let base: string;
before(async () => {
  base = await app.listen({ port: 0, host: '127.0.0.1' });
});
after(() => app.close());

/** Opens the SSE stream and returns its response plus a reader of parsed messages. */
async function openEvents() {
  const res = await fetch(`${base}/api/events`);
  const reader = res.body!.pipeThrough(new TextDecoderStream()).getReader();
  const queue: ServerEvent[] = [];
  let buffered = '';
  async function next(): Promise<ServerEvent> {
    while (!queue.length) {
      const { value, done } = await reader.read();
      if (done) throw new Error('stream ended');
      buffered += value;
      const frames = buffered.split('\n\n');
      buffered = frames.pop()!;
      for (const frame of frames) {
        const data = frame.split('\n').find((line) => line.startsWith('data: '));
        if (data) queue.push(ServerEventSchema.parse(JSON.parse(data.slice(6))));
      }
    }
    return queue.shift()!;
  }
  /** The next message of the given type, skipping others (status arrives every 2 s). */
  async function nextOf<T extends ServerEvent['type']>(type: T) {
    for (;;) {
      const event = await next();
      if (event.type === type) return event as Extract<ServerEvent, { type: T }>;
    }
  }
  return { res, nextOf, close: () => reader.cancel() };
}

test('streams as unbuffered, untransformed server-sent events', async () => {
  const { res, close } = await openEvents();
  assert.equal(res.headers.get('content-type'), 'text/event-stream');
  assert.match(res.headers.get('cache-control') ?? '', /no-transform/);
  await close();
});

test('sends the status, then the buffered entries, then live ones', async () => {
  const events = await openEvents();
  const status = await events.nextOf('status');
  assert.deepEqual(status.modes.map((m) => [m.mode, m.health?.status]), [['standalone', 'healthy']]);

  const buffered = await events.nextOf('entry');
  assert.deepEqual([buffered.entry.mode, buffered.entry.kind, buffered.entry.message.split(' ')[0]], ['standalone', 'health', 'healthy']);

  const res = await fetch(`${base}/api/standalone/faulty`, { method: 'POST' });
  assert.equal(res.status, 200);
  const live = await events.nextOf('entry');
  assert.deepEqual(
    [live.entry.mode, live.entry.kind, live.entry.source, live.entry.channel, live.entry.message],
    ['standalone', 'error', 'pubsub-handler', 'faulty', 'handler blew up'],
  );
  assert.ok(live.entry.id > buffered.entry.id);
  await events.close();
});

test('a later listener gets the same buffered entries replayed', async () => {
  const events = await openEvents();
  const first = await events.nextOf('entry');
  assert.equal(first.entry.kind, 'health');
  const second = await events.nextOf('entry');
  assert.equal(second.entry.source, 'pubsub-handler');
  await events.close();
});
