// The client feature module's operations on the mode client: health() and the raw multi-key commands, which run outside
// every namespace and show which raw commands are cluster-safe. Registered once per mode under /api/<mode>/client; it only
// ever sees that mode's client. (The temporary-client demos are a later ticket.)
import { ClientHealthRequestSchema, ClientRawRequestSchema } from '@showcase/contracts';
import type { FeatureModule } from '../../app.ts';

export const clientModule: FeatureModule = async (app, { client }) => {
  app.post('/health', { schema: { body: ClientHealthRequestSchema } }, ({ body }) => client.health(body));

  app.post('/raw', { schema: { body: ClientRawRequestSchema } }, async ({ body }) => {
    switch (body.command) {
      case 'mget':
        return client.mget(...body.keys);
      case 'exists':
        return client.exists(...body.keys);
      case 'eval':
        return client.eval(body.script, body.keys.length, ...body.keys, ...body.args);
      case 'mgetClusterAware':
        return client.mgetClusterAware(body.keys);
      case 'del':
        return client.del(...body.keys);
      case 'scanCluster':
        return client.scanCluster(body.pattern);
      case 'deletePatternClusterAware':
        return client.deletePatternClusterAware(body.pattern);
      case 'pipeline': {
        const pipeline = client.pipeline();
        for (const key of body.keys) pipeline.get(key);
        // exec() resolves to [error, value] per command; an error is sent as its message.
        const replies = (await pipeline.exec()) ?? [];
        return replies.map(([error, value]) => [error ? error.message : null, value]);
      }
    }
  });
};
