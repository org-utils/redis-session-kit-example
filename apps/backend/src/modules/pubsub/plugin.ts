// The pub/sub feature module: publish returns exactly what the package returned, and each card is its own SSE stream,
// subscribed through the package when it opens and unsubscribed when it closes (the package shares one Redis SUBSCRIBE
// per channel, so the last card to close sends the real UNSUBSCRIBE). Registered once per mode under /api/<mode>/pubsub;
// it only ever sees that mode's client.
import {
  PubSubChannelParamsSchema, PubSubPublishRawRequestSchema, PubSubPublishRequestSchema, type PubSubStreamEvent,
} from '@showcase/contracts';
import type { FeatureModule } from '../../app.ts';
import { sseStreams } from '../../http/sse.ts';

export const pubsubModule: FeatureModule = async (app, { client }) => {
  const { pubsub } = client;
  const openStream = sseStreams(app);

  app.post('/publish', { schema: { body: PubSubPublishRequestSchema } }, ({ body }) => pubsub.publish(body.channel, body.message));

  // Not the package's publish: a raw PUBLISH, as another program would send it, so a non-JSON message can reach the
  // subscriber (which drops it and reports PUBSUB_SERIALIZATION to the event log).
  app.post('/publish-raw', { schema: { body: PubSubPublishRawRequestSchema } }, ({ body }) =>
    client.publish(pubsub.fullChannel(body.channel), body.message),
  );

  app.get('/channels/:channel/stream', { schema: { params: PubSubChannelParamsSchema } }, (request, reply) => {
    const { channel } = request.params;
    const stream = openStream<PubSubStreamEvent>(request, reply);
    pubsub
      .subscribe(channel, (message) => stream.send({ type: 'message', channel: message.channel, value: message.value }))
      .then(
        (subscription) => {
          // Closed while subscribing, or later: either way this card's subscription goes.
          stream.onEnd(() => void subscription.unsubscribe().catch(() => {}));
          stream.send({ type: 'subscribed', channel });
        },
        (error: Error & { code?: string }) => {
          stream.send({ type: 'error', error: { code: error.code ?? 'SUBSCRIBE_FAILED', name: error.name, message: error.message } });
          stream.end();
        },
      );
  });
};
