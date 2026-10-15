// The cache feature module: one POST per public cache method, each returning exactly what the package returned.
// Registered once per mode under /api/<mode>/cache; it only ever sees that mode's client.
import {
  CacheClearRequestSchema, CacheDeleteRequestSchema, CacheGetRequestSchema, CacheKeyRequestSchema,
  CacheSetIfAbsentRequestSchema, CacheSetRequestSchema,
} from '@showcase/contracts';
import type { FeatureModule } from '../../app.ts';

export const cacheModule: FeatureModule = async (app, { client }) => {
  const { cache } = client;

  app.post('/set', { schema: { body: CacheSetRequestSchema } }, ({ body: { key, value, ...options } }) =>
    cache.set(key, value, options),
  );
  app.post('/get', { schema: { body: CacheGetRequestSchema } }, ({ body: { key, getValue } }) =>
    getValue ? cache.getValue(key) : cache.get(key),
  );
  app.post('/has', { schema: { body: CacheKeyRequestSchema } }, ({ body }) => cache.has(body.key));
  app.post('/ttl', { schema: { body: CacheKeyRequestSchema } }, ({ body }) => cache.ttl(body.key));
  app.post('/setIfAbsent', { schema: { body: CacheSetIfAbsentRequestSchema } }, ({ body: { key, value, ttl } }) =>
    cache.setIfAbsent(key, value, ttl),
  );
  app.post('/delete', { schema: { body: CacheDeleteRequestSchema } }, ({ body }) => cache.delete(...body.keys));
  app.post('/clear', { schema: { body: CacheClearRequestSchema } }, ({ body }) => cache.clear(body.pattern));

  // Reset section: a showcase convenience, not a cache call. Deletes everything under the cache namespace on this mode.
  app.post('/reset', () => client.deletePatternClusterAware(`${client.config.cache.namespace}:*`));
};
